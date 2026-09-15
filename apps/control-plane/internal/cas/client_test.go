package cas

import (
	"encoding/json"
	"testing"
)

func TestUploadUserCertificateIDSupportsStringAndNumber(t *testing.T) {
	for _, test := range []struct {
		name string
		body string
		want string
	}{
		{name: "string", body: `"cert-123"`, want: "cert-123"},
		{name: "number", body: `12345`, want: "12345"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var raw json.RawMessage = []byte(test.body)
			got, err := parseCertificateID(raw)
			if err != nil {
				t.Fatalf("decode certificate id: %v", err)
			}
			if got != test.want {
				t.Fatalf("certificate id = %q, want %q", got, test.want)
			}
		})
	}
}
