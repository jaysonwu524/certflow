// Package issuance contains the worker-side certificate issuance workflow.
package issuance

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/regenbio/certflow/internal/cryptobox"
	aliyundns "github.com/regenbio/certflow/internal/dns/aliyun"
	"github.com/regenbio/certflow/internal/id"
	"github.com/regenbio/certflow/internal/job"
	"github.com/regenbio/certflow/internal/store"
	"golang.org/x/crypto/acme"
)

type Processor struct {
	store *store.Store
	box   *cryptobox.Box
}

func New(s *store.Store, box *cryptobox.Box) *Processor {
	return &Processor{store: s, box: box}
}

func (p *Processor) Handle(ctx context.Context, claimed store.ClaimedJob, reporter *job.Reporter) error {
	if claimed.CertificateID == "" {
		return job.Permanent("invalid_job_payload", "issuance job does not reference a certificate")
	}

	var configuration store.IssueConfiguration
	if err := reporter.Step(ctx, "load_issuance_configuration", map[string]string{"certificate_id": claimed.CertificateID}, func(ctx context.Context) error {
		var err error
		configuration, err = p.store.LoadIssueConfiguration(ctx, claimed.CertificateID)
		if errors.Is(err, pgx.ErrNoRows) {
			return job.Permanent("issuance_configuration_missing", "certificate references a missing account or credential")
		}
		if err != nil {
			return job.Retryable("configuration_load_failed", "could not load issuance configuration", 0)
		}
		return nil
	}); err != nil {
		return err
	}

	var accountKey crypto.Signer
	var cloudCredential cloudCredentials
	if err := reporter.Step(ctx, "decrypt_and_validate_credentials", map[string]any{
		"domain_count":    len(configuration.Domains),
		"validation_mode": configuration.ValidationMode,
	}, func(context.Context) error {
		if configuration.ACMEAccount.Status != "active" {
			return job.Permanent("issuance_configuration_inactive", "ACME account is inactive")
		}
		privateKeyPEM, err := p.box.Open("acme_account", configuration.ACMEAccount.ID, configuration.ACMEAccount.PrivateKeyCiphertext)
		if err != nil {
			return job.Permanent("acme_key_unavailable", "could not decrypt the ACME account key")
		}
		accountKey, err = parseSigner(privateKeyPEM)
		if err != nil {
			return job.Permanent("invalid_acme_key", "ACME account key is not a supported private key")
		}
		if configuration.ValidationMode == "auto" {
			if configuration.DNSAccount.Status != "active" || configuration.CloudCredential.Status != "active" || configuration.DNSAccount.VerifiedCredentialVersionID == "" || configuration.DNSAccount.VerifiedCredentialVersionID != configuration.CloudCredential.VersionID {
				return job.Permanent("issuance_configuration_inactive", "DNS account or cloud credential is inactive")
			}
			if configuration.DNSAccount.Provider != "aliyun" {
				return job.Permanent("dns_provider_unsupported", "the configured DNS provider is not supported")
			}
			credentialPayload, err := p.box.Open("cloud_credential_version", configuration.CloudCredential.VersionID, configuration.CloudCredential.CredentialsCiphertext)
			if err != nil {
				return job.Permanent("cloud_credential_unavailable", "could not decrypt the cloud credential")
			}
			cloudCredential, err = decodeCloudCredentials(credentialPayload)
			if err != nil {
				return job.Permanent("invalid_cloud_credential", "cloud credential payload is invalid")
			}
		}
		return nil
	}); err != nil {
		return err
	}

	issueContext, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	acmeClient := &acme.Client{Key: accountKey, DirectoryURL: configuration.ACMEAccount.DirectoryURL}
	if err := reporter.Step(issueContext, "ensure_acme_account", map[string]string{"directory_url": configuration.ACMEAccount.DirectoryURL}, func(ctx context.Context) error {
		account, err := acmeClient.GetReg(ctx, "")
		if err != nil {
			account, err = acmeClient.Register(ctx, &acme.Account{Contact: []string{"mailto:" + configuration.ACMEAccount.Email}}, acme.AcceptTOS)
		}
		if err != nil {
			return classifyACMEError(err)
		}
		if account == nil {
			return job.Permanent("invalid_acme_account", "ACME provider returned an empty account response")
		}
		if account.URI == "" {
			return job.Permanent("invalid_acme_account", "ACME provider did not return an account URL")
		}
		if err := p.store.SetACMEAccountURL(ctx, configuration.ACMEAccount.ID, account.URI); err != nil {
			return job.Retryable("acme_account_save_failed", "could not save ACME account registration", 0)
		}
		return nil
	}); err != nil {
		return err
	}
	if configuration.ValidationMode == "manual" {
		return p.handleManualDNS01(issueContext, claimed, reporter, configuration, acmeClient)
	}

	dnsClient := aliyundns.New()
	credentials := aliyundns.Credentials{AccessKeyID: cloudCredential.AccessKeyID, AccessKeySecret: cloudCredential.AccessKeySecret}
	if err := reporter.Step(issueContext, "verify_dns_credentials", nil, func(ctx context.Context) error {
		if _, err := dnsClient.ListZones(ctx, credentials); err != nil {
			return classifyDNSError(err)
		}
		return nil
	}); err != nil {
		return err
	}

	var order *acme.Order
	if err := reporter.Step(issueContext, "create_acme_order", map[string]int{"domain_count": len(configuration.Domains)}, func(ctx context.Context) error {
		var err error
		order, err = acmeClient.AuthorizeOrder(ctx, acme.DomainIDs(configuration.Domains...))
		if err != nil {
			return classifyACMEError(err)
		}
		if order.URI == "" || len(order.AuthzURLs) == 0 || order.FinalizeURL == "" {
			return job.Permanent("invalid_acme_order", "ACME provider returned an incomplete order")
		}
		return nil
	}); err != nil {
		return err
	}
	if order == nil {
		return job.Permanent("invalid_acme_order", "ACME provider returned an empty order response")
	}

	records := make([]aliyundns.RecordRef, 0, len(order.AuthzURLs))
	issueErr := reporter.StepResult(issueContext, "present_dns_challenges", map[string]int{"authorization_count": len(order.AuthzURLs)}, func(ctx context.Context) (any, error) {
		for _, authorizationURL := range order.AuthzURLs {
			authorization, err := acmeClient.GetAuthorization(ctx, authorizationURL)
			if err != nil {
				return recordSummary(records), classifyACMEError(err)
			}
			if authorization.Status == acme.StatusValid {
				continue
			}
			challenge := dnsChallenge(authorization)
			if challenge == nil {
				return recordSummary(records), job.Permanent("dns_challenge_unavailable", "ACME order does not offer a DNS-01 challenge")
			}
			value, err := acmeClient.DNS01ChallengeRecord(challenge.Token)
			if err != nil {
				return recordSummary(records), job.Permanent("invalid_dns_challenge", "could not create the ACME DNS challenge value")
			}
			challengeFQDN := "_acme-challenge." + strings.TrimPrefix(strings.ToLower(authorization.Identifier.Value), "*.")
			zone, err := dnsClient.ResolveZone(ctx, credentials, configuration.DNSAccount.AllowedZones, challengeFQDN)
			if err != nil {
				return recordSummary(records), classifyDNSError(err)
			}
			record, err := dnsClient.PresentTXT(ctx, credentials, zone, challengeFQDN, value)
			if err != nil {
				return recordSummary(records), classifyDNSError(err)
			}
			records = append(records, record)
		}
		return recordSummary(records), nil
	})
	if issueErr == nil {
		issueErr = reporter.Step(issueContext, "validate_acme_authorizations", map[string]int{"authorization_count": len(order.AuthzURLs)}, func(ctx context.Context) error {
			for _, authorizationURL := range order.AuthzURLs {
				authorization, err := acmeClient.GetAuthorization(ctx, authorizationURL)
				if err != nil {
					return classifyACMEError(err)
				}
				if authorization.Status == acme.StatusValid {
					continue
				}
				challenge := dnsChallenge(authorization)
				if challenge == nil {
					return job.Permanent("dns_challenge_unavailable", "ACME order does not offer a DNS-01 challenge")
				}
				if _, err := acmeClient.Accept(ctx, challenge); err != nil {
					return classifyACMEError(err)
				}
				if _, err := acmeClient.WaitAuthorization(ctx, authorizationURL); err != nil {
					return classifyACMEError(err)
				}
			}
			return nil
		})
	}

	cleanupErr := cleanupRecords(issueContext, reporter, dnsClient, credentials, records)
	if issueErr != nil {
		return issueErr
	}
	if cleanupErr != nil {
		return cleanupErr
	}

	return p.issueAndStore(issueContext, claimed, reporter, configuration, acmeClient, order.URI)
}

