// Package job provides the durable worker runtime shared by issuance,
// deployment and notification handlers.
package job

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/regenbio/certflow/internal/id"
	"github.com/regenbio/certflow/internal/store"
)

const (
	defaultPollInterval = time.Second
	// ACME orders and DNS propagation can legitimately take several minutes.
	// The worker still has lease recovery, but the normal lease must exceed the
	// provider polling window to avoid duplicate attempts.
	defaultLeaseDuration = 15 * time.Minute
)

// Error identifies a safe, user-visible failure category. Handler code must
// never return raw provider responses because those can contain credentials.
type Error struct {
	Code        string
	Message     string
	Retryable   bool
	RetryAfter  time.Duration
	WaitingUser bool
}

func (e *Error) Error() string { return e.Message }

func Permanent(code, message string) error {
	return &Error{Code: code, Message: message}
}

func Retryable(code, message string, retryAfter time.Duration) error {
	return &Error{Code: code, Message: message, Retryable: true, RetryAfter: retryAfter}
}

func WaitingUser(code, message string) error {
	return &Error{Code: code, Message: message, WaitingUser: true}
}

type Handler func(context.Context, store.ClaimedJob, *Reporter) error

type Worker struct {
	store         *store.Store
	logger        *slog.Logger
	workerID      string
	pollInterval  time.Duration
	leaseDuration time.Duration
	handlers      map[string]Handler
}

func New(s *store.Store, logger *slog.Logger) *Worker {
	hostname, err := os.Hostname()
	if err != nil || hostname == "" {
		hostname = "certflow"
	}
	return &Worker{
		store:         s,
		logger:        logger,
		workerID:      hostname + ":" + id.New(),
		pollInterval:  defaultPollInterval,
		leaseDuration: defaultLeaseDuration,
		handlers:      make(map[string]Handler),
	}
}

func (w *Worker) Register(kind string, handler Handler) {
	w.handlers[kind] = handler
}

func (w *Worker) Run(ctx context.Context) {
	w.logger.Info("certflow worker started", "worker_id", w.workerID)
	w.tick(ctx)
	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			w.logger.Info("certflow worker stopped", "worker_id", w.workerID)
			return
		case <-ticker.C:
			w.tick(ctx)
		}
	}
}

func (w *Worker) tick(ctx context.Context) {
	var claimed *store.ClaimedJob
	defer func() {
		if recovered := recover(); recovered != nil {
			w.logger.Error("job handler panicked", "error", fmt.Sprint(recovered))
			if claimed != nil {
				w.finishFailure(ctx, *claimed, Permanent("handler_panic", "job handler failed unexpectedly"))
			}
		}
	}()
	if _, err := w.store.RecoverExpiredJobs(ctx, RetryDelay(1)); err != nil && !errors.Is(err, context.Canceled) {
		w.logger.Error("recover expired jobs", "error", err)
		return
	}
	job, err := w.store.ClaimJob(ctx, w.workerID, w.leaseDuration)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			w.logger.Error("claim job", "error", err)
		}
		return
	}
	if job == nil {
		return
	}
	claimed = job

	reporter := &Reporter{store: w.store, executionID: job.ExecutionID}
	handler, ok := w.handlers[job.Kind]
	if !ok {
		w.finishFailure(ctx, *job, Permanent("handler_unavailable", "no handler is configured for this job type"))
		return
	}
	if err := handler(ctx, *job, reporter); err != nil {
		w.finishFailure(ctx, *job, err)
		return
	}
	if err := w.store.CompleteJob(ctx, *job, w.workerID); err != nil && !errors.Is(err, context.Canceled) {
		w.logger.Error("complete job", "job_id", job.ID, "error", err)
	}
}

func (w *Worker) finishFailure(ctx context.Context, job store.ClaimedJob, err error) {
	failure := toFailure(err)
	if failure.WaitingUser {
		if err := w.store.MarkJobWaitingUser(ctx, job, w.workerID, store.JobFailure{Code: failure.Code, Message: failure.Message}); err != nil {
			w.logger.Error("pause job for user input", "job_id", job.ID, "error", err)
		}
		return
	}
	var retryDelay *time.Duration
	if failure.Retryable && job.Attempt < job.MaxAttempts {
		delay := failure.RetryAfter
		if delay <= 0 {
			delay = RetryDelay(job.Attempt)
		}
		retryDelay = &delay
	}
	retried, finishErr := w.store.FailJob(ctx, job, w.workerID, store.JobFailure{Code: failure.Code, Message: failure.Message}, retryDelay)
	if finishErr != nil && !errors.Is(finishErr, context.Canceled) {
		w.logger.Error("fail job", "job_id", job.ID, "error", finishErr)
		return
	}
	w.logger.Warn("job failed", "job_id", job.ID, "kind", job.Kind, "code", failure.Code, "retry_scheduled", retried)
}

func toFailure(err error) *Error {
	var classified *Error
	if errors.As(err, &classified) {
		if classified.Code == "" {
			classified.Code = "execution_failed"
		}
		if classified.Message == "" {
			classified.Message = "job execution failed"
		}
		return classified
	}
	return &Error{Code: "execution_failed", Message: "job execution failed", Retryable: true}
}

// RetryDelay is intentionally bounded and deterministic: attempts are already
// recorded, so the operational schedule is easy to reason about and test.
func RetryDelay(attempt int) time.Duration {
	schedule := []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour, 4 * time.Hour}
	if attempt < 1 {
		return schedule[0]
	}
	if attempt >= len(schedule) {
		return schedule[len(schedule)-1]
	}
	return schedule[attempt-1]
}

// Reporter persists non-sensitive execution diagnostics. A single handler
// should call Step serially so sequence numbers remain a readable timeline.
type Reporter struct {
	store       *store.Store
	executionID string
	sequence    int
}

func (r *Reporter) Step(ctx context.Context, name string, summary any, run func(context.Context) error) error {
	return r.StepResult(ctx, name, summary, func(ctx context.Context) (any, error) {
		return summary, run(ctx)
	})
}

// StepResult persists a final, non-sensitive summary after a step completes.
// It is used for provider record identifiers created during the step.
func (r *Reporter) StepResult(ctx context.Context, name string, initialSummary any, run func(context.Context) (any, error)) error {
	r.sequence++
	payload, err := json.Marshal(initialSummary)
	if err != nil {
		return fmt.Errorf("encode execution step summary: %w", err)
	}
	if err := r.store.StartExecutionStep(ctx, r.executionID, r.sequence, name, payload); err != nil {
		return fmt.Errorf("start execution step: %w", err)
	}
	finalSummary, runErr := run(ctx)
	if finalSummary != nil {
		resultPayload, marshalErr := json.Marshal(finalSummary)
		if marshalErr != nil {
			return fmt.Errorf("encode execution step result: %w", marshalErr)
		}
		payload = resultPayload
	}
	message := ""
	if runErr != nil {
		message = toFailure(runErr).Message
	}
	if finishErr := r.store.FinishExecutionStep(ctx, r.executionID, r.sequence, payload, message); finishErr != nil {
		return fmt.Errorf("finish execution step: %w", finishErr)
	}
	return runErr
}
