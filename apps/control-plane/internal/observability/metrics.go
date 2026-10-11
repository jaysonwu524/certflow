// Package observability contains process-local operational instrumentation.
// Labels intentionally describe bounded system dimensions only. Resource IDs,
// account IDs and raw provider errors must never become metric labels.
package observability

import (
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics owns the application's Prometheus registry. Keeping the registry
// explicit prevents duplicate registration when several Server instances are
// created by unit tests.
type Metrics struct {
	registry *prometheus.Registry
	started  time.Time
	stateMu  sync.RWMutex
	state    metricState

	httpRequests  *prometheus.CounterVec
	httpDuration  *prometheus.HistogramVec
	httpInFlight  *prometheus.GaugeVec
	jobCompleted  *prometheus.CounterVec
	jobDuration   *prometheus.HistogramVec
	jobInFlight   *prometheus.GaugeVec
	queueDepth    prometheus.Gauge
	schedulerRuns *prometheus.CounterVec
	schedulerTime *prometheus.HistogramVec
	jobsQueued    *prometheus.CounterVec
	certExpiring  *prometheus.GaugeVec
	deliveries    *prometheus.CounterVec
	providerCalls *prometheus.CounterVec
}

type metricState struct {
	queueDepth         int
	jobsInFlight       map[string]int
	certificatesExpiry map[string]int
	lastSchedulerRun   SchedulerRun
}

// SchedulerRun captures the latest local scan outcome. It complements the
// durable execution history in the database and is reset on process restart.
type SchedulerRun struct {
	Status   string    `json:"status"`
	Queued   int       `json:"queued"`
	Finished time.Time `json:"finishedAt"`
}

type JobInFlight struct {
	Kind  string `json:"kind"`
	Count int    `json:"count"`
}

// Snapshot is an authenticated-console projection of process-local metrics.
// It contains no raw Prometheus samples, identities, secrets or provider data.
type Snapshot struct {
	StartedAt              time.Time     `json:"startedAt"`
	UptimeSeconds          int64         `json:"uptimeSeconds"`
	QueueDepth             int           `json:"queueDepth"`
	JobsInFlight           []JobInFlight `json:"jobsInFlight"`
	CertificatesExpiring7  int           `json:"certificatesExpiring7"`
	CertificatesExpiring30 int           `json:"certificatesExpiring30"`
	LastSchedulerRun       SchedulerRun  `json:"lastSchedulerRun"`
}

func NewMetrics() *Metrics {
	metrics := &Metrics{
		registry: prometheus.NewRegistry(),
		started:  time.Now().UTC(),
		state: metricState{
			jobsInFlight:       make(map[string]int),
			certificatesExpiry: make(map[string]int),
		},
	}
	metrics.httpRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "certflow_http_requests_total",
		Help: "Completed HTTP requests handled by CertFlow.",
	}, []string{"method", "route", "status"})
	metrics.httpDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "certflow_http_request_duration_seconds",
		Help:    "Time spent serving HTTP requests.",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "route", "status"})
	metrics.httpInFlight = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "certflow_http_requests_in_flight",
		Help: "HTTP requests currently being handled by CertFlow.",
	}, []string{"method"})
	metrics.jobCompleted = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "certflow_jobs_completed_total",
		Help: "Completed worker job attempts by type and result.",
	}, []string{"kind", "status"})
	metrics.jobDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "certflow_job_duration_seconds",
		Help:    "Time spent processing worker job attempts.",
		Buckets: prometheus.ExponentialBuckets(0.25, 2, 12),
	}, []string{"kind", "status"})
	metrics.jobInFlight = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "certflow_jobs_in_flight",
		Help: "Worker job attempts currently running by type.",
	}, []string{"kind"})
	metrics.queueDepth = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "certflow_job_queue_depth",
		Help: "Queued jobs observed by the worker during its periodic refresh.",
	})
	metrics.schedulerRuns = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "certflow_scheduler_runs_total",
		Help: "Renewal scheduler scans by result.",
	}, []string{"status"})
	metrics.schedulerTime = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "certflow_scheduler_run_duration_seconds",
		Help:    "Time spent scanning due automation tasks.",
		Buckets: prometheus.DefBuckets,
	}, []string{"status"})
	metrics.jobsQueued = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "certflow_scheduler_jobs_queued_total",
		Help: "Jobs queued by the renewal scheduler.",
	}, []string{"type"})
	metrics.certExpiring = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "certflow_certificates_expiring_total",
		Help: "Issued certificates expiring within the configured observation window.",
	}, []string{"window"})
	metrics.deliveries = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "certflow_notification_deliveries_total",
		Help: "Notification delivery attempts by channel and result.",
	}, []string{"channel", "status"})
	metrics.providerCalls = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "certflow_provider_requests_total",
		Help: "Cloud provider API requests by provider, operation and result.",
	}, []string{"provider", "operation", "status"})
	metrics.registry.MustRegister(
		prometheus.NewGoCollector(),
		prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}),
		metrics.httpRequests,
		metrics.httpDuration,
		metrics.httpInFlight,
		metrics.jobCompleted,
		metrics.jobDuration,
		metrics.jobInFlight,
		metrics.queueDepth,
		metrics.schedulerRuns,
		metrics.schedulerTime,
		metrics.jobsQueued,
		metrics.certExpiring,
		metrics.deliveries,
		metrics.providerCalls,
	)
	return metrics
}

