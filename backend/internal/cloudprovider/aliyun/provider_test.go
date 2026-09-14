package aliyun

import (
	"testing"

	"github.com/regenbio/certflow/internal/cloudprovider"
)

func TestProviderCredentialsRoundTrip(t *testing.T) {
	provider := New()
	credentials, err := provider.CredentialsFromMap(map[string]interface{}{
		"accessKeyId":     "LTAI-test",
		"accessKeySecret": "test-secret",
	})
	if err != nil {
		t.Fatalf("create credentials: %v", err)
	}
	if hint := provider.GetCredentialHint(credentials); hint != "****test" {
		t.Fatalf("credential hint = %q, want %q", hint, "****test")
	}

	payload, err := credentials.Marshal()
	if err != nil {
		t.Fatalf("marshal credentials: %v", err)
	}
	restored, err := provider.UnmarshalCredentials(payload)
	if err != nil {
		t.Fatalf("unmarshal credentials: %v", err)
	}
	if restored.Provider() != "aliyun" {
		t.Fatalf("provider = %q, want aliyun", restored.Provider())
	}
}

func TestProviderRegistersItsStrategy(t *testing.T) {
	provider, err := cloudprovider.Get("aliyun")
	if err != nil {
		t.Fatalf("get registered provider: %v", err)
	}
	if provider.Name() != "aliyun" {
		t.Fatalf("provider name = %q, want aliyun", provider.Name())
	}
}