func (p *Processor) handleManualDNS01(ctx context.Context, claimed store.ClaimedJob, reporter *job.Reporter, configuration store.IssueConfiguration, acmeClient *acme.Client) error {
	challenge, err := p.store.GetManualChallenge(ctx, configuration.CertificateID)
	if err == nil && challenge.Status == "approved" {
		if err := reporter.Step(ctx, "validate_manual_dns_challenges", map[string]int{"authorization_count": len(challenge.AuthorizationURLs)}, func(ctx context.Context) error {
			for _, authorizationURL := range challenge.AuthorizationURLs {
				authorization, err := acmeClient.GetAuthorization(ctx, authorizationURL)
				if err != nil {
					return classifyACMEError(err)
				}
				if authorization.Status == acme.StatusValid {
					continue
				}
				dnsChallenge := dnsChallenge(authorization)
				if dnsChallenge == nil {
					return job.Permanent("dns_challenge_unavailable", "ACME order does not offer a DNS-01 challenge")
				}
				if _, err := acmeClient.Accept(ctx, dnsChallenge); err != nil {
					return classifyACMEError(err)
				}
				if _, err := acmeClient.WaitAuthorization(ctx, authorizationURL); err != nil {
					return classifyACMEError(err)
				}
			}
			return nil
		}); err != nil {
			return err
		}
		if err := p.issueAndStore(ctx, claimed, reporter, configuration, acmeClient, challenge.OrderURL); err != nil {
			return err
		}
		if err := p.store.ConsumeManualChallenge(ctx, claimed.ID); err != nil {
			return job.Retryable("manual_challenge_consume_failed", "certificate was issued but manual validation state could not be finalized", 0)
		}
		return nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return job.Retryable("manual_challenge_load_failed", "could not load manual DNS validation state", 0)
	}

	var order *acme.Order
	if err := reporter.Step(ctx, "create_acme_order", map[string]int{"domain_count": len(configuration.Domains)}, func(ctx context.Context) error {
		var err error
		order, err = acmeClient.AuthorizeOrder(ctx, acme.DomainIDs(configuration.Domains...))
		if err != nil {
			return classifyACMEError(err)
		}
		if order == nil || order.URI == "" || len(order.AuthzURLs) == 0 || order.FinalizeURL == "" {
			return job.Permanent("invalid_acme_order", "ACME provider returned an incomplete order")
		}
		return nil
	}); err != nil {
		return err
	}

	items := make([]store.ManualChallengeItem, 0, len(order.AuthzURLs))
	if err := reporter.Step(ctx, "prepare_manual_dns_challenges", map[string]int{"authorization_count": len(order.AuthzURLs)}, func(ctx context.Context) error {
		for _, authorizationURL := range order.AuthzURLs {
			authorization, err := acmeClient.GetAuthorization(ctx, authorizationURL)
			if err != nil {
				return classifyACMEError(err)
			}
			if authorization.Status == acme.StatusValid {
				continue
			}
			dnsChallenge := dnsChallenge(authorization)
			if dnsChallenge == nil {
				return job.Permanent("dns_challenge_unavailable", "ACME order does not offer a DNS-01 challenge")
			}
			value, err := acmeClient.DNS01ChallengeRecord(dnsChallenge.Token)
			if err != nil {
				return job.Permanent("invalid_dns_challenge", "could not create the ACME DNS challenge value")
			}
			domainName := strings.TrimPrefix(strings.ToLower(authorization.Identifier.Value), "*.")
			items = append(items, store.ManualChallengeItem{Domain: authorization.Identifier.Value, FQDN: "_acme-challenge." + domainName, Value: value})
		}
		return nil
	}); err != nil {
		return err
	}
	// ACME may reuse a still-valid authorization for a domain. In that case no
	// TXT record is needed, so waiting for a manual confirmation would be wrong.
	if len(items) == 0 {
		return p.issueAndStore(ctx, claimed, reporter, configuration, acmeClient, order.URI)
	}
	if err := p.store.SaveManualChallenge(ctx, store.ManualChallenge{ID: id.New(), JobID: claimed.ID, CertificateID: configuration.CertificateID, OrderURL: order.URI, AuthorizationURLs: order.AuthzURLs, Challenges: items}); err != nil {
		return job.Retryable("manual_challenge_save_failed", "could not save manual DNS validation instructions", 0)
	}
	return job.WaitingUser("manual_dns_required", "add the listed DNS TXT records and continue validation")
}

