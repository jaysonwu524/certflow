package httpapi

import (
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"strings"
	"testing"

	"github.com/regenbio/certflow/apps/control-plane/internal/cloudprovider"
	"github.com/regenbio/certflow/apps/control-plane/internal/domain"
)

func TestInvalidDNSZonesOnlyReturnsZonesOutsideProviderAllowlist(t *testing.T) {
	available := []cloudprovider.DNSZone{{Name: "example.com"}, {Name: "aicun-ai.cn"}}
	got := invalidDNSZones(available, []string{"example.com", "missing.test", "AICUN-AI.CN"})
	if len(got) != 1 || got[0] != "missing.test" {
		t.Fatalf("invalid zones = %#v, want [missing.test]", got)
	}
}

func TestValidateDNSAccountDescriptionLimit(t *testing.T) {
	input := domain.CreateDNSAccountInput{Name: "dns", CloudCredentialID: "credential", AllowedZones: []string{"example.com"}, Description: string(make([]byte, 241))}
	if err := validateDNSAccount(input); err == nil {
		t.Fatal("expected an overlong DNS description to be rejected")
	}
}

func TestValidateCertificateRejectsExactDomainCoveredByWildcard(t *testing.T) {
	input := domain.CreateCertificateInput{
		Name: "production", AcmeAccountID: "acme", DefaultDNSAccountID: "dns", ValidationMode: "auto", KeyAlgorithm: "ecdsa_p256", RenewBeforeDays: 30,
		Domains: []string{"example.com", "*.example.com", "api.example.com", "*.api.example.com"},
	}
	if err := validateCertificate(input); err == nil || !strings.Contains(err.Error(), "api.example.com") {
		t.Fatalf("expected redundant exact domain error, got %v", err)
	}
}

func TestGenerateACMEPrivateKey(t *testing.T) {
	tests := []struct {
		algorithm string
		check     func(t *testing.T, key any)
	}{
		{
			algorithm: "ecdsa_p256",
			check: func(t *testing.T, key any) {
				privateKey, ok := key.(*ecdsa.PrivateKey)
				if !ok || privateKey.Curve.Params().Name != "P-256" {
					t.Fatalf("expected ECDSA P-256 key, got %T", key)
				}
			},
		},
		{
			algorithm: "ecdsa_p384",
			check: func(t *testing.T, key any) {
				privateKey, ok := key.(*ecdsa.PrivateKey)
				if !ok || privateKey.Curve.Params().Name != "P-384" {
					t.Fatalf("expected ECDSA P-384 key, got %T", key)
				}
			},
		},
		{
			algorithm: "rsa_2048",
			check: func(t *testing.T, key any) {
				privateKey, ok := key.(*rsa.PrivateKey)
				if !ok || privateKey.N.BitLen() != 2048 {
					t.Fatalf("expected RSA 2048 key, got %T with %d bits", key, privateKey.N.BitLen())
				}
			},
		},
		{
			algorithm: "rsa_4096",
			check: func(t *testing.T, key any) {
				privateKey, ok := key.(*rsa.PrivateKey)
				if !ok || privateKey.N.BitLen() != 4096 {
					t.Fatalf("expected RSA 4096 key, got %T with %d bits", key, privateKey.N.BitLen())
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.algorithm, func(t *testing.T) {
			encoded, err := generateACMEPrivateKey(test.algorithm)
			if err != nil {
				t.Fatalf("generate key: %v", err)
			}
			block, _ := pem.Decode(encoded)
			if block == nil || block.Type != "PRIVATE KEY" {
				t.Fatalf("expected PRIVATE KEY PEM block")
			}
			key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
			if err != nil {
				t.Fatalf("parse generated PKCS#8 key: %v", err)
			}
			test.check(t, key)
			if err := validateACMEPrivateKey(encoded); err != nil {
				t.Fatalf("generated key should validate: %v", err)
			}
		})
	}
}

func TestValidateACMEAccountAllowsGeneratedPrivateKey(t *testing.T) {
	input := domain.CreateACMEAccountInput{
		Name:                "Let's Encrypt",
		DirectoryURL:        "https://acme-v02.api.letsencrypt.org/directory",
		Email:               "ops@example.com",
		PrivateKeyAlgorithm: "ecdsa_p256",
	}
	if err := validateACMEAccount(input); err != nil {
		t.Fatalf("empty private key should be accepted: %v", err)
	}
}

func TestValidateACMEAccountRejectsInvalidPrivateKey(t *testing.T) {
	input := domain.CreateACMEAccountInput{
		Name:                "Let's Encrypt",
		DirectoryURL:        "https://acme-v02.api.letsencrypt.org/directory",
		Email:               "ops@example.com",
		PrivateKey:          "not-a-private-key",
		PrivateKeyAlgorithm: "ecdsa_p256",
	}
	if err := validateACMEAccount(input); err == nil {
		t.Fatal("invalid private key should be rejected")
	}
}

func TestValidateAutomation(t *testing.T) {
	valid := domain.CreateAutomationTaskInput{
		Name:                "renew production",
		CertificateID:       "certificate-1",
		ActionType:          "deploy_alb",
		IntervalMinutes:     60,
		DeploymentTargetIDs: []string{"target-1"},
	}
	if err := validateAutomation(valid); err != nil {
		t.Fatalf("valid automation rejected: %v", err)
	}
	if err := validateAutomation(domain.CreateAutomationTaskInput{Name: "upload certificate", CertificateID: "certificate-1", ActionType: "upload_ssl", CloudCredentialID: "credential-1"}); err != nil {
		t.Fatalf("valid upload automation rejected: %v", err)
	}
	for _, test := range []domain.CreateAutomationTaskInput{
		{Name: "missing certificate", ActionType: "renew_certificate", IntervalMinutes: 60},
		{Name: "bad action", CertificateID: "certificate-1", ActionType: "deploy", IntervalMinutes: 60},
		{Name: "bad interval", CertificateID: "certificate-1", ActionType: "renew_certificate", IntervalMinutes: 30},
		{Name: "missing upload credential", CertificateID: "certificate-1", ActionType: "upload_ssl"},
		{Name: "missing target", CertificateID: "certificate-1", ActionType: "deploy_alb"},
	} {
		if err := validateAutomation(test); err == nil {
			t.Fatalf("expected automation validation failure for %#v", test)
		}
	}
}
