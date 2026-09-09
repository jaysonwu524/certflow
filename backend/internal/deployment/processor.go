// Package deployment applies issued certificates to configured targets.
package deployment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/regenbio/certflow/internal/alb"
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
	if claimed.CertificateID == "" || claimed.DeploymentTargetID == "" {
		return job.Permanent("invalid_deployment_job", "deployment job is missing its certificate or target")
	}
	var configuration store.DeploymentConfiguration
	if err := reporter.Step(ctx, "load_deployment_configuration", map[string]string{"certificate_id": claimed.CertificateID, "target_id": claimed.DeploymentTargetID}, func(ctx context.Context) error {
		var err error
		configuration, err = p.store.LoadDeploymentConfiguration(ctx, claimed.CertificateID, claimed.DeploymentTargetID)
		if errors.Is(err, pgx.ErrNoRows) {
			return job.Permanent("deployment_configuration_missing", "certificate version or deployment target is unavailable")
		}
		if err != nil {
			return job.Retryable("deployment_configuration_load_failed", "could not load deployment configuration", 0)
		}
		return nil
	}); err != nil {
		return err
	}

	var credentials aliyunrpc.Credentials
	var certificatePEM, privateKeyPEM, chainPEM []byte
	if err := reporter.Step(ctx, "decrypt_deployment_material", nil, func(ctx context.Context) error {
		if configuration.CloudCredential.Status != "active" {
			return job.Permanent("deployment_credential_inactive", "deployment cloud credential is inactive")
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
		payload, err := p.box.Open("cloud_credential_version", configuration.CloudCredential.VersionID, configuration.CloudCredential.CredentialsCiphertext)
		if err != nil {
			return job.Permanent("deployment_credential_unavailable", "could not decrypt deployment cloud credential")
		}
		if err := json.Unmarshal(payload, &credentials); err != nil || credentials.AccessKeyID == "" || credentials.AccessKeySecret == "" {
			return job.Permanent("invalid_deployment_credential", "deployment cloud credential is invalid")
		}
		return nil
	}); err != nil {
		return p.fail(claimed, err)
	}

	remoteCertificateID := ""
	if err := reporter.Step(ctx, "upload_aliyun_certificate", map[string]string{"target": configuration.TargetName}, func(ctx context.Context) error {
		var err error
		remoteCertificateID, err = cas.New().UploadUserCertificate(ctx, cas.Credentials(credentials), "certflow-"+configuration.CertificateID[:8]+"-"+configuration.CertificateVersionID[:8], string(append(certificatePEM, chainPEM...)), string(privateKeyPEM))
		if err != nil {
			return classify(err)
		}
		if remoteCertificateID == "" {
			return job.Permanent("aliyun_certificate_upload_failed", "Aliyun Certificate Management did not return a certificate ID")
		}
		return nil
	}); err != nil {
		return p.fail(claimed, err)
	}

	if err := reporter.Step(ctx, "update_alb_listener_certificate", map[string]string{"region_id": configuration.RegionID, "listener_id": configuration.ListenerID}, func(ctx context.Context) error {
		return classify(alb.New().ReplaceDefaultCertificate(ctx, alb.Credentials(credentials), configuration.RegionID, configuration.ListenerID, remoteCertificateID))
	}); err != nil {
		return p.fail(claimed, err)
	}
	if err := p.store.MarkDeploymentSucceeded(ctx, claimed.CertificateID, claimed.DeploymentTargetID, configuration.CertificateVersionID, remoteCertificateID); err != nil {
		return job.Retryable("deployment_state_save_failed", "ALB was updated but deployment state could not be saved", 0)
	}
	return nil
}

func (p *Processor) fail(claimed store.ClaimedJob, err error) error {
	var classified *job.Error
	if errors.As(err, &classified) {
		_ = p.store.MarkDeploymentFailed(context.Background(), claimed.CertificateID, claimed.DeploymentTargetID, classified.Message)
	}
	return err
}

func classify(err error) error {
	if err == nil {
		return nil
	}
	var provider *aliyunrpc.Error
	if errors.As(err, &provider) {
		switch provider.Code {
		case "api_unavailable", "serviceunavailable", "internalerror", "throttling":
			return job.Retryable("aliyun_"+provider.Code, provider.Message, 0)
		}
		return job.Permanent("aliyun_"+provider.Code, provider.Message)
	}
	if fmt.Sprint(err) == "listener does not support certificates" {
		return job.Permanent("listener_protocol_unsupported", "only HTTPS or QUIC ALB listeners can use certificates")
	}
	return job.Retryable("deployment_operation_failed", "Aliyun deployment operation failed", 0)
}
