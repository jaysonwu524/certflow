package config

import (
	"encoding/base64"
	"os"
	"testing"
)

func TestLoadValidatesRequiredConfiguration(t *testing.T) {
	t.Setenv("CERTFLOW_ADDR", ":18080")
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/certflow?sslmode=disable")
	t.Setenv("CERTFLOW_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	got, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got.Addr != ":18080" || got.DatabaseURL == "" {
		t.Fatalf("unexpected config: %#v", got)
	}
}

func TestLoadRejectsInvalidEncryptionKey(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/certflow")
	t.Setenv("CERTFLOW_ENCRYPTION_KEY", "invalid")
	if _, err := Load(); err == nil {
		t.Fatal("expected invalid encryption key error")
	}
}

func TestLoadRejectsInvalidDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "mysql://user:pass@localhost:3306/certflow")
	t.Setenv("CERTFLOW_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if _, err := Load(); err == nil {
		t.Fatal("expected invalid database URL error")
	}
}

func TestValueOrDefault(t *testing.T) {
	const key = "CERTFLOW_TEST_DEFAULT"
	_ = os.Unsetenv(key)
	if got := valueOrDefault(key, "fallback"); got != "fallback" {
		t.Fatalf("valueOrDefault() = %q", got)
	}
	t.Setenv(key, "configured")
	if got := valueOrDefault(key, "fallback"); got != "configured" {
		t.Fatalf("valueOrDefault() = %q", got)
	}
}