func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{EnableOpenMetrics: true})
}

func (m *Metrics) HTTPStarted(method string) { m.httpInFlight.WithLabelValues(method).Inc() }

func (m *Metrics) HTTPFinished(method, route string, status int, duration time.Duration) {
	// Numeric codes are bounded by the HTTP standard and make rate queries
	// straightforward while remaining a low-cardinality label.
	statusCode := stringStatus(status)
	m.httpInFlight.WithLabelValues(method).Dec()
	m.httpRequests.WithLabelValues(method, route, statusCode).Inc()
	m.httpDuration.WithLabelValues(method, route, statusCode).Observe(duration.Seconds())
}

func (m *Metrics) JobStarted(kind string) {
	m.jobInFlight.WithLabelValues(kind).Inc()
	m.stateMu.Lock()
	m.state.jobsInFlight[kind]++
	m.stateMu.Unlock()
}

func (m *Metrics) JobFinished(kind, status string, duration time.Duration) {
	m.jobInFlight.WithLabelValues(kind).Dec()
	m.jobCompleted.WithLabelValues(kind, status).Inc()
	m.jobDuration.WithLabelValues(kind, status).Observe(duration.Seconds())
	m.stateMu.Lock()
	if m.state.jobsInFlight[kind] > 1 {
		m.state.jobsInFlight[kind]--
	} else {
		delete(m.state.jobsInFlight, kind)
	}
	m.stateMu.Unlock()
}

func (m *Metrics) SetJobQueueDepth(depth int) {
	m.queueDepth.Set(float64(depth))
	m.stateMu.Lock()
	m.state.queueDepth = depth
	m.stateMu.Unlock()
}

func (m *Metrics) SchedulerFinished(status string, queued int, duration time.Duration) {
	m.schedulerRuns.WithLabelValues(status).Inc()
	m.schedulerTime.WithLabelValues(status).Observe(duration.Seconds())
	m.stateMu.Lock()
	m.state.lastSchedulerRun = SchedulerRun{Status: status, Queued: queued, Finished: time.Now().UTC()}
	m.stateMu.Unlock()
	if queued > 0 {
		m.jobsQueued.WithLabelValues("automation").Add(float64(queued))
	}
}

func (m *Metrics) SetCertificatesExpiring(window string, count int) {
	m.certExpiring.WithLabelValues(window).Set(float64(count))
	m.stateMu.Lock()
	m.state.certificatesExpiry[window] = count
	m.stateMu.Unlock()
}

func (m *Metrics) NotificationDelivered(channel, status string) {
	m.deliveries.WithLabelValues(channel, status).Inc()
}

func (m *Metrics) ProviderRequestFinished(provider, operation, status string) {
	m.providerCalls.WithLabelValues(provider, operation, status).Inc()
}

func (m *Metrics) Snapshot() Snapshot {
	m.stateMu.RLock()
	jobs := make([]JobInFlight, 0, len(m.state.jobsInFlight))
	for kind, count := range m.state.jobsInFlight {
		jobs = append(jobs, JobInFlight{Kind: kind, Count: count})
	}
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].Kind < jobs[j].Kind })
	snapshot := Snapshot{
		StartedAt:              m.started,
		UptimeSeconds:          int64(time.Since(m.started).Seconds()),
		QueueDepth:             m.state.queueDepth,
		JobsInFlight:           jobs,
		CertificatesExpiring7:  m.state.certificatesExpiry["7d"],
		CertificatesExpiring30: m.state.certificatesExpiry["30d"],
		LastSchedulerRun:       m.state.lastSchedulerRun,
	}
	m.stateMu.RUnlock()
	return snapshot
}

func stringStatus(status int) string {
	if status < 100 || status > 599 {
		return "unknown"
	}
	return fmt.Sprintf("%d", status)
}
