package mailer

import (
	"errors"
	"testing"

	"github.com/regenbio/certflow/apps/control-plane/internal/store"
)

func TestValidateSettings(t *testing.T) {
	tests := []struct {
		name     string
		settings store.SMTPSettings
		wantErr  error
	}{
		{
			name:     "rejects STARTTLS on implicit TLS port",
			settings: store.SMTPSettings{Port: 465, EncryptPort: 465, EncryptType: "STARTTLS"},
			wantErr:  ErrImplicitTLSRequired,
		},
		{
			name:     "accepts SSL on implicit TLS port",
			settings: store.SMTPSettings{Port: 465, EncryptPort: 465, EncryptType: "SSL"},
		},
		{
			name:     "accepts STARTTLS on submission port",
			settings: store.SMTPSettings{Port: 587, EncryptPort: 587, EncryptType: "STARTTLS"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateSettings(test.settings)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("ValidateSettings() error = %v, want %v", err, test.wantErr)
			}
		})
	}
}
