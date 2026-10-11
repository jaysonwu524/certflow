package httpapi

import (
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/regenbio/certflow/apps/control-plane/internal/cloudprovider"
	"github.com/regenbio/certflow/apps/control-plane/internal/domain"
)

func TestMetricsEndpointRecordsRouteWithoutRecordingScrapes(t *testing.T) {
	server := New(nil, nil)
	router := server.Router()

	health := httptest.NewRecorder()
	router.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if health.Code != http.StatusOK {
		t.Fatalf("health status = %d, want %d", health.Code, http.StatusOK)
	}

	metrics := httptest.NewRecorder()
	router.ServeHTTP(metrics, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if metrics.Code != http.StatusOK {
		t.Fatalf("metrics status = %d, want %d", metrics.Code, http.StatusOK)
	}
	body := metrics.Body.String()
	if !strings.Contains(body, `certflow_http_requests_total{method="GET",route="/healthz",status="200"} 1`) {
		t.Fatalf("metrics response did not include the health route counter: %s", body)
	}
	if strings.Contains(body, `route="/metrics"`) {
		t.Fatalf("metrics scrape must not create a /metrics request series: %s", body)
	}
}

func TestMetricsResponseWriterSupportsStreamingFlush(t *testing.T) {
	var _ http.Flusher = (*metricsResponseWriter)(nil)
	recorder := httptest.NewRecorder()
	writer := &metricsResponseWriter{ResponseWriter: recorder, status: http.StatusOK}
	writer.Flush()
	if recorder.Code != http.StatusOK {
		t.Fatalf("flush status = %d, want %d", recorder.Code, http.StatusOK)
	}
}

func TestAuditResourceOnlyUsesCanonicalUUIDPathParameters(t *testing.T) {
	tests := []struct {
		path         string
		resourceType string
		resourceID   string
	}{
		{"/api/v1/cloud-credentials/11111111-1111-1111-1111-111111111111/verify", "cloud-credential", "11111111-1111-1111-1111-111111111111"},
		{"/api/v1/certificates/not-a-uuid/issue", "certificate", ""},
		{"/api/v1/profile/webhook", "profile", ""},
		{"/healthz", "api", ""},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			resourceType, resourceID := auditResource(httptest.NewRequest("POST", test.path, nil))
			if resourceType != test.resourceType || resourceID != test.resourceID {
				t.Fatalf("auditResource() = (%q, %q), want (%q, %q)", resourceType, resourceID, test.resourceType, test.resourceID)
			}
		})
	}
}

func TestRequestSourceIPUsesRemoteAddressWithoutForwardedTrust(t *testing.T) {
	request := httptest.NewRequest("POST", "/api/v1/certificates", nil)
	request.RemoteAddr = "203.0.113.12:443"
	request.Header.Set("X-Forwarded-For", "198.51.100.1")
	if got, want := requestSourceIP(request), "203.0.113.12"; got != want {
		t.Fatalf("requestSourceIP() = %q, want %q", got, want)
	}
}

func TestNotificationPagination(t *testing.T) {
	tests := []struct {
		path         string
		wantPage     int
		wantPageSize int
		wantError    bool
	}{
		{"/api/v1/notifications", 1, 20, false},
		{"/api/v1/notifications?page=3&pageSize=50", 3, 50, false},
		{"/api/v1/notifications?page=0", 0, 0, true},
		{"/api/v1/notifications?pageSize=101", 0, 0, true},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			page, pageSize, err := notificationPagination(httptest.NewRequest("GET", test.path, nil))
			if (err != nil) != test.wantError {
				t.Fatalf("notificationPagination() error = %v, wantError %v", err, test.wantError)
			}
			if !test.wantError && (page != test.wantPage || pageSize != test.wantPageSize) {
				t.Fatalf("notificationPagination() = (%d, %d), want (%d, %d)", page, pageSize, test.wantPage, test.wantPageSize)
			}
		})
	}
}

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
