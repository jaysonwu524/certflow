package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
)

var databaseNamePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)

func main() {
	adminURL := os.Getenv("CERTFLOW_ADMIN_DATABASE_URL")
	if adminURL == "" {
		log.Fatal("CERTFLOW_ADMIN_DATABASE_URL is required")
	}

	databaseName := valueOrDefault("CERTFLOW_DATABASE_NAME", "certflow")
	if !databaseNamePattern.MatchString(databaseName) {
		log.Fatal("CERTFLOW_DATABASE_NAME must start with a lowercase letter and contain only lowercase letters, digits, or underscores")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	connection, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		log.Fatalf("connect admin database: %v", err)
	}
	defer connection.Close(ctx)

	var exists bool
	if err := connection.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)`, databaseName).Scan(&exists); err != nil {
		log.Fatalf("check database: %v", err)
	}
	if exists {
		log.Printf("database %q already exists", databaseName)
		return
	}

	if _, err := connection.Exec(ctx, fmt.Sprintf("CREATE DATABASE %s", databaseName)); err != nil {
		log.Fatalf("create database: %v", err)
	}
	log.Printf("database %q created", databaseName)
}

func valueOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
