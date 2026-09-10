// Package renewal schedules certificate renewals from their persisted expiry.
package renewal

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/regenbio/certflow/internal/store"
)

const defaultInterval = time.Hour

type Scheduler struct {
	store    *store.Store
	logger   *slog.Logger
	interval time.Duration
}

func New(s *store.Store, logger *slog.Logger) *Scheduler {
	return &Scheduler{store: s, logger: logger, interval: defaultInterval}
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
	count, err := s.store.QueueDueAutomationTasks(ctx)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			s.logger.Error("queue certificate renewals", "error", err)
		}
		return
	}
	if count > 0 {
		s.logger.Info("queued certificate renewals", "count", count)
	}
}