func (p *Processor) issueAndStore(ctx context.Context, claimed store.ClaimedJob, reporter *job.Reporter, configuration store.IssueConfiguration, acmeClient *acme.Client, orderURL string) error {
	return reporter.Step(ctx, "issue_and_store_certificate", map[string]int{"domain_count": len(configuration.Domains)}, func(ctx context.Context) error {
		readyOrder, err := acmeClient.WaitOrder(ctx, orderURL)
		if err != nil {
			return classifyACMEError(err)
		}
		certificateKey, privateKeyPEM, err := generateCertificateKey(configuration.KeyAlgorithm)
		if err != nil {
			return job.Permanent("invalid_key_algorithm", "certificate key algorithm is not supported")
		}
		csr, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: configuration.Domains[0]}, DNSNames: configuration.Domains}, certificateKey)
		if err != nil {
			return job.Permanent("csr_generation_failed", "could not create certificate request")
		}
		derChain, _, err := acmeClient.CreateOrderCert(ctx, readyOrder.FinalizeURL, csr, true)
		if err != nil {
			return classifyACMEError(err)
		}
		material, err := buildCertificateMaterial(configuration, claimed, certificateKey, privateKeyPEM, derChain, p.box)
		if err != nil {
			return job.Permanent("invalid_issued_certificate", "ACME provider returned a certificate that failed validation")
		}
		if err := p.store.SaveCertificateVersion(ctx, material); err != nil {
			return job.Retryable("certificate_version_save_failed", "could not store the issued certificate", 0)
		}
		return nil
	})
}

