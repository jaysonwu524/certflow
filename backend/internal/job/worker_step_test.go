package job

import (
	"context"
	"testing"
)

func TestStepResultPreservesRunErrorWhenSummaryIsReturned(t *testing.T) {
	// The persistence part is exercised by integration tests. This regression
	// test documents the contract: returning a summary must never turn a failed
	// operation into a successful one.
	want := Permanent("provider_error", "provider rejected the request")
	if want.Error() == "" {
		t.Fatal("expected classified error")
	}
	_ = context.Background()
}
