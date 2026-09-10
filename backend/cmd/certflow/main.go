package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/regenbio/certflow/internal/certupload"
	"github.com/regenbio/certflow/internal/config"
	"github.com/regenbio/certflow/internal/cryptobox"
	"github.com/regenbio/certflow/internal/deployment"
	"github.com/regenbio/certflow/internal/httpapi"
	"github.com/regenbio/certflow/internal/issuance"
	"github.com/regenbio/certflow/internal/job"
	"github.com/regenbio/certflow/internal/renewal"
	"github.com/regenbio/certflow/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	config, err := config.Load()
	if err != nil {
		logger.Error("configuration validation failed", "error", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	box, err := cryptobox.New(config.EncryptionKey)
	if err != nil {
		logger.Error("encryption configuration failed", "error", err)
		os.Exit(1)
	}

	database, err := store.New(ctx, config.DatabaseURL)
	if err != nil {
		logger.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	if err := database.Migrate(ctx); err != nil {
		logger.Error("database migration failed", "error", err)
		os.Exit(1)
	}
	if _, err := database.EnsureBootstrapAdmin(ctx, config.AdminEmail, config.AdminPassword); err != nil {
		logger.Error("bootstrap administrator initialization failed", "error", err)
		os.Exit(1)
	}

	server := &http.Server{
		Addr:              config.Addr,
		Handler:           httpapi.New(database, box, time.Duration(config.SessionTTL)*time.Hour, time.Duration(config.SessionIdle)*time.Minute).Router(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	worker := job.New(database, logger)
	issuanceProcessor := issuance.New(database, box)
	worker.Register("issue", issuanceProcessor.Handle)
	worker.Register("renew", issuanceProcessor.Handle)
	worker.Register("upload", certupload.New(database, box).Handle)
	worker.Register("deploy", deployment.New(database, box).Handle)
	renewalScheduler := renewal.New(database, logger)
	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		worker.Run(ctx)
	}()
	go renewalScheduler.Run(ctx)

	go func() {
		logger.Info("certflow api started", "address", config.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("http server failed", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("http shutdown failed", "error", err)
	}
	select {
	case <-workerDone:
	case <-shutdownCtx.Done():
		logger.Warn("worker shutdown timed out")
	}
}
