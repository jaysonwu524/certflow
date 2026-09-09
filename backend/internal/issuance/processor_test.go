package issuance

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"math/big"
	"testing"
	"time"

	"github.com/regenbio/certflow/internal/cryptobox"
	"github.com/regenbio/certflow/internal/store"
)

func TestDecodeCloudCredentials(t *testing.T) {
	credentials, err := decodeCloudCredentials([]byte(`{"access_key_id":"key","access_key_secret":"secret"}`))
	if err != nil {
		t.Fatalf("decode credentials: %v", err)
	}
	if credentials.AccessKeyID != "key" || credentials.AccessKeySecret != "secret" {
		t.Fatalf("unexpected credentials: %#v", credentials)
	}
	if _, err := decodeCloudCredentials([]byte(`{"access_key_id":"key"}`)); err == nil {
		t.Fatal("expected missing secret to fail")
	}
}

func TestParseSignerAcceptsECDSAPKCS8(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	pemKey := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded})
	parsed, err := parseSigner(pemKey)
	if err != nil {
		t.Fatalf("parse signer: %v", err)
	}
	if _, ok := parsed.(*ecdsa.PrivateKey); !ok {
		t.Fatalf("unexpected key type %T", parsed)
	}
}

func TestParseSignerSkipsECParametersBlock(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	encoded, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	pemKey := append(pem.EncodeToMemory(&pem.Block{Type: "EC PARAMETERS", Bytes: []byte("parameters")}), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: encoded})...)
	if _, err := parseSigner(pemKey); err != nil {
		t.Fatalf("parse signer with parameters block: %v", err)
	}
}

func TestBuildCertificateMaterialEncryptsValidatedMaterial(t *testing.T) {
	signer, privateKeyPEM, err := generateCertificateKey("ecdsa_p256")
	if err != nil {
		t.Fatalf("generate certificate key: %v", err)
	}
	now := time.Now().UTC()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(42),
		Subject:      pkix.Name{CommonName: "example.com"},
		DNSNames:     []string{"example.com", "*.example.com", "*.api.example.com"},
		NotBefore:    now.Add(-time.Minute),
		NotAfter:     now.Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, signer.Public(), signer)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	box, err := cryptobox.New(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatalf("create box: %v", err)
	}
	configuration := store.IssueConfiguration{CertificateID: "certificate-1", Domains: template.DNSNames}
	material, err := buildCertificateMaterial(configuration, store.ClaimedJob{ExecutionID: "execution-1"}, signer, privateKeyPEM, [][]byte{der}, box)
	if err != nil {
		t.Fatalf("build material: %v", err)
	}
	if material.SerialNumber != "2A" || material.Fingerprint == "" {
		t.Fatalf("unexpected material metadata: %#v", material)
	}
	plaintext, err := box.Open("certificate_version", material.ID, material.PrivateKeyCiphertext)
	if err != nil || string(plaintext) != string(privateKeyPEM) {
		t.Fatalf("private key ciphertext did not decrypt: %v", err)
	}
}
