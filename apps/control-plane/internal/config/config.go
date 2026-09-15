package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	Addr          string
	DatabaseURL   string
	EncryptionKey string
	AdminEmail    string
	AdminPassword string
	SessionTTL    int
	SessionIdle   int
}

func Load() (Config, error) {
	config := Config{
		Addr:          valueOrDefault("CERTFLOW_ADDR", ":8080"),
		DatabaseURL:   valueOrDefault("DATABASE_URL", "postgres://certflow:certflow@localhost:5432/certflow?sslmode=disable"),
		EncryptionKey: strings.TrimSpace(os.Getenv("CERTFLOW_ENCRYPTION_KEY")),
		AdminEmail:    valueOrDefault("CERTFLOW_ADMIN_EMAIL", "admin@localhost"),
		AdminPassword: valueOrDefault("CERTFLOW_ADMIN_PASSWORD", "admin"),
		SessionTTL:    intValueOrDefault("CERTFLOW_SESSION_TTL_HOURS", 8),
		SessionIdle:   intValueOrDefault("CERTFLOW_SESSION_IDLE_MINUTES", 30),
	}
	if err := config.Validate(); err != nil {
		return Config{}, err
	}
	return config, nil
}

func (c Config) Validate() error {
	if strings.TrimSpace(c.Addr) == "" {
		return errors.New("CERTFLOW_ADDR is required")
	}
	databaseURL, err := url.Parse(c.DatabaseURL)
	if err != nil || databaseURL.Host == "" || (databaseURL.Scheme != "postgres" && databaseURL.Scheme != "postgresql") {
		return errors.New("DATABASE_URL must be a valid postgres or postgresql URL")
	}
	if c.EncryptionKey == "" {
		return errors.New("CERTFLOW_ENCRYPTION_KEY is required")
	}
	key, err := base64.StdEncoding.DecodeString(c.EncryptionKey)
	if err != nil || len(key) != 32 {
		return errors.New("CERTFLOW_ENCRYPTION_KEY must be Base64 encoded 32 bytes")
	}
	if strings.TrimSpace(c.AdminEmail) == "" || strings.TrimSpace(c.AdminPassword) == "" {
		return errors.New("CERTFLOW_ADMIN_EMAIL and CERTFLOW_ADMIN_PASSWORD must not be empty")
	}
	if c.SessionTTL < 1 || c.SessionTTL > 720 || c.SessionIdle < 1 || c.SessionIdle > 1440 {
		return errors.New("session TTL and idle timeout are outside the supported range")
	}
	return nil
}

func valueOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}

	return fallback
}

func intValueOrDefault(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	var parsed int
	if _, err := fmt.Sscanf(value, "%d", &parsed); err != nil {
		return -1
	}
	return parsed
}
