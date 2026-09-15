package httpapi

import (
	"context"
	"net"
	"testing"
)

func TestIsPublicWebhookIP(t *testing.T) {
	tests := []struct {
		value string
		want  bool
	}{
		{value: "8.8.8.8", want: true},
		{value: "10.0.0.1", want: false},
		{value: "127.0.0.1", want: false},
		{value: "169.254.169.254", want: false},
		{value: "100.64.0.1", want: false},
		{value: "::1", want: false},
		{value: "fc00::1", want: false},
	}
	for _, test := range tests {
		t.Run(test.value, func(t *testing.T) {
			if got := isPublicWebhookIP(net.ParseIP(test.value)); got != test.want {
				t.Fatalf("isPublicWebhookIP(%s) = %t, want %t", test.value, got, test.want)
			}
		})
	}
}

func TestValidateWebhookURLRejectsUnsafeTargets(t *testing.T) {
	tests := []string{
		"http://example.com/events",
		"https://127.0.0.1/events",
		"https://10.0.0.1/events",
		"https://example.com:8443/events",
	}
	for _, target := range tests {
		t.Run(target, func(t *testing.T) {
			if err := validateWebhookURL(context.Background(), target); err == nil {
				t.Fatalf("validateWebhookURL(%q) accepted an unsafe target", target)
			}
		})
	}
}
