// Package renewal schedules certificate renewals from their persisted expiry.
package renewal

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/regenbio/certflow/apps/control-plane/internal/store"
)

const defaultInterval = time.Hour

// Observer keeps scheduling telemetry decoupled from the metrics backend.
type Observer interface {
	SchedulerFinished(status string, queued int, duration time.Duration)
	SetCertificatesExpiring(window string, count int)
}

type noopObserver struct{}

func (noopObserver) SchedulerFinished(string, int, time.Duration) {}
func (noopObserver) SetCertificatesExpiring(string, int)          {}

type Scheduler struct {
	store    *store.Store
	logger   *slog.Logger
	interval time.Duration
	observer Observer
}

func New(s *store.Store, logger *slog.Logger, observers ...Observer) *Scheduler {
	scheduler := &Scheduler{store: s, logger: logger, interval: defaultInterval, observer: noopObserver{}}
	if len(observers) > 0 && observers[0] != nil {
		scheduler.observer = observers[0]
	}
	return scheduler
}

func (s *Scheduler) Run(ctx context.Context) {
	s.scan(ctx)
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.scan(ctx)
		}
	}
}

func (s *Scheduler) scan(ctx context.Context) {
	started := time.Now()
	count, err := s.store.QueueDueAutomationTasks(ctx)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			s.logger.Error("queue due automation tasks", "error", err)
			s.observer.SchedulerFinished("failed", 0, time.Since(started))
		}
		return
	}
	s.observer.SchedulerFinished("succeeded", count, time.Since(started))
	s.refreshCertificateExpiry(ctx)
	if count > 0 {
		s.logger.Info("queued due automation jobs", "count", count)
	}
}

func (s *Scheduler) refreshCertificateExpiry(ctx context.Context) {
	within7Days, within30Days, err := s.store.CertificateExpiringCounts(ctx)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			s.logger.Warn("count expiring certificates", "error", err)
		}
		return
	}
	s.observer.SetCertificatesExpiring("7d", within7Days)
	s.observer.SetCertificatesExpiring("30d", within30Days)
}
