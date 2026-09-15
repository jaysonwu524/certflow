// Package certupload synchronizes a certificate version to cloud certificate
// management without binding it to a load balancer listener.
package certupload

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/regenbio/certflow/apps/control-plane/internal/aliyunrpc"
	"github.com/regenbio/certflow/apps/control-plane/internal/cloudprovider"
	"github.com/regenbio/certflow/apps/control-plane/internal/cryptobox"
	"github.com/regenbio/certflow/apps/control-plane/internal/job"
	"github.com/regenbio/certflow/apps/control-plane/internal/store"
)

type Processor struct {
	store *store.Store
	box   *cryptobox.Box
}

func New(s *store.Store, box *cryptobox.Box) *Processor { return &Processor{store: s, box: box} }

func (p *Processor) Handle(ctx context.Context, claimed store.ClaimedJob, reporter *job.Reporter) error {
	var payload struct {
		CloudCredentialID string `json:"cloud_credential_id"`
	}
	if claimed.CertificateID == "" || json.Unmarshal(claimed.Payload, &payload) != nil || payload.CloudCredentialID == "" {
		return job.Permanent("invalid_upload_job", "upload job is missing its certificate or cloud credential")
	}

	var configuration store.UploadConfiguration
	if err := reporter.Step(ctx, "load_upload_configuration", map[string]string{"certificate_id": claimed.CertificateID}, func(ctx context.Context) error {
		var err error
		configuration, err = p.store.LoadUploadConfiguration(ctx, claimed.AutomationTaskID, claimed.CertificateID, payload.CloudCredentialID)
		if errors.Is(err, pgx.ErrNoRows) {
			return job.Permanent("upload_configuration_missing", "certificate version or cloud credential is unavailable")
		}
		if err != nil {
			return job.Retryable("upload_configuration_load_failed", "could not load upload configuration", 0)
		}
		return nil
	}); err != nil {
		return err
	}

	providerName := configuration.CloudCredential.Provider
	if providerName == "" {
		providerName = "aliyun"
	}

	// Get provider instance
	provider, err := cloudprovider.Get(providerName)
	if err != nil {
		return job.Permanent("unsupported_provider", fmt.Sprintf("provider %s not supported", providerName))
	}
	uploader, ok := provider.(cloudprovider.CertificateUploadProvider)
	if !ok {
		return job.Permanent("provider_capability_missing", "provider does not support certificate upload")
	}

	var credentials cloudprovider.Credentials
	var certificatePEM, privateKeyPEM, chainPEM []byte
	if err := reporter.Step(ctx, "decrypt_upload_material", nil, func(context.Context) error {
		if configuration.CloudCredential.Status != "active" {
			return job.Permanent("upload_credential_inactive", "upload cloud credential is inactive")
		}
		var err error
		certificatePEM, err = p.box.Open("certificate_version", configuration.CertificateVersionID, configuration.CertificateCiphertext)
		if err != nil {
			return job.Permanent("certificate_material_unavailable", "could not decrypt certificate material")
		}
		privateKeyPEM, err = p.box.Open("certificate_version", configuration.CertificateVersionID, configuration.PrivateKeyCiphertext)
		if err != nil {
			return job.Permanent("certificate_material_unavailable", "could not decrypt certificate private key")
		}
		chainPEM, err = p.box.Open("certificate_version", configuration.CertificateVersionID, configuration.ChainCiphertext)
		if err != nil {
			return job.Permanent("certificate_material_unavailable", "could not decrypt certificate chain")
		}
		credentialPayload, err := p.box.Open("cloud_credential_version", configuration.CloudCredential.VersionID, configuration.CloudCredential.CredentialsCiphertext)
		if err != nil {
			return job.Permanent("upload_credential_unavailable", "could not decrypt upload cloud credential")
		}

		// Unmarshal credentials based on provider
		credentials, err = cloudprovider.UnmarshalCredentials(providerName, credentialPayload)
		if err != nil {
			return job.Permanent("invalid_upload_credential", fmt.Sprintf("upload cloud credential is invalid: %v", err))
		}
		if err := provider.VerifyCredentials(ctx, credentials); err != nil {
			return classify(err)
		}

		return nil
	}); err != nil {
		return err
	}

	return reporter.StepResult(ctx, "sync_certificate", map[string]string{"certificate_version_id": configuration.CertificateVersionID, "remote_certificate_id": configuration.RemoteCertificateID}, func(ctx context.Context) (any, error) {
		remoteID := ""
		mode := "reuse"
		if err := p.store.WithCertificateCloudAssetLock(ctx, configuration.CertificateVersionID, configuration.CloudCredential.ID, func(ctx context.Context) error {
			latest, err := p.store.LoadUploadConfiguration(ctx, claimed.AutomationTaskID, claimed.CertificateID, payload.CloudCredentialID)
			if errors.Is(err, pgx.ErrNoRows) {
				return job.Permanent("upload_configuration_missing", "certificate version or cloud credential is unavailable")
			}
			if err != nil {
				return job.Retryable("upload_configuration_load_failed", "could not reload upload configuration", 0)
			}
			if latest.RemoteCertificateID != "" && latest.LastUploadedVersionID == configuration.CertificateVersionID {
				if lookup, ok := provider.(cloudprovider.CertificateLookupProvider); ok {
					exists, lookupErr := lookup.CertificateExists(ctx, credentials, latest.RemoteCertificateID)
					if lookupErr != nil {
						return classify(lookupErr)
					}
					if exists {
						remoteID = latest.RemoteCertificateID
						return nil
					}
				} else {
					remoteID = latest.RemoteCertificateID
					return nil
				}
			}

			taskSuffix := "legacy"
			if len(claimed.AutomationTaskID) >= 8 {
				taskSuffix = claimed.AutomationTaskID[:8]
			}
			name := "certflow-" + configuration.CertificateID[:8] + "-" + taskSuffix
			remoteID, err = uploader.UploadCertificate(ctx, credentials, cloudprovider.UploadCertificateRequest{
				Name:           name,
				CertificatePEM: string(certificatePEM),
				PrivateKeyPEM:  string(privateKeyPEM),
				ChainPEM:       string(chainPEM),
			})
			if err != nil {
				return classify(err)
			}
			if remoteID == "" {
				return job.Permanent("certificate_upload_failed", "Certificate Management did not return a certificate ID")
			}
			mode = "create"
			if err := p.store.MarkCertificateCloudAsset(ctx, configuration.CertificateID, configuration.CertificateVersionID, configuration.CloudCredential.ID, remoteID); err != nil {
				return job.Retryable("upload_asset_state_save_failed", "certificate uploaded but cloud asset state could not be saved", 0)
			}
			return nil
		}); err != nil {
			return nil, err
		}
		if err := p.store.MarkAutomationUploadSucceeded(ctx, claimed.AutomationTaskID, configuration.CertificateVersionID, remoteID); err != nil {
			return nil, job.Retryable("upload_state_save_failed", "certificate uploaded but synchronization state could not be saved", 0)
		}
		return map[string]string{"certificate_version_id": configuration.CertificateVersionID, "remote_certificate_id": remoteID, "mode": mode}, nil
	})
}

func classify(err error) error {
	var provider *aliyunrpc.Error
	if errors.As(err, &provider) {
		switch provider.Code {
		case "api_unavailable", "serviceunavailable", "internalerror", "throttling":
			return job.Retryable("aliyun_"+provider.Code, provider.Message, 0)
		}
		return job.Permanent("aliyun_"+provider.Code, provider.Message)
	}
	return job.Retryable("upload_operation_failed", "Aliyun certificate upload failed", 0)
}