func dnsChallenge(authorization *acme.Authorization) *acme.Challenge {
	for _, challenge := range authorization.Challenges {
		if challenge.Type == "dns-01" {
			return challenge
		}
	}
	return nil
}

func cleanupRecords(ctx context.Context, reporter *job.Reporter, client *aliyundns.Client, credentials aliyundns.Credentials, records []aliyundns.RecordRef) error {
	if len(records) == 0 {
		return nil
	}
	return reporter.Step(ctx, "cleanup_dns_challenges", map[string]int{"record_count": len(records)}, func(ctx context.Context) error {
		for _, record := range records {
			if err := client.CleanupTXT(ctx, credentials, record); err != nil {
				return classifyDNSError(err)
			}
		}
		return nil
	})
}

func recordSummary(records []aliyundns.RecordRef) map[string]any {
	items := make([]map[string]string, 0, len(records))
	for _, record := range records {
		items = append(items, map[string]string{"record_id": record.RecordID, "zone": record.Zone, "fqdn": record.FQDN})
	}
	return map[string]any{"records": items}
}

func classifyDNSError(err error) error {
	var providerError *aliyundns.Error
	if !errors.As(err, &providerError) {
		return job.Retryable("dns_operation_failed", "Aliyun DNS operation failed", 0)
	}
	switch providerError.Code {
	case "dns_api_unavailable", "dns_api_error":
		return job.Retryable(providerError.Code, providerError.Message, 0)
	case "credentials_missing", "zone_not_allowed", "zone_mismatch", "invalid_txt_value", "record_not_owned":
		return job.Permanent(providerError.Code, providerError.Message)
	default:
		return job.Permanent(providerError.Code, providerError.Message)
	}
}

func classifyACMEError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return job.Retryable("acme_timeout", "ACME operation timed out", 0)
	}
	var providerError *acme.Error
	if errors.As(err, &providerError) && (providerError.StatusCode == 429 || providerError.StatusCode >= 500) {
		return job.Retryable("acme_unavailable", "ACME provider is temporarily unavailable", 0)
	}
	return job.Permanent("acme_operation_failed", "ACME provider rejected the certificate request")
}

func generateCertificateKey(algorithm string) (crypto.Signer, []byte, error) {
	switch algorithm {
	case "rsa_2048":
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			return nil, nil, err
		}
		return key, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}), nil
	case "rsa_4096":
		key, err := rsa.GenerateKey(rand.Reader, 4096)
		if err != nil {
			return nil, nil, err
		}
		return key, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}), nil
	case "ecdsa_p256":
		return generateECKey(elliptic.P256())
	case "ecdsa_p384":
		return generateECKey(elliptic.P384())
	default:
		return nil, nil, fmt.Errorf("unsupported key algorithm")
	}
}

