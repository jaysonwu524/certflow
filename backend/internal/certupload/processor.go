// Package certupload synchronizes a certificate version to Aliyun Certificate
// Management without binding it to an ALB listener.
package certupload

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/regenbio/certflow/internal/aliyunrpc"
	"github.com/regenbio/certflow/internal/cas"
	"github.com/regenbio/certflow/internal/cryptobox"
	"github.com/regenbio/certflow/internal/job"
	"github.com/regenbio/certflow/internal/store"
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

	var credentials aliyunrpc.Credentials
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
		if err := json.Unmarshal(credentialPayload, &credentials); err != nil || credentials.AccessKeyID == "" || credentials.AccessKeySecret == "" {
			return job.Permanent("invalid_upload_credential", "upload cloud credential is invalid")
		}
		return nil
	}); err != nil {
		return err
	}

	return reporter.StepResult(ctx, "sync_aliyun_certificate", map[string]string{"certificate_version_id": configuration.CertificateVersionID, "remote_certificate_id": configuration.RemoteCertificateID}, func(ctx context.Context) (any, error) {
		taskSuffix := "legacy"
		if len(claimed.AutomationTaskID) >= 8 {
			taskSuffix = claimed.AutomationTaskID[:8]
		}
		name := "certflow-" + configuration.CertificateID[:8] + "-" + taskSuffix
		client := cas.New()
		remoteID := configuration.RemoteCertificateID
		mode := "reuse"
		var err error
		if remoteID == "" || configuration.LastUploadedVersionID != configuration.CertificateVersionID {
			remoteID, err = client.UploadUserCertificate(ctx, cas.Credentials(credentials), name, string(append(certificatePEM, chainPEM...)), string(privateKeyPEM))
			mode = "create"
		}
		if err != nil {
			return nil, classify(err)
		}
		if remoteID == "" {
			return nil, job.Permanent("aliyun_certificate_upload_failed", "Aliyun Certificate Management did not return a certificate ID")
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
