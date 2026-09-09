package job

import (
	"testing"
	"time"
)

func TestRetryDelayUsesBoundedSchedule(t *testing.T) {
	tests := []struct {
		attempt int
		want    time.Duration
	}{
		{0, time.Minute},
		{1, time.Minute},
		{2, 5 * time.Minute},
		{3, 15 * time.Minute},
		{4, time.Hour},
		{5, 4 * time.Hour},
		{100, 4 * time.Hour},
	}
	for _, test := range tests {
		if got := RetryDelay(test.attempt); got != test.want {
			t.Errorf("RetryDelay(%d) = %s, want %s", test.attempt, got, test.want)
		}
	}
}

func TestToFailureDoesNotExposeUnclassifiedError(t *testing.T) {
	failure := toFailure(assertionError("provider response with a secret"))
	if failure.Message != "job execution failed" || !failure.Retryable {
		t.Fatalf("unexpected fallback failure: %#v", failure)
	}
}

type assertionError string

func (e assertionError) Error() string { return string(e) }
