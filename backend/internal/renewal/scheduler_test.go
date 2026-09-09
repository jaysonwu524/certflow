package renewal

import "testing"

func TestSchedulerUsesHourlyInterval(t *testing.T) {
	if defaultInterval.String() != "1h0m0s" {
		t.Fatalf("unexpected renewal scan interval: %s", defaultInterval)
	}
}
