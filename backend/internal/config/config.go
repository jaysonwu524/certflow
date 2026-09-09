package config

import "os"

type Config struct {
	Addr          string
	DatabaseURL   string
	EncryptionKey string
}

func Load() Config {
	return Config{
		Addr:          valueOrDefault("CERTFLOW_ADDR", ":8080"),
		DatabaseURL:   valueOrDefault("DATABASE_URL", "postgres://certflow:certflow@localhost:5432/certflow?sslmode=disable"),
		EncryptionKey: os.Getenv("CERTFLOW_ENCRYPTION_KEY"),
	}
}

func valueOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}

	return fallback
}