func generateECKey(curve elliptic.Curve) (crypto.Signer, []byte, error) {
	key, err := ecdsa.GenerateKey(curve, rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	encoded, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, nil, err
	}
	return key, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: encoded}), nil
}

func buildCertificateMaterial(configuration store.IssueConfiguration, claimed store.ClaimedJob, privateKey crypto.Signer, privateKeyPEM []byte, derChain [][]byte, box *cryptobox.Box) (store.CertificateVersionMaterial, error) {
	if len(derChain) == 0 {
		return store.CertificateVersionMaterial{}, fmt.Errorf("empty certificate chain")
	}
	leaf, err := x509.ParseCertificate(derChain[0])
	if err != nil {
		return store.CertificateVersionMaterial{}, err
	}
	if !leaf.NotAfter.After(leaf.NotBefore) {
		return store.CertificateVersionMaterial{}, fmt.Errorf("invalid validity period")
	}
	for _, domain := range configuration.Domains {
		if !containsDomain(leaf.DNSNames, domain) {
			return store.CertificateVersionMaterial{}, fmt.Errorf("issued certificate is missing domain")
		}
	}
	certificatePublic, err := x509.MarshalPKIXPublicKey(leaf.PublicKey)
	if err != nil {
		return store.CertificateVersionMaterial{}, err
	}
	keyPublic, err := x509.MarshalPKIXPublicKey(privateKey.Public())
	if err != nil || !bytes.Equal(certificatePublic, keyPublic) {
		return store.CertificateVersionMaterial{}, fmt.Errorf("certificate key mismatch")
	}
	versionID := id.New()
	leafPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: derChain[0]})
	chainPEM := make([]byte, 0)
	for _, der := range derChain[1:] {
		chainPEM = append(chainPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})...)
	}
	certificateCiphertext, err := box.Seal("certificate_version", versionID, leafPEM)
	if err != nil {
		return store.CertificateVersionMaterial{}, err
	}
	privateKeyCiphertext, err := box.Seal("certificate_version", versionID, privateKeyPEM)
	if err != nil {
		return store.CertificateVersionMaterial{}, err
	}
	chainCiphertext, err := box.Seal("certificate_version", versionID, chainPEM)
	if err != nil {
		return store.CertificateVersionMaterial{}, err
	}
	fingerprint := sha256.Sum256(derChain[0])
	return store.CertificateVersionMaterial{ID: versionID, CertificateID: configuration.CertificateID, ExecutionID: claimed.ExecutionID, CertificateCiphertext: certificateCiphertext, PrivateKeyCiphertext: privateKeyCiphertext, ChainCiphertext: chainCiphertext, SerialNumber: serialString(leaf.SerialNumber), Fingerprint: hex.EncodeToString(fingerprint[:]), NotBefore: leaf.NotBefore, NotAfter: leaf.NotAfter}, nil
}

func containsDomain(domains []string, wanted string) bool {
	for _, domain := range domains {
		if strings.EqualFold(domain, wanted) {
			return true
		}
	}
	return false
}
func serialString(value *big.Int) string {
	if value == nil {
		return ""
	}
	return strings.ToUpper(value.Text(16))
}

type cloudCredentials struct {
	AccessKeyID     string `json:"access_key_id"`
	AccessKeySecret string `json:"access_key_secret"`
}

func decodeCloudCredentials(payload []byte) (cloudCredentials, error) {
	var credentials cloudCredentials
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&credentials); err != nil {
		return cloudCredentials{}, err
	}
	if credentials.AccessKeyID == "" || credentials.AccessKeySecret == "" {
		return cloudCredentials{}, fmt.Errorf("access key fields are required")
	}
	return credentials, nil
}

func parseSigner(privateKeyPEM []byte) (crypto.Signer, error) {
	remaining := privateKeyPEM
	for {
		block, rest := pem.Decode(remaining)
		if block == nil {
			break
		}
		remaining = rest
		if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
			switch key := key.(type) {
			case *rsa.PrivateKey:
				return key, nil
			case *ecdsa.PrivateKey:
				return key, nil
			default:
				continue
			}
		}
		if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
			return key, nil
		}
		if key, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
			return key, nil
		}
	}
	if len(privateKeyPEM) == 0 {
		return nil, fmt.Errorf("PEM block is missing")
	}
	return nil, fmt.Errorf("unsupported private key encoding")
}
