package store

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/regenbio/certflow/internal/domain"
	"github.com/regenbio/certflow/internal/id"
)

//go:embed migrations/001_init.sql
var initialSchema string

//go:embed migrations/002_execution_cleanup_kind.sql
var executionCleanupKindMigration string

//go:embed migrations/003_manual_validation.sql
var manualValidationMigration string

//go:embed migrations/004_deployments.sql
var deploymentsMigration string

//go:embed migrations/005_automations.sql
var automationsMigration string

//go:embed migrations/006_automation_task_types.sql
var automationTaskTypesMigration string

//go:embed migrations/007_automation_upload_constraints.sql
var automationUploadConstraintsMigration string

//go:embed migrations/008_automation_remote_certificate.sql
var automationRemoteCertificateMigration string

//go:embed migrations/009_automation_target_remote_certificate.sql
var automationTargetRemoteCertificateMigration string

//go:embed migrations/010_identity.sql
var identityMigration string

//go:embed migrations/011_multi_cloud_provider.sql
var multiCloudProviderMigration string

//go:embed migrations/012_cloud_credential_description.sql
var cloudCredentialDescriptionMigration string

//go:embed migrations/013_cloud_credential_access_key_id.sql
var cloudCredentialAccessKeyIDMigration string

//go:embed migrations/014_acme_verification.sql
var acmeVerificationMigration string

//go:embed migrations/015_refresh_tokens.sql
var refreshTokensMigration string

//go:embed migrations/016_dns_account_hardening.sql
var dnsAccountHardeningMigration string

//go:embed migrations/017_dns_account_reverification.sql
var dnsAccountReverificationMigration string

//go:embed migrations/018_realtime_events.sql
var realtimeEventsMigration string

//go:embed migrations/019_notification_reads.sql
var notificationReadsMigration string

//go:embed migrations/020_automation_runs_and_assets.sql
var automationRunsAndAssetsMigration string

//go:embed migrations/021_notification_delivery.sql
var notificationDeliveryMigration string

type Store struct {
	pool *pgxpool.Pool
}

// ErrResourceInUse prevents a soft-delete from breaking an existing workflow.
var ErrResourceInUse = errors.New("resource is still in use")

// ErrConfigurationUnavailable is returned when a resource references an
// account that exists but is disabled, invalid, or no longer verified.
var ErrConfigurationUnavailable = errors.New("referenced configuration is unavailable")

// ErrDNSZoneNotAllowed prevents a certificate from being queued when one of
// its SANs cannot be handled by the selected DNS account allowlist.
var ErrDNSZoneNotAllowed = errors.New("certificate domain is outside the DNS account allowlist")

// ErrCertificateJobInProgress prevents two issuance workflows from racing for
// the same certificate configuration.
var ErrCertificateJobInProgress = errors.New("certificate issuance is already in progress")

// ErrAutomationRunInProgress prevents accidental duplicate manual runs for a
// task while an earlier batch is still queued or executing.
var ErrAutomationRunInProgress = errors.New("automation task already has a running batch")

// ResourceInUseError carries a small, non-sensitive impact summary so the UI
// can tell an operator why deletion is blocked without exposing SQL details.
type ResourceInUseError struct {
	References map[string]int `json:"references"`
}

func (e *ResourceInUseError) Error() string { return ErrResourceInUse.Error() }

func (e *ResourceInUseError) Is(target error) bool { return target == ErrResourceInUse }

func (e *ResourceInUseError) Total() int {
	total := 0
	for _, count := range e.References {
		total += count
	}
	return total
}

type Actor struct {
	ID    string
	Email string
	Role  string
}

type User struct {
	ID                 string     `json:"id"`
	Email              string     `json:"email"`
	Role               string     `json:"role"`
	Status             string     `json:"status"`
	MustChangePassword bool       `json:"mustChangePassword"`
	LastLoginAt        *time.Time `json:"lastLoginAt"`
	CreatedAt          time.Time  `json:"createdAt"`
}

type SMTPSettings struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	Auth        bool   `json:"auth"`
	EncryptType string `json:"encryptType"`
	EncryptPort int    `json:"encryptPort"`
	FromEmail   string `json:"fromEmail"`
	FromName    string `json:"fromName"`
}

type Session struct {
	Token     string
	ExpiresAt time.Time
	User      User
}

type RefreshSession struct {
	Token      string
	ExpiresAt  time.Time
	Persistent bool
	User       User
}

// ClaimedJob is the immutable task snapshot handed to a worker after its lease
// and user-visible execution attempt have been persisted.
type ClaimedJob struct {
	ID                 string
	Kind               string
	Payload            json.RawMessage
	Attempt            int
	MaxAttempts        int
	ExecutionID        string
	CertificateID      string
	DeploymentTargetID string
	AutomationTaskID   string
	AutomationRunID    string
}

type ClaimedNotificationDelivery struct {
	ID                   int64
	Channel              string
	RecipientEmail       string
	WebhookEndpointID    string
	WebhookURLCiphertext []byte
	Event                domain.RealtimeEvent
}

type PersonalWebhookSettings struct {
	EndpointID    string
	Enabled       bool
	URLCiphertext []byte
}

type DeploymentConfiguration struct {
	CertificateID         string
	TargetID              string
	TargetName            string
	RegionID              string
	LoadBalancerID        string
	ListenerID            string
	RemoteCertificateID   string
	LastUploadedVersionID string
	CertificateVersionID  string
	CertificateCiphertext []byte
	PrivateKeyCiphertext  []byte
	ChainCiphertext       []byte
	CloudCredential       struct {
		ID                    string
		Provider              string
		VersionID             string
		CredentialsCiphertext []byte
		Status                string
	}
}

// UploadConfiguration contains the current encrypted certificate version and
// the credential selected by an upload task. It never leaves a worker.
type UploadConfiguration struct {
	CertificateID         string
	CertificateVersionID  string
	CertificateCiphertext []byte
	PrivateKeyCiphertext  []byte
	ChainCiphertext       []byte
	RemoteCertificateID   string
	LastUploadedVersionID string
	CloudCredential       struct {
		ID                    string
		Provider              string
		VersionID             string
		CredentialsCiphertext []byte
		Status                string
	}
}

type CloudCredentialMaterial struct {
	Provider              string
	VersionID             string
	CredentialsCiphertext []byte
	Status                string
}

type JobFailure struct {
	Code    string
	Message string
}

type AutomationTaskConfiguration struct {
	ID                string
	CertificateID     string
	ActionType        string
	CloudCredentialID string
	TargetIDs         []string
}

type AutomationRunQueueResult struct {
	ID     string
	Status string
}

// IssueConfiguration is the minimum immutable configuration the issuance
// worker needs. Ciphertexts are deliberately returned only to a worker, never
// through an HTTP response.
type IssueConfiguration struct {
	CertificateID  string
	KeyAlgorithm   string
	ValidationMode string
	Domains        []string
	ACMEAccount    struct {
		ID                   string
		DirectoryURL         string
		Email                string
		AccountURL           string
		PrivateKeyCiphertext []byte
		Status               string
	}
	DNSAccount struct {
		ID                          string
		Provider                    string
		AllowedZones                []string
		Status                      string
		VerifiedCredentialVersionID string
	}
	CloudCredential struct {
		VersionID             string
		CredentialsCiphertext []byte
		Status                string
	}
}

type CertificateVersionMaterial struct {
	ID                    string
	CertificateID         string
	ExecutionID           string
	CertificateCiphertext []byte
	PrivateKeyCiphertext  []byte
	ChainCiphertext       []byte
	SerialNumber          string
	Fingerprint           string
	NotBefore             time.Time
	NotAfter              time.Time
}

type ManualChallenge struct {
	ID                string
	JobID             string
	CertificateID     string
	OrderURL          string
	AuthorizationURLs []string
	Challenges        []ManualChallengeItem
	Status            string
}

type ManualChallengeItem struct {
	Domain string `json:"domain"`
	FQDN   string `json:"fqdn"`
	Value  string `json:"value"`
}

func New(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create database pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return &Store{pool: pool}, nil
}

func (s *Store) Close() {
	s.pool.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) Migrate(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin migration: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("create migration table: %w", err)
	}

	migrations := []struct {
		version int
		sql     string
	}{
		{version: 1, sql: initialSchema},
		{version: 2, sql: executionCleanupKindMigration},
		{version: 3, sql: manualValidationMigration},
		{version: 4, sql: deploymentsMigration},
		{version: 5, sql: automationsMigration},
		{version: 6, sql: automationTaskTypesMigration},
		{version: 7, sql: automationUploadConstraintsMigration},
		{version: 8, sql: automationRemoteCertificateMigration},
		{version: 9, sql: automationTargetRemoteCertificateMigration},
		{version: 10, sql: identityMigration},
		{version: 11, sql: multiCloudProviderMigration},
		{version: 12, sql: cloudCredentialDescriptionMigration},
		{version: 13, sql: cloudCredentialAccessKeyIDMigration},
		{version: 14, sql: acmeVerificationMigration},
		{version: 15, sql: refreshTokensMigration},
		{version: 16, sql: dnsAccountHardeningMigration},
		{version: 17, sql: dnsAccountReverificationMigration},
		{version: 18, sql: realtimeEventsMigration},
		{version: 19, sql: notificationReadsMigration},
		{version: 20, sql: automationRunsAndAssetsMigration},
		{version: 21, sql: notificationDeliveryMigration},
	}
	for _, migration := range migrations {
		var applied bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, migration.version).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %d: %w", migration.version, err)
		}
		if applied {
			continue
		}
		if _, err := tx.Exec(ctx, migration.sql); err != nil {
			return fmt.Errorf("apply migration %d: %w", migration.version, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, migration.version); err != nil {
			return fmt.Errorf("record migration %d: %w", migration.version, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit migration: %w", err)
	}

	return nil
}

// ListRealtimeEvents returns a bounded replay stream. Administrators see all
// events; standard users see only their owned resources.
func (s *Store) ListRealtimeEvents(ctx context.Context, afterID int64, limit int) ([]domain.RealtimeEvent, error) {
	if limit < 1 || limit > 200 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, owner_user_id::text, topic, resource_type, resource_id::text,
			status, payload, created_at
		FROM realtime_events
		WHERE id > $1 AND ($2 = '' OR owner_user_id = $2::uuid)
		ORDER BY id ASC
		LIMIT $3
	`, afterID, ownerID(ctx), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := make([]domain.RealtimeEvent, 0)
	for rows.Next() {
		var event domain.RealtimeEvent
		var payload []byte
		if err := rows.Scan(&event.ID, &event.OwnerUserID, &event.Topic, &event.ResourceType, &event.ResourceID, &event.Status, &payload, &event.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(payload, &event.Payload); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) LatestRealtimeEventID(ctx context.Context) (int64, error) {
	var eventID int64
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(id), 0)
		FROM realtime_events
		WHERE $1 = '' OR owner_user_id = $1::uuid
	`, ownerID(ctx)).Scan(&eventID)
	return eventID, err
}

func (s *Store) PruneRealtimeEvents(ctx context.Context, before time.Time) (int64, error) {
	result, err := s.pool.Exec(ctx, `DELETE FROM realtime_events WHERE created_at < $1`, before)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

func (s *Store) ListNotifications(ctx context.Context, limit int) ([]domain.Notification, error) {
	if limit < 1 || limit > 100 {
		limit = 30
	}
	userID := actorID(ctx)
	rows, err := s.pool.Query(ctx, `
		SELECT e.id, e.owner_user_id::text, e.topic, e.resource_type, e.resource_id::text,
			e.status, e.payload, e.created_at, r.read_at
		FROM realtime_events e
		LEFT JOIN user_notification_reads r ON r.realtime_event_id = e.id AND r.user_id = $1::uuid
		WHERE $2 = '' OR e.owner_user_id = $2::uuid
		ORDER BY e.id DESC
		LIMIT $3
	`, userID, ownerID(ctx), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	notifications := make([]domain.Notification, 0)
	for rows.Next() {
		var notification domain.Notification
		var payload []byte
		if err := rows.Scan(&notification.ID, &notification.OwnerUserID, &notification.Topic, &notification.ResourceType, &notification.ResourceID, &notification.Status, &payload, &notification.CreatedAt, &notification.ReadAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(payload, &notification.Payload); err != nil {
			return nil, err
		}
		notifications = append(notifications, notification)
	}
	return notifications, rows.Err()
}

func (s *Store) MarkNotificationsRead(ctx context.Context, eventIDs []int64) error {
	if len(eventIDs) == 0 {
		return nil
	}
	userID := actorID(ctx)
	if userID == "" {
		return errors.New("notification reader is missing")
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO user_notification_reads (user_id, realtime_event_id, read_at)
		SELECT $1::uuid, e.id, now()
		FROM unnest($2::bigint[]) AS requested(id)
		JOIN realtime_events e ON e.id = requested.id
		WHERE $3 = '' OR e.owner_user_id = $3::uuid
		ON CONFLICT (user_id, realtime_event_id) DO NOTHING
	`, userID, eventIDs, ownerID(ctx))
	return err
}

func (s *Store) GetPersonalWebhookSettings(ctx context.Context) (PersonalWebhookSettings, error) {
	settings := PersonalWebhookSettings{}
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, enabled, url_ciphertext
		FROM notification_endpoints
		WHERE owner_user_id = $1::uuid AND type = 'webhook' AND name = $2 AND deleted_at IS NULL
	`, actorID(ctx), personalWebhookName(actorID(ctx))).Scan(&settings.EndpointID, &settings.Enabled, &settings.URLCiphertext)
	if err == pgx.ErrNoRows {
		return PersonalWebhookSettings{}, nil
	}
	return settings, err
}

func (s *Store) SavePersonalWebhookSettings(ctx context.Context, enabled bool, urlCiphertext []byte) error {
	userID := actorID(ctx)
	if userID == "" {
		return errors.New("webhook owner is missing")
	}
	if len(urlCiphertext) == 0 {
		result, err := s.pool.Exec(ctx, `
			UPDATE notification_endpoints
			SET enabled = $2, updated_at = now()
			WHERE owner_user_id = $1::uuid AND type = 'webhook' AND name = $3 AND deleted_at IS NULL
		`, userID, enabled, personalWebhookName(userID))
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 && enabled {
			return errors.New("a webhook URL is required when enabling notifications")
		}
		return nil
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO notification_endpoints (id, name, type, url_ciphertext, enabled, event_filter, owner_user_id)
		VALUES ($1, $2, 'webhook', $3, $4, '{}', $5::uuid)
		ON CONFLICT (name) DO UPDATE
		SET url_ciphertext = EXCLUDED.url_ciphertext, enabled = EXCLUDED.enabled, event_filter = '{}', updated_at = now(), deleted_at = NULL
		WHERE notification_endpoints.owner_user_id = EXCLUDED.owner_user_id
	`, id.New(), personalWebhookName(userID), urlCiphertext, enabled, userID)
	return err
}

func personalWebhookName(userID string) string {
	return "personal-webhook:" + userID
}

func (s *Store) ClaimNotificationDelivery(ctx context.Context, leaseDuration time.Duration) (*ClaimedNotificationDelivery, error) {
	if leaseDuration <= 0 {
		leaseDuration = 30 * time.Second
	}
	var delivery ClaimedNotificationDelivery
	var payload []byte
	err := s.pool.QueryRow(ctx, `
		WITH next_delivery AS (
			SELECT id
			FROM notification_deliveries
			WHERE (status = 'queued' AND next_attempt_at <= now())
			   OR (status = 'running' AND lease_expires_at <= now())
			ORDER BY next_attempt_at, id
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE notification_deliveries delivery
		SET status = 'running', attempts = delivery.attempts + 1,
			lease_expires_at = now() + $1::interval, updated_at = now()
		FROM next_delivery next
		JOIN notification_deliveries source ON source.id = next.id
		JOIN realtime_events event ON event.id = source.realtime_event_id
		JOIN users owner ON owner.id = source.owner_user_id
		LEFT JOIN notification_endpoints endpoint ON endpoint.id = source.endpoint_id AND endpoint.deleted_at IS NULL
		WHERE delivery.id = next.id
		RETURNING delivery.id, delivery.channel, owner.email, COALESCE(endpoint.id::text, ''), COALESCE(endpoint.url_ciphertext, '\\x'::bytea),
			event.id, event.owner_user_id::text, event.topic, event.resource_type, event.resource_id::text, event.status, event.payload, event.created_at
	`, intervalLiteral(leaseDuration)).Scan(
		&delivery.ID, &delivery.Channel, &delivery.RecipientEmail, &delivery.WebhookEndpointID, &delivery.WebhookURLCiphertext,
		&delivery.Event.ID, &delivery.Event.OwnerUserID, &delivery.Event.Topic, &delivery.Event.ResourceType, &delivery.Event.ResourceID, &delivery.Event.Status, &payload, &delivery.Event.CreatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(payload, &delivery.Event.Payload); err != nil {
		return nil, err
	}
	return &delivery, nil
}

func (s *Store) CompleteNotificationDelivery(ctx context.Context, deliveryID int64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE notification_deliveries
		SET status = 'succeeded', sent_at = now(), lease_expires_at = NULL, last_error = NULL, updated_at = now()
		WHERE id = $1 AND status = 'running'
	`, deliveryID)
	return err
}

func (s *Store) FailNotificationDelivery(ctx context.Context, deliveryID int64, message string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE notification_deliveries
		SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
			next_attempt_at = now() + (LEAST(attempts, 5) * interval '30 seconds'),
			lease_expires_at = NULL, last_error = $2, updated_at = now()
		WHERE id = $1 AND status = 'running'
	`, deliveryID, truncateError(message))
	return err
}

// GetRealtimeEvent is used by the process-level PostgreSQL listener before it
// fans a newly committed event out to authenticated SSE subscribers.
func (s *Store) GetRealtimeEvent(ctx context.Context, eventID int64) (domain.RealtimeEvent, error) {
	var event domain.RealtimeEvent
	var payload []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, owner_user_id::text, topic, resource_type, resource_id::text,
			status, payload, created_at
		FROM realtime_events WHERE id = $1
	`, eventID).Scan(&event.ID, &event.OwnerUserID, &event.Topic, &event.ResourceType, &event.ResourceID, &event.Status, &payload, &event.CreatedAt)
	if err != nil {
		return domain.RealtimeEvent{}, err
	}
	if err := json.Unmarshal(payload, &event.Payload); err != nil {
		return domain.RealtimeEvent{}, err
	}
	return event, nil
}

// EmitRealtimeEvent persists and broadcasts a non-sensitive state transition.
// The database function also sends a PostgreSQL notification so every API
// instance can fan the event out to its local SSE subscribers.
func (s *Store) EmitRealtimeEvent(ctx context.Context, ownerUserID, topic, resourceType, resourceID, status string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		SELECT certflow_emit_realtime_event($1::uuid, $2, $3, $4::uuid, $5, $6::jsonb)
	`, ownerUserID, topic, resourceType, resourceID, status, data)
	return err
}

// ListenRealtimeEvents blocks on PostgreSQL notifications. The payload is the
// durable event ID, so listeners can always load the authoritative record.
func (s *Store) ListenRealtimeEvents(ctx context.Context, receive func(domain.RealtimeEvent)) error {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `LISTEN certflow_realtime_events`); err != nil {
		return err
	}
	for {
		notification, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			return err
		}
		eventID, err := strconv.ParseInt(notification.Payload, 10, 64)
		if err != nil {
			continue
		}
		event, err := s.GetRealtimeEvent(ctx, eventID)
		if err == nil {
			receive(event)
		}
	}
}

func (s *Store) Dashboard(ctx context.Context) (domain.Dashboard, error) {
	var dashboard domain.Dashboard
	owner := ownerID(ctx)
	err := s.pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM certificates WHERE status = 'issued' AND deleted_at IS NULL AND ($1 = '' OR owner_user_id = $1::uuid)),
			(SELECT count(*) FROM certificates c JOIN certificate_versions v ON v.id = c.current_certificate_version_id WHERE v.not_after <= now() + interval '30 days' AND v.not_after > now() AND c.deleted_at IS NULL AND ($1 = '' OR c.owner_user_id = $1::uuid)),
			(SELECT count(*) FROM jobs j WHERE j.status = 'running' AND ($1 = '' OR (j.payload ? 'certificate_id' AND EXISTS (SELECT 1 FROM certificates c WHERE c.id = NULLIF(j.payload->>'certificate_id', '')::uuid AND c.owner_user_id = $1::uuid)))),
			(SELECT count(*) FROM workflow_executions e LEFT JOIN certificates c ON c.id = e.certificate_id WHERE e.status = 'failed' AND e.started_at >= now() - interval '7 days' AND ($1 = '' OR c.owner_user_id = $1::uuid))
	`, owner).Scan(&dashboard.ActiveCertificates, &dashboard.ExpiringSoon, &dashboard.RunningJobs, &dashboard.FailedExecutions)
	return dashboard, err
}

func (s *Store) ListCertificates(ctx context.Context) ([]domain.CertificateSummary, error) {
	owner := ownerID(ctx)
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.name, c.status, c.key_algorithm, c.validation_mode, v.not_after, COALESCE(v.sha256_fingerprint, ''), c.last_issued_at, COALESCE(c.last_error, ''), c.created_at,
			COALESCE(array_agg(d.domain ORDER BY d.position) FILTER (WHERE d.id IS NOT NULL), '{}')
		FROM certificates c
		LEFT JOIN certificate_versions v ON v.id = c.current_certificate_version_id
		LEFT JOIN certificate_domains d ON d.certificate_id = c.id
		WHERE c.deleted_at IS NULL AND ($1 = '' OR c.owner_user_id = $1::uuid)
		GROUP BY c.id, v.not_after, v.sha256_fingerprint
		ORDER BY c.created_at DESC
	`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	certificates := make([]domain.CertificateSummary, 0)
	for rows.Next() {
		var certificate domain.CertificateSummary
		if err := rows.Scan(
			&certificate.ID, &certificate.Name, &certificate.Status, &certificate.KeyAlgorithm, &certificate.ValidationMode,
			&certificate.NotAfter, &certificate.Fingerprint, &certificate.LastIssuedAt, &certificate.LastError, &certificate.CreatedAt, &certificate.Domains,
		); err != nil {
			return nil, err
		}
		certificates = append(certificates, certificate)
	}

	return certificates, rows.Err()
}

func (s *Store) GetCertificate(ctx context.Context, certificateID string) (domain.CertificateDetail, error) {
	var certificate domain.CertificateDetail
	err := s.pool.QueryRow(ctx, `
		SELECT c.id, c.name, c.status, c.key_algorithm, c.validation_mode,
			v.not_after, COALESCE(v.sha256_fingerprint, ''), c.last_issued_at,
			COALESCE(c.last_error, ''), c.created_at,
			COALESCE(c.acme_account_id::text, ''), COALESCE(c.default_dns_account_id::text, ''),
			c.renew_before_days,
			COALESCE(array_agg(d.domain ORDER BY d.position) FILTER (WHERE d.id IS NOT NULL), '{}')
		FROM certificates c
		LEFT JOIN certificate_versions v ON v.id = c.current_certificate_version_id
		LEFT JOIN certificate_domains d ON d.certificate_id = c.id
		WHERE c.id = $1 AND c.deleted_at IS NULL AND ($2 = '' OR c.owner_user_id = $2::uuid)
		GROUP BY c.id, v.not_after, v.sha256_fingerprint
	`, certificateID, ownerID(ctx)).Scan(
		&certificate.ID, &certificate.Name, &certificate.Status, &certificate.KeyAlgorithm,
		&certificate.ValidationMode, &certificate.NotAfter, &certificate.Fingerprint,
		&certificate.LastIssuedAt, &certificate.LastError, &certificate.CreatedAt,
		&certificate.AcmeAccountID, &certificate.DefaultDNSAccountID, &certificate.RenewBeforeDays,
		&certificate.Domains,
	)
	return certificate, err
}

func (s *Store) ListCertificateVersions(ctx context.Context, certificateID string) ([]domain.CertificateVersionSummary, error) {
	// Keep the collection endpoint consistent with the certificate detail API:
	// a missing or inaccessible certificate must not look like an empty history.
	if _, err := s.GetCertificate(ctx, certificateID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT v.id, v.serial_number, v.sha256_fingerprint, v.not_before, v.not_after, v.created_at,
			v.revoked_at, COALESCE(v.revocation_reason, ''), v.id = c.current_certificate_version_id
		FROM certificate_versions v
		JOIN certificates c ON c.id = v.certificate_id
		WHERE v.certificate_id = $1 AND c.deleted_at IS NULL AND ($2 = '' OR c.owner_user_id = $2::uuid)
		ORDER BY v.created_at DESC
	`, certificateID, ownerID(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	versions := make([]domain.CertificateVersionSummary, 0)
	for rows.Next() {
		var version domain.CertificateVersionSummary
		if err := rows.Scan(&version.ID, &version.SerialNumber, &version.Fingerprint, &version.NotBefore, &version.NotAfter, &version.IssuedAt, &version.RevokedAt, &version.RevocationReason, &version.IsCurrent); err != nil {
			return nil, err
		}
		versions = append(versions, version)
	}
	return versions, rows.Err()
}

func (s *Store) GetCertificateRelations(ctx context.Context, certificateID string) (domain.CertificateRelations, error) {
	if _, err := s.GetCertificate(ctx, certificateID); err != nil {
		return domain.CertificateRelations{}, err
	}
	relations := domain.CertificateRelations{Automations: []domain.CertificateAutomationReference{}, Deployments: []domain.CertificateDeploymentReference{}}
	var acmeID, acmeName, acmeStatus, dnsID, dnsName, dnsStatus string
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(a.id::text, ''), COALESCE(a.name, ''), COALESCE(a.status, ''),
			COALESCE(d.id::text, ''), COALESCE(d.name, ''), COALESCE(d.status, '')
		FROM certificates c
		LEFT JOIN acme_accounts a ON a.id = c.acme_account_id AND a.deleted_at IS NULL
		LEFT JOIN dns_accounts d ON d.id = c.default_dns_account_id AND d.deleted_at IS NULL
		WHERE c.id = $1 AND c.deleted_at IS NULL
	`, certificateID).Scan(&acmeID, &acmeName, &acmeStatus, &dnsID, &dnsName, &dnsStatus)
	if err != nil {
		return domain.CertificateRelations{}, err
	}
	if acmeID != "" {
		relations.ACMEAccount = &domain.CertificateResourceReference{ID: acmeID, Name: acmeName, Status: acmeStatus}
	}
	if dnsID != "" {
		relations.DNSAccount = &domain.CertificateResourceReference{ID: dnsID, Name: dnsName, Status: dnsStatus}
	}

	automationRows, err := s.pool.Query(ctx, `
		SELECT id, name, action_type, enabled, COALESCE(last_status, '')
		FROM automation_tasks
		WHERE certificate_id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid)
		ORDER BY created_at DESC
	`, certificateID, ownerID(ctx))
	if err != nil {
		return domain.CertificateRelations{}, err
	}
	defer automationRows.Close()
	for automationRows.Next() {
		var item domain.CertificateAutomationReference
		if err := automationRows.Scan(&item.ID, &item.Name, &item.ActionType, &item.Enabled, &item.LastStatus); err != nil {
			return domain.CertificateRelations{}, err
		}
		relations.Automations = append(relations.Automations, item)
	}
	if err := automationRows.Err(); err != nil {
		return domain.CertificateRelations{}, err
	}

	deploymentRows, err := s.pool.Query(ctx, `
		SELECT d.id, d.deployment_target_id, t.name, d.enabled, d.auto_deploy, d.last_deployed_at, COALESCE(d.last_error, '')
		FROM certificate_deployments d
		JOIN deployment_targets t ON t.id = d.deployment_target_id
		WHERE d.certificate_id = $1 AND ($2 = '' OR d.owner_user_id = $2::uuid)
		ORDER BY d.created_at DESC
	`, certificateID, ownerID(ctx))
	if err != nil {
		return domain.CertificateRelations{}, err
	}
	defer deploymentRows.Close()
	for deploymentRows.Next() {
		var item domain.CertificateDeploymentReference
		if err := deploymentRows.Scan(&item.ID, &item.TargetID, &item.TargetName, &item.Enabled, &item.AutoDeploy, &item.LastDeployedAt, &item.LastError); err != nil {
			return domain.CertificateRelations{}, err
		}
		relations.Deployments = append(relations.Deployments, item)
	}
	return relations, deploymentRows.Err()
}

// QueueCertificateIssue enqueues a fresh issuance after an operator confirms
// that the current configuration should replace the active certificate version.
func (s *Store) QueueCertificateIssue(ctx context.Context, certificateID string) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	owner := ownerID(ctx)
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM certificates WHERE id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid))`, certificateID, owner).Scan(&exists); err != nil {
		return "", err
	}
	if !exists {
		return "", pgx.ErrNoRows
	}
	var inProgress bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM jobs
			WHERE payload->>'certificate_id' = $1 AND kind IN ('issue', 'renew')
				AND status IN ('queued', 'running', 'waiting_user')
		)`, certificateID).Scan(&inProgress); err != nil {
		return "", err
	}
	if inProgress {
		return "", ErrCertificateJobInProgress
	}
	jobID := id.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO jobs (id, kind, status, idempotency_scope, idempotency_key, payload, next_run_at, attempt, max_attempts)
		VALUES ($1, 'issue', 'queued', $2, $3, jsonb_build_object('certificate_id', $2::text), now(), 0, 5)
	`, jobID, certificateID, "manual:"+id.New()); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `UPDATE certificates SET status = 'pending', last_error = NULL, updated_at = now() WHERE id = $1`, certificateID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload)
		VALUES ($1, 'certificate.issue.queued', 'certificate', $2, jsonb_build_object('job_id', $3::text, 'trigger', 'manual'))
	`, id.New(), certificateID, jobID); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return jobID, nil
}

func (s *Store) UpdateCertificate(ctx context.Context, certificateID string, input domain.CreateCertificateInput) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	owner := ownerID(ctx)
	if err := validateCertificateReferences(ctx, tx, input, owner); err != nil {
		return err
	}
	result, err := tx.Exec(ctx, `
		UPDATE certificates
		SET name = $2, acme_account_id = NULLIF($3, '')::uuid,
			default_dns_account_id = NULLIF($4, '')::uuid, key_algorithm = $5,
			renew_before_days = $6, validation_mode = $7, version = version + 1, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL AND ($8 = '' OR owner_user_id = $8::uuid)
	`, certificateID, strings.TrimSpace(input.Name), strings.TrimSpace(input.AcmeAccountID),
		strings.TrimSpace(input.DefaultDNSAccountID), input.KeyAlgorithm, input.RenewBeforeDays,
		input.ValidationMode, owner)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	if _, err := tx.Exec(ctx, `DELETE FROM certificate_domains WHERE certificate_id = $1`, certificateID); err != nil {
		return err
	}
	for position, domainName := range input.Domains {
		if _, err := tx.Exec(ctx, `INSERT INTO certificate_domains (id, certificate_id, domain, position) VALUES ($1, $2, $3, $4)`, id.New(), certificateID, domainName, position); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) DeleteCertificate(ctx context.Context, certificateID string) error {
	var inUse bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM automation_tasks WHERE certificate_id = $1 AND deleted_at IS NULL
		UNION ALL SELECT 1 FROM certificate_deployments WHERE certificate_id = $1 AND enabled
	)`, certificateID).Scan(&inUse); err != nil {
		return err
	}
	if inUse {
		return ErrResourceInUse
	}
	result, err := s.pool.Exec(ctx, `UPDATE certificates SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid)`, certificateID, ownerID(ctx))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) ListExecutions(ctx context.Context) ([]domain.ExecutionSummary, error) {
	owner := ownerID(ctx)
	rows, err := s.pool.Query(ctx, `
		SELECT e.id, e.kind, e.status, e.trigger_type, COALESCE(c.name, ''), COALESCE(t.name, ''), e.started_at, e.finished_at, COALESCE(e.error_message, '')
		FROM workflow_executions e
		LEFT JOIN certificates c ON c.id = e.certificate_id
		LEFT JOIN deployment_targets t ON t.id = e.deployment_target_id
		WHERE ($1 = '' OR c.owner_user_id = $1::uuid OR t.owner_user_id = $1::uuid)
		ORDER BY e.created_at DESC
		LIMIT 100
	`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	executions := make([]domain.ExecutionSummary, 0)
	for rows.Next() {
		var execution domain.ExecutionSummary
		if err := rows.Scan(&execution.ID, &execution.Kind, &execution.Status, &execution.Trigger, &execution.Certificate, &execution.Target, &execution.StartedAt, &execution.FinishedAt, &execution.Error); err != nil {
			return nil, err
		}
		executions = append(executions, execution)
	}

	return executions, rows.Err()
}

func (s *Store) CreateCertificate(ctx context.Context, input domain.CreateCertificateInput) (string, error) {
	certificateID := id.New()
	jobID := id.New()
	now := time.Now().UTC()
	owner := ownerID(ctx)
	writerID := actorID(ctx)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if err := validateCertificateReferences(ctx, tx, input, owner); err != nil {
		return "", err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO certificates (id, name, acme_account_id, default_dns_account_id, key_algorithm, challenge_type, renew_enabled, renew_before_days, validation_mode, status, owner_user_id, created_at, updated_at)
		SELECT $1, $2, NULLIF($3, '')::uuid, NULLIF($4, '')::uuid, $5, 'dns_01', false, $6, $7, 'pending', NULLIF($8, '')::uuid, $10, $10
		WHERE ($9 = '' OR EXISTS (SELECT 1 FROM acme_accounts WHERE id = NULLIF($3, '')::uuid AND owner_user_id = $9::uuid))
		  AND ($9 = '' OR $4 = '' OR EXISTS (SELECT 1 FROM dns_accounts WHERE id = NULLIF($4, '')::uuid AND owner_user_id = $9::uuid))
	`, certificateID, input.Name, input.AcmeAccountID, input.DefaultDNSAccountID, input.KeyAlgorithm, input.RenewBeforeDays, input.ValidationMode, writerID, owner, now); err != nil {
		return "", err
	}

	for position, domainName := range input.Domains {
		if _, err := tx.Exec(ctx, `INSERT INTO certificate_domains (id, certificate_id, domain, position) VALUES ($1, $2, $3, $4)`, id.New(), certificateID, domainName, position); err != nil {
			return "", err
		}
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO jobs (id, kind, status, idempotency_scope, idempotency_key, payload, next_run_at, attempt, max_attempts, created_at, updated_at)
		VALUES ($1, 'issue', 'queued', $2, 'initial-issue', jsonb_build_object('certificate_id', $2::text), $3, 0, 5, $3, $3)
	`, jobID, certificateID, now); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload, created_at)
		VALUES ($1, 'certificate.issue.queued', 'certificate', $2, jsonb_build_object('job_id', $3::text), $4)
	`, id.New(), certificateID, jobID, now); err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}

	return certificateID, nil
}

func validateCertificateReferences(ctx context.Context, tx pgx.Tx, input domain.CreateCertificateInput, owner string) error {
	var acmeAvailable bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM acme_accounts
			WHERE id = NULLIF($1, '')::uuid AND status = 'active' AND deleted_at IS NULL
			AND ($2 = '' OR owner_user_id = $2::uuid)
		)
	`, input.AcmeAccountID, owner).Scan(&acmeAvailable); err != nil {
		return err
	}
	if !acmeAvailable {
		return ErrConfigurationUnavailable
	}
	if input.ValidationMode == "manual" {
		return nil
	}
	var allowedZones []string
	if err := tx.QueryRow(ctx, `
		SELECT da.allowed_zones
		FROM dns_accounts da
		JOIN cloud_credentials cc ON cc.id = da.cloud_credential_id AND cc.deleted_at IS NULL
		WHERE da.id = NULLIF($1, '')::uuid
		  AND da.status = 'active' AND cc.status = 'active'
		  AND da.verified_credential_version_id = cc.current_version_id
		  AND da.deleted_at IS NULL
		  AND ($2 = '' OR da.owner_user_id = $2::uuid)
	`, input.DefaultDNSAccountID, owner).Scan(&allowedZones); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrConfigurationUnavailable
		}
		return err
	}
	if !certificateDomainsWithinZones(input.Domains, allowedZones) {
		return ErrDNSZoneNotAllowed
	}
	return nil
}

func certificateDomainsWithinZones(domains, allowedZones []string) bool {
	for _, domainName := range domains {
		name := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(domainName)), ".")
		name = strings.TrimPrefix(name, "*.")
		challengeFQDN := "_acme-challenge." + name
		managed := false
		for _, zone := range allowedZones {
			zone = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(zone)), ".")
			if zone != "" && (challengeFQDN == zone || strings.HasSuffix(challengeFQDN, "."+zone)) {
				managed = true
				break
			}
		}
		if !managed {
			return false
		}
	}
	return true
}

func (s *Store) ListAutomationTasks(ctx context.Context) ([]domain.AutomationTaskSummary, error) {
	owner := ownerID(ctx)
	rows, err := s.pool.Query(ctx, `
		SELECT a.id, a.name, a.certificate_id, c.name, a.action_type, a.interval_minutes, a.enabled,
			a.next_run_at, a.last_run_at, a.last_status, COALESCE(a.last_error, ''),
			(SELECT count(*) FROM automation_task_targets t WHERE t.automation_task_id = a.id AND t.enabled),
			COALESCE(a.cloud_credential_id::text, ''),
			COALESCE((SELECT array_agg(t.deployment_target_id::text ORDER BY t.position) FROM automation_task_targets t WHERE t.automation_task_id = a.id AND t.enabled), '{}'), a.created_at
		FROM automation_tasks a JOIN certificates c ON c.id = a.certificate_id
		WHERE a.deleted_at IS NULL AND ($1 = '' OR a.owner_user_id = $1::uuid) ORDER BY a.created_at DESC
	`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.AutomationTaskSummary, 0)
	for rows.Next() {
		var item domain.AutomationTaskSummary
		if err := rows.Scan(&item.ID, &item.Name, &item.CertificateID, &item.CertificateName, &item.ActionType, &item.IntervalMinutes, &item.Enabled, &item.NextRunAt, &item.LastRunAt, &item.LastStatus, &item.LastError, &item.TargetCount, &item.CloudCredentialID, &item.TargetIDs, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetAutomationTask(ctx context.Context, taskID string) (domain.AutomationTaskSummary, error) {
	var item domain.AutomationTaskSummary
	err := s.pool.QueryRow(ctx, `
		SELECT a.id, a.name, a.certificate_id, c.name, a.action_type, a.interval_minutes, a.enabled,
			a.next_run_at, a.last_run_at, a.last_status, COALESCE(a.last_error, ''),
			(SELECT count(*) FROM automation_task_targets t WHERE t.automation_task_id = a.id AND t.enabled),
			COALESCE(a.cloud_credential_id::text, ''), COALESCE((SELECT array_agg(t.deployment_target_id::text ORDER BY t.position) FROM automation_task_targets t WHERE t.automation_task_id = a.id AND t.enabled), '{}'), a.created_at
		FROM automation_tasks a JOIN certificates c ON c.id = a.certificate_id
		WHERE a.id = $1 AND a.deleted_at IS NULL AND ($2 = '' OR a.owner_user_id = $2::uuid)
	`, taskID, ownerID(ctx)).Scan(&item.ID, &item.Name, &item.CertificateID, &item.CertificateName, &item.ActionType, &item.IntervalMinutes, &item.Enabled, &item.NextRunAt, &item.LastRunAt, &item.LastStatus, &item.LastError, &item.TargetCount, &item.CloudCredentialID, &item.TargetIDs, &item.CreatedAt)
	return item, err
}

func (s *Store) ListAutomationRuns(ctx context.Context, taskID string, limit int) ([]domain.AutomationRunSummary, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.pool.Query(ctx, `
		SELECT r.id, r.automation_task_id, r.certificate_id, COALESCE(r.certificate_version_id::text, ''), r.trigger_type, r.status,
			r.total_jobs, r.succeeded_jobs, r.failed_jobs, r.started_at, r.finished_at, COALESCE(r.last_error, ''), r.created_at
		FROM automation_runs r
		JOIN automation_tasks a ON a.id = r.automation_task_id
		WHERE r.automation_task_id = $1 AND ($2 = '' OR a.owner_user_id = $2::uuid)
		ORDER BY r.created_at DESC
		LIMIT $3
	`, taskID, ownerID(ctx), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	runs := make([]domain.AutomationRunSummary, 0)
	for rows.Next() {
		var run domain.AutomationRunSummary
		if err := rows.Scan(&run.ID, &run.AutomationTaskID, &run.CertificateID, &run.CertificateVersionID, &run.TriggerType, &run.Status, &run.TotalJobs, &run.SucceededJobs, &run.FailedJobs, &run.StartedAt, &run.FinishedAt, &run.LastError, &run.CreatedAt); err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (s *Store) UpdateAutomationTask(ctx context.Context, taskID string, input domain.CreateAutomationTaskInput) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	owner := ownerID(ctx)
	result, err := tx.Exec(ctx, `UPDATE automation_tasks SET name = $2, certificate_id = $3, action_type = $4, interval_minutes = $5, cloud_credential_id = NULLIF($6, '')::uuid, enabled = $7, config_version = config_version + 1, updated_at = now() WHERE id = $1 AND deleted_at IS NULL AND ($8 = '' OR owner_user_id = $8::uuid)`, taskID, input.Name, input.CertificateID, input.ActionType, input.IntervalMinutes, input.CloudCredentialID, input.Enabled, owner)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	// Queued jobs are snapshots of the previous configuration. They must never
	// start after the task has been retargeted, paused, or otherwise changed.
	if _, err := tx.Exec(ctx, `UPDATE jobs SET status = 'cancelled', cancel_requested_at = now(), updated_at = now() WHERE automation_task_id = $1 AND status = 'queued'`, taskID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE automation_runs SET status = 'cancelled', finished_at = now(), updated_at = now() WHERE automation_task_id = $1 AND status = 'queued'`, taskID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM automation_task_targets WHERE automation_task_id = $1`, taskID); err != nil {
		return err
	}
	for position, targetID := range input.DeploymentTargetIDs {
		result, err := tx.Exec(ctx, `INSERT INTO automation_task_targets (automation_task_id, deployment_target_id, position) SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM deployment_targets WHERE id = $2 AND status = 'active' AND deleted_at IS NULL AND ($4 = '' OR owner_user_id = $4::uuid))`, taskID, targetID, position, owner)
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return fmt.Errorf("deployment target is unavailable")
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) DeleteAutomationTask(ctx context.Context, taskID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `UPDATE automation_tasks SET deleted_at = now(), enabled = false, updated_at = now() WHERE id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid)`, taskID, ownerID(ctx))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	if _, err := tx.Exec(ctx, `UPDATE jobs SET status = 'cancelled', cancel_requested_at = now(), updated_at = now() WHERE automation_task_id = $1 AND status = 'queued'`, taskID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE automation_runs SET status = 'cancelled', finished_at = now(), updated_at = now() WHERE automation_task_id = $1 AND status = 'queued'`, taskID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) CreateAutomationTask(ctx context.Context, taskID string, input domain.CreateAutomationTaskInput) error {
	if input.IntervalMinutes == 0 {
		input.IntervalMinutes = 60
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	owner := ownerID(ctx)
	writerID := actorID(ctx)
	result, err := tx.Exec(ctx, `
		INSERT INTO automation_tasks (id, name, certificate_id, action_type, interval_minutes, cloud_credential_id, enabled, next_run_at, owner_user_id)
		SELECT $1, $2, $3, $4, $5, NULLIF($6, '')::uuid, $7, now(), NULLIF($8, '')::uuid
		WHERE EXISTS (SELECT 1 FROM certificates WHERE id = $3 AND deleted_at IS NULL AND ($9 = '' OR owner_user_id = $9::uuid))
		  AND ($6 = '' OR EXISTS (SELECT 1 FROM cloud_credentials WHERE id = $6::uuid AND status = 'active' AND deleted_at IS NULL AND ($9 = '' OR owner_user_id = $9::uuid)))
	`, taskID, input.Name, input.CertificateID, input.ActionType, input.IntervalMinutes, input.CloudCredentialID, input.Enabled, writerID, owner)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("certificate is unavailable")
	}
	if input.ActionType == "deploy_alb" && len(input.DeploymentTargetIDs) == 0 {
		return fmt.Errorf("at least one deployment target is required")
	}
	for position, targetID := range input.DeploymentTargetIDs {
		result, err := tx.Exec(ctx, `
			INSERT INTO automation_task_targets (automation_task_id, deployment_target_id, position)
			SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM deployment_targets WHERE id = $2 AND status = 'active' AND deleted_at IS NULL AND ($4 = '' OR owner_user_id = $4::uuid))
		`, taskID, targetID, position, owner)
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return fmt.Errorf("deployment target is unavailable")
		}
	}
	return tx.Commit(ctx)
}

// QueueAutomationRun immediately executes a task's action as one atomic
// batch. Renewal tasks intentionally bypass the renewal window here; periodic
// checks do not.
func (s *Store) QueueAutomationRun(ctx context.Context, taskID string) (AutomationRunQueueResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AutomationRunQueueResult{}, err
	}
	defer tx.Rollback(ctx)

	var task AutomationTaskConfiguration
	if err := tx.QueryRow(ctx, `SELECT id, certificate_id, action_type, COALESCE(cloud_credential_id::text, '') FROM automation_tasks WHERE id = $1 AND enabled AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid) FOR UPDATE`, taskID, ownerID(ctx)).Scan(&task.ID, &task.CertificateID, &task.ActionType, &task.CloudCredentialID); err != nil {
		return AutomationRunQueueResult{}, err
	}
	var alreadyRunning bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM automation_runs WHERE automation_task_id = $1 AND status IN ('queued', 'running', 'waiting_user'))`, task.ID).Scan(&alreadyRunning); err != nil {
		return AutomationRunQueueResult{}, err
	}
	if alreadyRunning {
		return AutomationRunQueueResult{}, ErrAutomationRunInProgress
	}

	versionID := ""
	if task.ActionType != "renew_certificate" {
		if err := tx.QueryRow(ctx, `SELECT current_certificate_version_id::text FROM certificates WHERE id = $1 AND deleted_at IS NULL AND current_certificate_version_id IS NOT NULL`, task.CertificateID).Scan(&versionID); err != nil {
			if err == pgx.ErrNoRows {
				if _, updateErr := tx.Exec(ctx, `UPDATE automation_tasks SET last_status = 'skipped', last_error = 'waiting for an issued certificate', updated_at = now() WHERE id = $1`, task.ID); updateErr != nil {
					return AutomationRunQueueResult{}, updateErr
				}
				if err := tx.Commit(ctx); err != nil {
					return AutomationRunQueueResult{}, err
				}
				return AutomationRunQueueResult{Status: "waiting_for_certificate"}, nil
			}
			return AutomationRunQueueResult{}, err
		}
	}

	targetIDs := make([]string, 0)
	if task.ActionType == "deploy_alb" {
		rows, err := tx.Query(ctx, `SELECT deployment_target_id::text FROM automation_task_targets WHERE automation_task_id = $1 AND enabled ORDER BY position`, task.ID)
		if err != nil {
			return AutomationRunQueueResult{}, err
		}
		for rows.Next() {
			var targetID string
			if err := rows.Scan(&targetID); err != nil {
				rows.Close()
				return AutomationRunQueueResult{}, err
			}
			targetIDs = append(targetIDs, targetID)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return AutomationRunQueueResult{}, err
		}
		rows.Close()
		if len(targetIDs) == 0 {
			return AutomationRunQueueResult{}, fmt.Errorf("automation task has no enabled deployment targets")
		}
	}

	totalJobs := 1
	if task.ActionType == "deploy_alb" {
		totalJobs = len(targetIDs)
	}
	runID := id.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO automation_runs (id, automation_task_id, certificate_id, certificate_version_id, trigger_type, status, total_jobs)
		VALUES ($1, $2, $3, NULLIF($4, '')::uuid, 'manual', 'queued', $5)
	`, runID, task.ID, task.CertificateID, versionID, totalJobs); err != nil {
		return AutomationRunQueueResult{}, err
	}

	if task.ActionType == "renew_certificate" {
		key := fmt.Sprintf("manual:%s:%s", taskID, id.New())
		if _, err := tx.Exec(ctx, `
			INSERT INTO jobs (id, kind, status, idempotency_scope, idempotency_key, payload, automation_task_id, automation_run_id, next_run_at, attempt, max_attempts)
			VALUES ($1, 'renew', 'queued', $2, $3, jsonb_build_object('certificate_id', $4::text, 'automation_task_id', $5::text), $5::uuid, $6::uuid, now(), 0, 5)
		`, id.New(), taskID, key, task.CertificateID, taskID, runID); err != nil {
			return AutomationRunQueueResult{}, err
		}
	} else if task.ActionType == "upload_ssl" {
		if _, err := tx.Exec(ctx, `
			INSERT INTO jobs (id, kind, status, idempotency_scope, idempotency_key, payload, automation_task_id, automation_run_id, next_run_at, attempt, max_attempts)
			VALUES ($1, 'upload', 'queued', $2, $3, jsonb_build_object('certificate_id', $4::text, 'cloud_credential_id', $5::text), $2::uuid, $6::uuid, now(), 0, 5)
		`, id.New(), task.ID, "manual:"+id.New(), task.CertificateID, task.CloudCredentialID, runID); err != nil {
			return AutomationRunQueueResult{}, err
		}
	} else {
		for _, targetID := range targetIDs {
			if _, err := tx.Exec(ctx, `
				INSERT INTO jobs (id, kind, status, idempotency_scope, idempotency_key, payload, automation_task_id, automation_run_id, next_run_at, attempt, max_attempts)
				VALUES ($1, 'deploy', 'queued', $2, $3, jsonb_build_object('certificate_id', $4::text, 'deployment_target_id', $5::text), $2::uuid, $6::uuid, now(), 0, 5)
			`, id.New(), task.ID, "manual:"+id.New(), task.CertificateID, targetID, runID); err != nil {
				return AutomationRunQueueResult{}, err
			}
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE automation_tasks SET last_status = 'queued', last_error = NULL, last_run_at = now(), updated_at = now() WHERE id = $1`, task.ID); err != nil {
		return AutomationRunQueueResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AutomationRunQueueResult{}, err
	}
	return AutomationRunQueueResult{ID: runID, Status: "queued"}, nil
}

func (s *Store) markAutomationQueued(ctx context.Context, taskID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE automation_tasks SET last_status = 'queued', last_error = NULL, last_run_at = now(), updated_at = now() WHERE id = $1`, taskID)
	return err
}

func (s *Store) QueueDueAutomationTasks(ctx context.Context) (int, error) {
	queued := 0
	for {
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return 0, err
		}

		var taskID, certificateID, certificateVersionID string
		var interval int
		err = tx.QueryRow(ctx, `
			SELECT a.id, a.certificate_id, c.current_certificate_version_id::text, a.interval_minutes
			FROM automation_tasks a
			JOIN certificates c ON c.id = a.certificate_id
			JOIN certificate_versions v ON v.id = c.current_certificate_version_id
			WHERE a.enabled AND a.deleted_at IS NULL AND a.action_type = 'renew_certificate' AND a.next_run_at <= now()
			  AND c.deleted_at IS NULL
			  AND v.not_after <= now() + (c.renew_before_days * interval '1 day')
			  AND NOT EXISTS (
				SELECT 1 FROM jobs j
				WHERE j.kind IN ('issue', 'renew')
				  AND j.status IN ('queued', 'running')
				  AND j.payload->>'certificate_id' = c.id::text
			  )
			ORDER BY a.next_run_at
			FOR UPDATE OF a SKIP LOCKED
			LIMIT 1
		`).Scan(&taskID, &certificateID, &certificateVersionID, &interval)
		if err == pgx.ErrNoRows {
			tx.Rollback(ctx)
			break
		}
		if err != nil {
			tx.Rollback(ctx)
			return 0, err
		}

		runID := id.New()
		if _, err := tx.Exec(ctx, `
			INSERT INTO automation_runs (id, automation_task_id, certificate_id, certificate_version_id, trigger_type, status, total_jobs)
			VALUES ($1, $2::uuid, $3::uuid, $4::uuid, 'scheduler', 'queued', 1)
		`, runID, taskID, certificateID, certificateVersionID); err != nil {
			tx.Rollback(ctx)
			return 0, err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO jobs (id, kind, status, idempotency_scope, idempotency_key, payload, automation_task_id, automation_run_id, next_run_at, attempt, max_attempts)
			VALUES ($1, 'renew', 'queued', $2, $3, jsonb_build_object('certificate_id', $4::text, 'automation_task_id', $5::text), $5::uuid, $6::uuid, now(), 0, 5)
		`, id.New(), taskID, "scheduler:"+taskID, "scheduler:"+id.New(), certificateID, taskID, runID); err != nil {
			tx.Rollback(ctx)
			return 0, err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE automation_tasks
			SET last_status = 'queued', last_error = NULL, last_run_at = now(),
				next_run_at = now() + ($2 * interval '1 minute'), updated_at = now()
			WHERE id = $1
		`, taskID, interval); err != nil {
			tx.Rollback(ctx)
			return 0, err
		}
		if err := tx.Commit(ctx); err != nil {
			return 0, err
		}
		queued++
	}
	return queued, nil
}

func (s *Store) queueUpload(ctx context.Context, taskID, certificateID, credentialID, versionID string, manual bool) error {
	key := versionID
	if manual {
		key = "manual:" + id.New()
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO jobs (id, kind, status, idempotency_scope, idempotency_key, payload, automation_task_id, next_run_at, attempt, max_attempts)
		VALUES ($1, 'upload', 'queued', $2, $3, jsonb_build_object('certificate_id', $4::text, 'cloud_credential_id', $5::text), $6::uuid, now(), 0, 5)
		ON CONFLICT (idempotency_scope, idempotency_key) DO NOTHING
	`, id.New(), taskID, key, certificateID, credentialID, taskID)
	return err
}

func (s *Store) queueAutomationDeployment(ctx context.Context, taskID, certificateID, targetID, versionID string, manual bool) error {
	key := versionID + ":" + targetID
	if manual {
		key = "manual:" + id.New()
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO jobs (id, kind, status, idempotency_scope, idempotency_key, payload, automation_task_id, next_run_at, attempt, max_attempts)
		VALUES ($1, 'deploy', 'queued', $2, $3, jsonb_build_object('certificate_id', $4::text, 'deployment_target_id', $5::text), $6::uuid, now(), 0, 5)
		ON CONFLICT (idempotency_scope, idempotency_key) DO NOTHING
	`, id.New(), taskID, key, certificateID, targetID, taskID)
	return err
}

func (s *Store) SaveManualChallenge(ctx context.Context, challenge ManualChallenge) error {
	authz, err := json.Marshal(challenge.AuthorizationURLs)
	if err != nil {
		return err
	}
	items, err := json.Marshal(challenge.Challenges)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO manual_validation_challenges (id, job_id, certificate_id, order_url, authorization_urls, challenges, status)
		VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'waiting_user')
		ON CONFLICT (job_id) DO UPDATE SET order_url = EXCLUDED.order_url, authorization_urls = EXCLUDED.authorization_urls, challenges = EXCLUDED.challenges, status = 'waiting_user', approved_at = NULL, consumed_at = NULL
	`, challenge.ID, challenge.JobID, challenge.CertificateID, challenge.OrderURL, authz, items)
	return err
}

func (s *Store) GetManualChallenge(ctx context.Context, certificateID string) (ManualChallenge, error) {
	var challenge ManualChallenge
	var authz, items []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id, job_id, certificate_id, order_url, authorization_urls, challenges, status
		FROM manual_validation_challenges
		WHERE certificate_id = $1 AND status IN ('waiting_user', 'approved') AND ($2 = '' OR EXISTS (SELECT 1 FROM certificates c WHERE c.id = certificate_id AND c.owner_user_id = $2::uuid))
		ORDER BY created_at DESC LIMIT 1
	`, certificateID, ownerID(ctx)).Scan(&challenge.ID, &challenge.JobID, &challenge.CertificateID, &challenge.OrderURL, &authz, &items, &challenge.Status)
	if err != nil {
		return ManualChallenge{}, err
	}
	if err := json.Unmarshal(authz, &challenge.AuthorizationURLs); err != nil {
		return ManualChallenge{}, err
	}
	if err := json.Unmarshal(items, &challenge.Challenges); err != nil {
		return ManualChallenge{}, err
	}
	return challenge, nil
}

func (s *Store) ApproveManualChallenge(ctx context.Context, certificateID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var jobID string
	if err := tx.QueryRow(ctx, `SELECT m.job_id FROM manual_validation_challenges m WHERE m.certificate_id = $1 AND m.status = 'waiting_user' AND ($2 = '' OR EXISTS (SELECT 1 FROM certificates c WHERE c.id = m.certificate_id AND c.owner_user_id = $2::uuid)) ORDER BY m.created_at DESC LIMIT 1 FOR UPDATE`, certificateID, ownerID(ctx)).Scan(&jobID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE manual_validation_challenges SET status = 'approved', approved_at = now() WHERE job_id = $1`, jobID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE jobs SET status = 'queued', next_run_at = now(), updated_at = now() WHERE id = $1 AND status = 'waiting_user'`, jobID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) MarkJobWaitingUser(ctx context.Context, job ClaimedJob, workerID string, failure JobFailure) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE jobs SET status = 'waiting_user', lease_owner = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1 AND status = 'running' AND lease_owner = $2`, job.ID, workerID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE workflow_executions SET status = 'waiting_user', error_code = $2, error_message = $3 WHERE id = $1 AND status = 'running'`, job.ExecutionID, failure.Code, truncateError(failure.Message)); err != nil {
		return err
	}
	if job.AutomationRunID != "" {
		if err := refreshAutomationRun(ctx, tx, job.AutomationRunID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) ConsumeManualChallenge(ctx context.Context, jobID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE manual_validation_challenges SET status = 'consumed', consumed_at = now() WHERE job_id = $1 AND status = 'approved'`, jobID)
	return err
}

func (s *Store) ListCloudCredentials(ctx context.Context) ([]domain.CloudCredentialSummary, error) {
	owner := ownerID(ctx)
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, description, provider, access_key_id, credential_hint, status, last_verified_at, COALESCE(last_error, ''), created_at
		FROM cloud_credentials
		WHERE deleted_at IS NULL AND ($1 = '' OR owner_user_id = $1::uuid)
		ORDER BY created_at DESC
	`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	credentials := make([]domain.CloudCredentialSummary, 0)
	for rows.Next() {
		var credential domain.CloudCredentialSummary
		if err := rows.Scan(&credential.ID, &credential.Name, &credential.Description, &credential.Provider, &credential.AccessKeyID, &credential.CredentialHint, &credential.Status, &credential.LastVerifiedAt, &credential.LastError, &credential.CreatedAt); err != nil {
			return nil, err
		}
		credentials = append(credentials, credential)
	}
	return credentials, rows.Err()
}

func (s *Store) CreateCloudCredential(ctx context.Context, credentialID, versionID string, input domain.CreateCloudCredentialInput, accessKeyID, hint string, ciphertext []byte) error {
	now := time.Now().UTC()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Use provider from input, default to 'aliyun' for backward compatibility
	provider := input.Provider
	if provider == "" {
		provider = "aliyun"
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO cloud_credentials (id, name, description, provider, access_key_id, credential_hint, status, last_verified_at, current_version_id, owner_user_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'active', $8, NULL, NULLIF($7, '')::uuid, $8, $8)
	`, credentialID, input.Name, input.Description, provider, accessKeyID, hint, actorID(ctx), now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO cloud_credential_versions (id, cloud_credential_id, credentials_ciphertext, credential_hint, version, created_at)
		VALUES ($1, $2, $3, $4, 1, $5)
	`, versionID, credentialID, ciphertext, hint, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE cloud_credentials SET current_version_id = $2 WHERE id = $1`, credentialID, versionID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) GetCloudCredential(ctx context.Context, credentialID string) (domain.CloudCredentialSummary, error) {
	var credential domain.CloudCredentialSummary
	err := s.pool.QueryRow(ctx, `
		SELECT id, name, description, provider, access_key_id, credential_hint, status, last_verified_at, COALESCE(last_error, ''), created_at
		FROM cloud_credentials
		WHERE id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid)
	`, credentialID, ownerID(ctx)).Scan(
		&credential.ID, &credential.Name, &credential.Description, &credential.Provider, &credential.AccessKeyID, &credential.CredentialHint,
		&credential.Status, &credential.LastVerifiedAt, &credential.LastError, &credential.CreatedAt,
	)
	return credential, err
}

// RecordCloudCredentialVerification stores the result of a live provider
// check. Disabled credentials keep their intentional disabled state until an
// explicit enable operation succeeds.
func (s *Store) RecordCloudCredentialVerification(ctx context.Context, credentialID string, valid bool, message string) (string, error) {
	var status string
	err := s.pool.QueryRow(ctx, `
		UPDATE cloud_credentials
		SET status = CASE
			WHEN status = 'disabled' THEN 'disabled'
			WHEN $2 THEN 'active'
			ELSE 'invalid'
		END,
			last_verified_at = now(),
			last_error = NULLIF($3, ''),
			updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL AND ($4 = '' OR owner_user_id = $4::uuid)
		RETURNING status
	`, credentialID, valid, truncateError(strings.TrimSpace(message)), ownerID(ctx)).Scan(&status)
	if err == nil && !valid {
		_, _ = s.pool.Exec(ctx, `
			UPDATE dns_accounts
			SET status = 'invalid', last_error = 'the referenced cloud credential failed verification', updated_at = now()
			WHERE cloud_credential_id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid)
		`, credentialID, ownerID(ctx))
	}
	return status, err
}

func (s *Store) SetCloudCredentialStatus(ctx context.Context, credentialID, status string) error {
	result, err := s.pool.Exec(ctx, `
		UPDATE cloud_credentials SET status = $2, last_error = NULL, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL AND ($3 = '' OR owner_user_id = $3::uuid)
	`, credentialID, status, ownerID(ctx))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	if status != "active" {
		if _, err := s.pool.Exec(ctx, `
			UPDATE dns_accounts
			SET status = 'invalid', last_error = 'the referenced cloud credential is disabled', updated_at = now()
			WHERE cloud_credential_id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid)
		`, credentialID, ownerID(ctx)); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) UpdateCloudCredential(ctx context.Context, credentialID, versionID string, input domain.CreateCloudCredentialInput, accessKeyID, hint string, ciphertext []byte) error {
	if versionID != "" || accessKeyID != "" || len(ciphertext) > 0 {
		return fmt.Errorf("cloud credential access keys are immutable")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	owner := ownerID(ctx)
	result, err := tx.Exec(ctx, `
		UPDATE cloud_credentials SET name = $2, description = $3,
			access_key_id = CASE WHEN $4 <> '' THEN $4 ELSE access_key_id END,
			updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL AND ($5 = '' OR owner_user_id = $5::uuid)
	`, credentialID, input.Name, input.Description, accessKeyID, owner)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	if len(ciphertext) == 0 {
		return tx.Commit(ctx)
	}

	var nextVersion int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(version), 0) + 1 FROM cloud_credential_versions WHERE cloud_credential_id = $1`, credentialID).Scan(&nextVersion); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO cloud_credential_versions (id, cloud_credential_id, credentials_ciphertext, credential_hint, version, created_at)
		VALUES ($1, $2, $3, $4, $5, now())
	`, versionID, credentialID, ciphertext, hint, nextVersion); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE cloud_credential_versions SET retired_at = now()
		WHERE cloud_credential_id = $1 AND id <> $2 AND retired_at IS NULL
	`, credentialID, versionID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE cloud_credentials SET current_version_id = $2, credential_hint = $3, updated_at = now() WHERE id = $1`, credentialID, versionID, hint)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) DeleteCloudCredential(ctx context.Context, credentialID string) error {
	var inUse bool
	owner := ownerID(ctx)
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM dns_accounts WHERE cloud_credential_id = $1 AND deleted_at IS NULL
			UNION ALL SELECT 1 FROM deployment_targets WHERE cloud_credential_id = $1 AND deleted_at IS NULL
			UNION ALL SELECT 1 FROM automation_tasks WHERE cloud_credential_id = $1 AND deleted_at IS NULL
		)
	`, credentialID).Scan(&inUse); err != nil {
		return err
	}
	if inUse {
		return ErrResourceInUse
	}
	result, err := s.pool.Exec(ctx, `UPDATE cloud_credentials SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid)`, credentialID, owner)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) LoadCloudCredentialMaterial(ctx context.Context, credentialID string) (CloudCredentialMaterial, error) {
	var material CloudCredentialMaterial
	err := s.pool.QueryRow(ctx, `
		SELECT cc.provider, ccv.id, ccv.credentials_ciphertext, cc.status
		FROM cloud_credentials cc JOIN cloud_credential_versions ccv ON ccv.id = cc.current_version_id AND ccv.retired_at IS NULL
		WHERE cc.id = $1 AND cc.deleted_at IS NULL AND ($2 = '' OR cc.owner_user_id = $2::uuid)
	`, credentialID, ownerID(ctx)).Scan(&material.Provider, &material.VersionID, &material.CredentialsCiphertext, &material.Status)
	return material, err
}

func (s *Store) ListACMEAccounts(ctx context.Context) ([]domain.ACMEAccountSummary, error) {
	owner := ownerID(ctx)
	rows, err := s.pool.Query(ctx, `
		SELECT a.id, a.name, a.directory_url, COALESCE(a.account_url, ''), a.email, a.private_key_algorithm, a.status,
			a.last_verified_at, COALESCE(a.last_error, ''),
			(SELECT count(*) FROM certificates c WHERE c.acme_account_id = a.id AND c.deleted_at IS NULL),
			(SELECT count(*) FROM automation_tasks t JOIN certificates c ON c.id = t.certificate_id
			 WHERE c.acme_account_id = a.id AND c.deleted_at IS NULL AND t.deleted_at IS NULL),
			a.created_at
		FROM acme_accounts a
		WHERE a.deleted_at IS NULL AND ($1 = '' OR a.owner_user_id = $1::uuid)
		ORDER BY created_at DESC
	`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	accounts := make([]domain.ACMEAccountSummary, 0)
	for rows.Next() {
		var account domain.ACMEAccountSummary
		if err := rows.Scan(&account.ID, &account.Name, &account.DirectoryURL, &account.AccountURL, &account.Email, &account.PrivateKeyAlgorithm, &account.Status,
			&account.LastVerifiedAt, &account.LastError, &account.CertificateCount, &account.AutomationCount, &account.CreatedAt); err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

func (s *Store) CreateACMEAccount(ctx context.Context, accountID string, input domain.CreateACMEAccountInput, ciphertext []byte, accountURL string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO acme_accounts (id, name, directory_url, email, account_url, private_key_ciphertext, private_key_algorithm, status, last_verified_at, last_error, owner_user_id)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, 'active', now(), '', NULLIF($8, '')::uuid)
	`, accountID, input.Name, input.DirectoryURL, input.Email, accountURL, ciphertext, input.PrivateKeyAlgorithm, actorID(ctx))
	return err
}

func (s *Store) GetACMEAccount(ctx context.Context, accountID string) (domain.ACMEAccountSummary, error) {
	var account domain.ACMEAccountSummary
	err := s.pool.QueryRow(ctx, `
		SELECT a.id, a.name, a.directory_url, COALESCE(a.account_url, ''), a.email, a.private_key_algorithm, a.status,
			a.last_verified_at, COALESCE(a.last_error, ''),
			(SELECT count(*) FROM certificates c WHERE c.acme_account_id = a.id AND c.deleted_at IS NULL),
			(SELECT count(*) FROM automation_tasks t JOIN certificates c ON c.id = t.certificate_id
			 WHERE c.acme_account_id = a.id AND c.deleted_at IS NULL AND t.deleted_at IS NULL),
			a.created_at
		FROM acme_accounts a
		WHERE a.id = $1 AND a.deleted_at IS NULL AND ($2 = '' OR a.owner_user_id = $2::uuid)
	`, accountID, ownerID(ctx)).Scan(&account.ID, &account.Name, &account.DirectoryURL, &account.AccountURL, &account.Email, &account.PrivateKeyAlgorithm, &account.Status,
		&account.LastVerifiedAt, &account.LastError, &account.CertificateCount, &account.AutomationCount, &account.CreatedAt)
	return account, err
}

func (s *Store) UpdateACMEAccount(ctx context.Context, accountID string, input domain.CreateACMEAccountInput, ciphertext []byte, accountURL string) error {
	result, err := s.pool.Exec(ctx, `
		UPDATE acme_accounts
		SET name = $2, directory_url = $3, email = $4,
			account_url = NULLIF($5, ''),
			private_key_ciphertext = CASE WHEN octet_length($6::bytea) > 0 THEN $6 ELSE private_key_ciphertext END,
			private_key_algorithm = CASE WHEN octet_length($6::bytea) > 0 THEN $7 ELSE private_key_algorithm END,
			status = 'active', last_verified_at = now(), last_error = '',
			updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL AND ($8 = '' OR owner_user_id = $8::uuid)
	`, accountID, input.Name, input.DirectoryURL, input.Email, accountURL, ciphertext, input.PrivateKeyAlgorithm, ownerID(ctx))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

type ACMEAccountMaterial struct {
	DirectoryURL string
	Email        string
	AccountURL   string
	PrivateKey   []byte
}

func (s *Store) LoadACMEAccountMaterial(ctx context.Context, accountID string) (ACMEAccountMaterial, error) {
	var material ACMEAccountMaterial
	err := s.pool.QueryRow(ctx, `
		SELECT directory_url, email, COALESCE(account_url, ''), private_key_ciphertext
		FROM acme_accounts
		WHERE id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid)
	`, accountID, ownerID(ctx)).Scan(&material.DirectoryURL, &material.Email, &material.AccountURL, &material.PrivateKey)
	return material, err
}

func (s *Store) SetACMEAccountVerification(ctx context.Context, accountID, status, lastError, accountURL string) error {
	result, err := s.pool.Exec(ctx, `
		UPDATE acme_accounts
		SET status = $2, last_error = $3, account_url = COALESCE(NULLIF($4, ''), account_url),
			last_verified_at = CASE WHEN $2 = 'active' THEN now() ELSE last_verified_at END, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL AND ($5 = '' OR owner_user_id = $5::uuid)
	`, accountID, status, lastError, accountURL, ownerID(ctx))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) DeleteACMEAccount(ctx context.Context, accountID string) error {
	var inUse bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM certificates WHERE acme_account_id = $1 AND deleted_at IS NULL)`, accountID).Scan(&inUse); err != nil {
		return err
	}
	if inUse {
		return ErrResourceInUse
	}
	result, err := s.pool.Exec(ctx, `UPDATE acme_accounts SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid)`, accountID, ownerID(ctx))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) ListDNSAccounts(ctx context.Context) ([]domain.DNSAccountSummary, error) {
	owner := ownerID(ctx)
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, description, provider, cloud_credential_id, allowed_zones, status, last_verified_at,
			COALESCE(last_error, ''), COALESCE(verified_credential_version_id::text, ''), created_at
		FROM dns_accounts
		WHERE deleted_at IS NULL AND ($1 = '' OR owner_user_id = $1::uuid)
		ORDER BY created_at DESC
	`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	accounts := make([]domain.DNSAccountSummary, 0)
	for rows.Next() {
		var account domain.DNSAccountSummary
		if err := rows.Scan(&account.ID, &account.Name, &account.Description, &account.Provider, &account.CloudCredentialID, &account.AllowedZones, &account.Status, &account.LastVerifiedAt, &account.LastError, &account.VerifiedCredentialVersionID, &account.CreatedAt); err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

func (s *Store) CreateDNSAccount(ctx context.Context, accountID string, input domain.CreateDNSAccountInput) error {
	var versionID string
	if err := s.pool.QueryRow(ctx, `SELECT current_version_id::text FROM cloud_credentials WHERE id = $1 AND status = 'active' AND deleted_at IS NULL AND current_version_id IS NOT NULL AND ($2 = '' OR owner_user_id = $2::uuid)`, input.CloudCredentialID, ownerID(ctx)).Scan(&versionID); err != nil {
		return err
	}

	_, err := s.pool.Exec(ctx, `
		INSERT INTO dns_accounts (id, name, description, provider, cloud_credential_id, allowed_zones, status, last_verified_at, verified_credential_version_id, owner_user_id)
		VALUES ($1, $2, $3, 'aliyun', $4, $5, 'active', now(), $6::uuid, NULLIF($7, '')::uuid)
	`, accountID, input.Name, input.Description, input.CloudCredentialID, input.AllowedZones, versionID, actorID(ctx))
	return err
}

func (s *Store) GetDNSAccount(ctx context.Context, accountID string) (domain.DNSAccountSummary, error) {
	var account domain.DNSAccountSummary
	err := s.pool.QueryRow(ctx, `
		SELECT id, name, description, provider, cloud_credential_id, allowed_zones, status, last_verified_at,
			COALESCE(last_error, ''), COALESCE(verified_credential_version_id::text, ''), created_at
		FROM dns_accounts
		WHERE id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid)
	`, accountID, ownerID(ctx)).Scan(&account.ID, &account.Name, &account.Description, &account.Provider, &account.CloudCredentialID, &account.AllowedZones, &account.Status, &account.LastVerifiedAt, &account.LastError, &account.VerifiedCredentialVersionID, &account.CreatedAt)
	return account, err
}

func (s *Store) UpdateDNSAccount(ctx context.Context, accountID string, input domain.CreateDNSAccountInput) error {
	owner := ownerID(ctx)
	var versionID string
	if err := s.pool.QueryRow(ctx, `SELECT current_version_id::text FROM cloud_credentials WHERE id = $1 AND status = 'active' AND deleted_at IS NULL AND current_version_id IS NOT NULL AND ($2 = '' OR owner_user_id = $2::uuid)`, input.CloudCredentialID, owner).Scan(&versionID); err != nil {
		return err
	}
	result, err := s.pool.Exec(ctx, `
		UPDATE dns_accounts SET name = $2, description = $3, cloud_credential_id = $4, allowed_zones = $5,
			status = 'active', last_verified_at = now(), last_error = NULL,
			verified_credential_version_id = $6::uuid, config_version = config_version + 1, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL AND ($7 = '' OR owner_user_id = $7::uuid)
	`, accountID, input.Name, input.Description, input.CloudCredentialID, input.AllowedZones, versionID, owner)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) DeleteDNSAccount(ctx context.Context, accountID string) error {
	var certificateRefs, validationRefs, runningJobRefs int
	if err := s.pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM certificates WHERE default_dns_account_id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid)),
			(SELECT count(*) FROM certificate_domain_validations v
				JOIN certificate_domains d ON d.id = v.certificate_domain_id
				JOIN certificates c ON c.id = d.certificate_id
				WHERE v.dns_account_id = $1 AND c.deleted_at IS NULL AND ($2 = '' OR c.owner_user_id = $2::uuid)),
			(SELECT count(*) FROM jobs j
				WHERE j.status IN ('queued', 'running', 'waiting_user')
				AND EXISTS (
					SELECT 1 FROM certificates c
					WHERE c.default_dns_account_id = $1 AND c.deleted_at IS NULL
					AND j.payload->>'certificate_id' = c.id::text
					AND ($2 = '' OR c.owner_user_id = $2::uuid)
				))
	`, accountID, ownerID(ctx)).Scan(&certificateRefs, &validationRefs, &runningJobRefs); err != nil {
		return err
	}
	if certificateRefs+validationRefs+runningJobRefs > 0 {
		return &ResourceInUseError{References: map[string]int{
			"certificates":      certificateRefs,
			"domainValidations": validationRefs,
			"runningJobs":       runningJobRefs,
		}}
	}
	result, err := s.pool.Exec(ctx, `UPDATE dns_accounts SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid)`, accountID, ownerID(ctx))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// SetDNSAccountVerification records the result of a live DNS read/write
// check. A successful check binds the account to the exact cloud credential
// version that was tested, preventing silent use after credential rotation.
func (s *Store) SetDNSAccountVerification(ctx context.Context, accountID, status, lastError, credentialVersionID string) error {
	result, err := s.pool.Exec(ctx, `
		UPDATE dns_accounts
		SET status = $2,
			last_error = NULLIF($3, ''),
			last_verified_at = now(),
			verified_credential_version_id = CASE WHEN $2 = 'active' THEN NULLIF($4, '')::uuid ELSE verified_credential_version_id END,
			updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL AND ($5 = '' OR owner_user_id = $5::uuid)
	`, accountID, status, truncateError(strings.TrimSpace(lastError)), credentialVersionID, ownerID(ctx))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) ListDeploymentTargets(ctx context.Context) ([]domain.DeploymentTargetSummary, error) {
	owner := ownerID(ctx)
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, cloud_credential_id, config->>'region_id', config->>'load_balancer_id', config->>'listener_id', config->>'listener_protocol', status, created_at
		FROM deployment_targets WHERE deleted_at IS NULL AND ($1 = '' OR owner_user_id = $1::uuid) ORDER BY created_at DESC
	`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.DeploymentTargetSummary, 0)
	for rows.Next() {
		var item domain.DeploymentTargetSummary
		if err := rows.Scan(&item.ID, &item.Name, &item.CloudCredentialID, &item.RegionID, &item.LoadBalancerID, &item.ListenerID, &item.ListenerProtocol, &item.Status, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetDeploymentTarget(ctx context.Context, targetID string) (domain.DeploymentTargetSummary, error) {
	var item domain.DeploymentTargetSummary
	err := s.pool.QueryRow(ctx, `
		SELECT id, name, cloud_credential_id, config->>'region_id', config->>'load_balancer_id', config->>'listener_id', config->>'listener_protocol', status, created_at
		FROM deployment_targets WHERE id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid)
	`, targetID, ownerID(ctx)).Scan(&item.ID, &item.Name, &item.CloudCredentialID, &item.RegionID, &item.LoadBalancerID, &item.ListenerID, &item.ListenerProtocol, &item.Status, &item.CreatedAt)
	return item, err
}

func (s *Store) UpdateDeploymentTarget(ctx context.Context, targetID string, input domain.CreateDeploymentTargetInput, listenerProtocol string) error {
	config, err := json.Marshal(map[string]string{"region_id": input.RegionID, "load_balancer_id": input.LoadBalancerID, "listener_id": input.ListenerID, "listener_protocol": listenerProtocol})
	if err != nil {
		return err
	}
	result, err := s.pool.Exec(ctx, `
		UPDATE deployment_targets SET name = $2, cloud_credential_id = $3, config = $4::jsonb, config_version = config_version + 1, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL AND ($5 = '' OR owner_user_id = $5::uuid)
	`, targetID, input.Name, input.CloudCredentialID, config, ownerID(ctx))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) DeleteDeploymentTarget(ctx context.Context, targetID string) error {
	var inUse bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM automation_task_targets WHERE deployment_target_id = $1 AND enabled UNION ALL SELECT 1 FROM certificate_deployments WHERE deployment_target_id = $1 AND enabled)`, targetID).Scan(&inUse); err != nil {
		return err
	}
	if inUse {
		return ErrResourceInUse
	}
	result, err := s.pool.Exec(ctx, `UPDATE deployment_targets SET deleted_at = now(), status = 'disabled', updated_at = now() WHERE id = $1 AND deleted_at IS NULL AND ($2 = '' OR owner_user_id = $2::uuid)`, targetID, ownerID(ctx))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *Store) CreateDeploymentTarget(ctx context.Context, targetID string, input domain.CreateDeploymentTargetInput, listenerProtocol string) error {
	config, err := json.Marshal(map[string]string{"region_id": input.RegionID, "load_balancer_id": input.LoadBalancerID, "listener_id": input.ListenerID, "listener_protocol": listenerProtocol})
	if err != nil {
		return err
	}
	result, err := s.pool.Exec(ctx, `
		INSERT INTO deployment_targets (id, name, type, cloud_credential_id, config, status, owner_user_id)
		SELECT $1, $2, 'aliyun_alb', $3, $4::jsonb, 'active', NULLIF($5, '')::uuid
		WHERE EXISTS (SELECT 1 FROM cloud_credentials WHERE id = $3 AND status = 'active' AND deleted_at IS NULL AND ($5 = '' OR owner_user_id = $5::uuid))
	`, targetID, input.Name, input.CloudCredentialID, config, actorID(ctx))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("cloud credential is unavailable")
	}
	return nil
}

func (s *Store) ListCertificateDeployments(ctx context.Context) ([]domain.CertificateDeploymentSummary, error) {
	owner := ownerID(ctx)
	rows, err := s.pool.Query(ctx, `
		SELECT d.id, d.certificate_id, d.deployment_target_id, t.name, d.auto_deploy, d.enabled, d.last_deployed_at, COALESCE(d.last_error, '')
		FROM certificate_deployments d JOIN deployment_targets t ON t.id = d.deployment_target_id
		WHERE ($1 = '' OR d.owner_user_id = $1::uuid)
		ORDER BY d.created_at DESC
	`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.CertificateDeploymentSummary, 0)
	for rows.Next() {
		var item domain.CertificateDeploymentSummary
		if err := rows.Scan(&item.ID, &item.CertificateID, &item.TargetID, &item.TargetName, &item.AutoDeploy, &item.Enabled, &item.LastDeployedAt, &item.LastError); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) CreateCertificateDeployment(ctx context.Context, deploymentID string, input domain.CreateCertificateDeploymentInput) error {
	result, err := s.pool.Exec(ctx, `
		INSERT INTO certificate_deployments (id, certificate_id, deployment_target_id, auto_deploy, enabled, owner_user_id)
		SELECT $1, $2, $3, $4, true, NULLIF($5, '')::uuid
		WHERE EXISTS (SELECT 1 FROM certificates WHERE id = $2 AND deleted_at IS NULL AND ($5 = '' OR owner_user_id = $5::uuid))
		  AND EXISTS (SELECT 1 FROM deployment_targets WHERE id = $3 AND status = 'active' AND deleted_at IS NULL AND ($5 = '' OR owner_user_id = $5::uuid))
	`, deploymentID, input.CertificateID, input.TargetID, input.AutoDeploy, actorID(ctx))
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("certificate or deployment target is unavailable")
	}
	return nil
}

func (s *Store) QueueDeployment(ctx context.Context, deploymentID string) error {
	var certificateID, targetID, versionID string
	err := s.pool.QueryRow(ctx, `
		SELECT d.certificate_id, d.deployment_target_id, c.current_certificate_version_id::text
		FROM certificate_deployments d JOIN certificates c ON c.id = d.certificate_id
		WHERE d.id = $1 AND d.enabled AND c.current_certificate_version_id IS NOT NULL AND ($2 = '' OR d.owner_user_id = $2::uuid)
	`, deploymentID, ownerID(ctx)).Scan(&certificateID, &targetID, &versionID)
	if err != nil {
		return err
	}
	return s.queueDeployment(ctx, certificateID, targetID, versionID)
}

func (s *Store) queueDeployment(ctx context.Context, certificateID, targetID, versionID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO jobs (id, kind, status, idempotency_scope, idempotency_key, payload, next_run_at, attempt, max_attempts)
		VALUES ($1, 'deploy', 'queued', $2, $3, jsonb_build_object('certificate_id', $4::text, 'deployment_target_id', $5::text), now(), 0, 5)
		ON CONFLICT (idempotency_scope, idempotency_key) DO NOTHING
	`, id.New(), targetID, versionID, certificateID, targetID)
	return err
}

func (s *Store) LoadDeploymentConfiguration(ctx context.Context, taskID, certificateID, targetID string) (DeploymentConfiguration, error) {
	var config DeploymentConfiguration
	err := s.pool.QueryRow(ctx, `
		SELECT c.id, t.id, t.name, t.config->>'region_id', t.config->>'load_balancer_id', t.config->>'listener_id', COALESCE(asset.remote_certificate_id, att.remote_certificate_id, d.remote_certificate_id, ''), COALESCE(asset.certificate_version_id::text, att.last_uploaded_version_id::text, d.last_deployed_version_id::text, ''),
			v.id, v.certificate_ciphertext, v.private_key_ciphertext, v.chain_ciphertext,
			cc.id, cc.provider, ccv.id, ccv.credentials_ciphertext, cc.status
		FROM certificates c
		JOIN certificate_versions v ON v.id = c.current_certificate_version_id
		JOIN deployment_targets t ON t.id = $3 AND t.status = 'active' AND t.deleted_at IS NULL
		JOIN cloud_credentials cc ON cc.id = t.cloud_credential_id AND cc.deleted_at IS NULL
		JOIN cloud_credential_versions ccv ON ccv.id = cc.current_version_id AND ccv.retired_at IS NULL
		LEFT JOIN automation_tasks a ON a.id = NULLIF($1, '')::uuid AND a.action_type = 'deploy_alb' AND a.enabled AND a.deleted_at IS NULL
		LEFT JOIN automation_task_targets att ON att.automation_task_id = a.id AND att.deployment_target_id = t.id AND att.enabled
		LEFT JOIN certificate_deployments d ON d.certificate_id = c.id AND d.deployment_target_id = t.id
		LEFT JOIN certificate_cloud_assets asset ON asset.certificate_version_id = v.id AND asset.cloud_credential_id = cc.id
		WHERE c.id = $2 AND c.deleted_at IS NULL
	`, taskID, certificateID, targetID).Scan(&config.CertificateID, &config.TargetID, &config.TargetName, &config.RegionID, &config.LoadBalancerID, &config.ListenerID, &config.RemoteCertificateID, &config.LastUploadedVersionID,
		&config.CertificateVersionID, &config.CertificateCiphertext, &config.PrivateKeyCiphertext, &config.ChainCiphertext,
		&config.CloudCredential.ID, &config.CloudCredential.Provider, &config.CloudCredential.VersionID, &config.CloudCredential.CredentialsCiphertext, &config.CloudCredential.Status)
	return config, err
}

func (s *Store) MarkAutomationRemoteCertificate(ctx context.Context, taskID, targetID, versionID, remoteCertificateID string) error {
	if targetID != "" {
		result, err := s.pool.Exec(ctx, `UPDATE automation_task_targets SET remote_certificate_id = $3, last_uploaded_version_id = $4 WHERE automation_task_id = $1 AND deployment_target_id = $2`, taskID, targetID, remoteCertificateID, versionID)
		if err != nil {
			return err
		}
		if result.RowsAffected() > 0 {
			return nil
		}
	}
	_, err := s.pool.Exec(ctx, `UPDATE automation_tasks SET remote_certificate_id = $2, last_uploaded_version_id = $3, updated_at = now() WHERE id = $1`, taskID, remoteCertificateID, versionID)
	return err
}

func (s *Store) LoadUploadConfiguration(ctx context.Context, taskID, certificateID, credentialID string) (UploadConfiguration, error) {
	var config UploadConfiguration
	err := s.pool.QueryRow(ctx, `
		SELECT c.id, v.id, v.certificate_ciphertext, v.private_key_ciphertext, v.chain_ciphertext,
			COALESCE(asset.remote_certificate_id, a.remote_certificate_id, (
				SELECT s.summary->>'remote_certificate_id' FROM workflow_execution_steps s
				JOIN workflow_executions e ON e.id = s.execution_id
				WHERE e.automation_task_id = a.id AND s.summary->>'remote_certificate_id' IS NOT NULL
				ORDER BY s.finished_at DESC NULLS LAST LIMIT 1
			), ''), COALESCE(asset.certificate_version_id::text, a.last_uploaded_version_id::text, ''),
			cc.id, cc.provider, ccv.id, ccv.credentials_ciphertext, cc.status
		FROM certificates c
		JOIN certificate_versions v ON v.id = c.current_certificate_version_id
		JOIN automation_tasks a ON a.id = $1 AND a.certificate_id = c.id AND a.action_type = 'upload_ssl' AND a.enabled AND a.deleted_at IS NULL
		JOIN cloud_credentials cc ON cc.id = $3 AND cc.deleted_at IS NULL
		JOIN cloud_credential_versions ccv ON ccv.id = cc.current_version_id AND ccv.retired_at IS NULL
		LEFT JOIN certificate_cloud_assets asset ON asset.certificate_version_id = v.id AND asset.cloud_credential_id = cc.id
		WHERE c.id = $2 AND c.deleted_at IS NULL
	`, taskID, certificateID, credentialID).Scan(
		&config.CertificateID, &config.CertificateVersionID, &config.CertificateCiphertext, &config.PrivateKeyCiphertext, &config.ChainCiphertext, &config.RemoteCertificateID, &config.LastUploadedVersionID,
		&config.CloudCredential.ID, &config.CloudCredential.Provider, &config.CloudCredential.VersionID, &config.CloudCredential.CredentialsCiphertext, &config.CloudCredential.Status,
	)
	return config, err
}

// MarkCertificateCloudAsset stores the one reusable provider-side certificate
// for a certificate version and cloud credential.
func (s *Store) MarkCertificateCloudAsset(ctx context.Context, certificateID, versionID, credentialID, remoteCertificateID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO certificate_cloud_assets (id, certificate_id, certificate_version_id, cloud_credential_id, remote_certificate_id)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (certificate_version_id, cloud_credential_id)
		DO UPDATE SET remote_certificate_id = EXCLUDED.remote_certificate_id, updated_at = now()
	`, id.New(), certificateID, versionID, credentialID, remoteCertificateID)
	return err
}

// WithCertificateCloudAssetLock serializes remote certificate creation for one
// certificate-version and cloud-credential pair. The lock is intentionally
// session scoped so it remains held while the caller performs the external
// provider upload, including across multiple CertFlow worker processes.
func (s *Store) WithCertificateCloudAssetLock(ctx context.Context, versionID, credentialID string, action func(context.Context) error) error {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(hashtext($1), hashtext($2))`, versionID, credentialID); err != nil {
		return err
	}
	defer func() {
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`, versionID, credentialID)
	}()
	return action(ctx)
}

func (s *Store) MarkAutomationUploadSucceeded(ctx context.Context, taskID, versionID, remoteCertificateID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE automation_tasks SET remote_certificate_id = $2, last_uploaded_version_id = $3, last_status = 'succeeded', last_error = NULL, updated_at = now() WHERE id = $1`, taskID, remoteCertificateID, versionID)
	return err
}

func (s *Store) MarkDeploymentSucceeded(ctx context.Context, certificateID, targetID, versionID, remoteCertificateID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE certificate_deployments SET last_deployed_fingerprint = v.sha256_fingerprint, last_deployed_version_id = v.id, remote_certificate_id = $4, last_deployed_at = now(), last_error = NULL, updated_at = now()
		FROM certificate_versions v
		WHERE certificate_deployments.certificate_id = $1 AND certificate_deployments.deployment_target_id = $2 AND v.id = $3
	`, certificateID, targetID, versionID, remoteCertificateID)
	return err
}

func (s *Store) MarkDeploymentFailed(ctx context.Context, certificateID, targetID, message string) error {
	_, err := s.pool.Exec(ctx, `UPDATE certificate_deployments SET last_error = $3, updated_at = now() WHERE certificate_id = $1 AND deployment_target_id = $2`, certificateID, targetID, truncateError(message))
	return err
}

func (s *Store) LoadIssueConfiguration(ctx context.Context, certificateID string) (IssueConfiguration, error) {
	var configuration IssueConfiguration
	err := s.pool.QueryRow(ctx, `
		SELECT c.id, c.key_algorithm, c.validation_mode,
			aa.id, aa.directory_url, aa.email, COALESCE(aa.account_url, ''), aa.private_key_ciphertext, aa.status,
			COALESCE(da.id::text, ''), COALESCE(da.provider, ''), COALESCE(da.allowed_zones, '{}'), COALESCE(da.status, ''), COALESCE(da.verified_credential_version_id::text, ''),
			COALESCE(ccv.id::text, ''), COALESCE(ccv.credentials_ciphertext, ''::bytea), COALESCE(cc.status, '')
		FROM certificates c
		JOIN acme_accounts aa ON aa.id = c.acme_account_id AND aa.deleted_at IS NULL
		LEFT JOIN dns_accounts da ON da.id = c.default_dns_account_id AND da.deleted_at IS NULL
		LEFT JOIN cloud_credentials cc ON cc.id = da.cloud_credential_id AND cc.deleted_at IS NULL
		LEFT JOIN cloud_credential_versions ccv ON ccv.id = cc.current_version_id AND ccv.retired_at IS NULL
		WHERE c.id = $1 AND c.deleted_at IS NULL AND ($2 = '' OR c.owner_user_id = $2::uuid)
	`, certificateID, ownerID(ctx)).Scan(
		&configuration.CertificateID, &configuration.KeyAlgorithm, &configuration.ValidationMode,
		&configuration.ACMEAccount.ID, &configuration.ACMEAccount.DirectoryURL, &configuration.ACMEAccount.Email, &configuration.ACMEAccount.AccountURL, &configuration.ACMEAccount.PrivateKeyCiphertext, &configuration.ACMEAccount.Status,
		&configuration.DNSAccount.ID, &configuration.DNSAccount.Provider, &configuration.DNSAccount.AllowedZones, &configuration.DNSAccount.Status, &configuration.DNSAccount.VerifiedCredentialVersionID,
		&configuration.CloudCredential.VersionID, &configuration.CloudCredential.CredentialsCiphertext, &configuration.CloudCredential.Status,
	)
	if err != nil {
		return IssueConfiguration{}, err
	}

	rows, err := s.pool.Query(ctx, `SELECT domain FROM certificate_domains WHERE certificate_id = $1 AND ($2 = '' OR EXISTS (SELECT 1 FROM certificates c WHERE c.id = certificate_id AND c.owner_user_id = $2::uuid)) ORDER BY position`, certificateID, ownerID(ctx))
	if err != nil {
		return IssueConfiguration{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var domainName string
		if err := rows.Scan(&domainName); err != nil {
			return IssueConfiguration{}, err
		}
		configuration.Domains = append(configuration.Domains, domainName)
	}
	if err := rows.Err(); err != nil {
		return IssueConfiguration{}, err
	}
	if len(configuration.Domains) == 0 {
		return IssueConfiguration{}, fmt.Errorf("certificate has no domains")
	}
	return configuration, nil
}

func (s *Store) SetACMEAccountURL(ctx context.Context, accountID, accountURL string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE acme_accounts SET account_url = $2, status = 'active', updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL
	`, accountID, accountURL)
	return err
}

func (s *Store) SaveCertificateVersion(ctx context.Context, material CertificateVersionMaterial) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		INSERT INTO certificate_versions (
			id, certificate_id, issued_by_execution_id, certificate_ciphertext, private_key_ciphertext, chain_ciphertext,
			serial_number, sha256_fingerprint, not_before, not_after
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, material.ID, material.CertificateID, material.ExecutionID, material.CertificateCiphertext, material.PrivateKeyCiphertext,
		material.ChainCiphertext, material.SerialNumber, material.Fingerprint, material.NotBefore, material.NotAfter); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE certificates
		SET current_certificate_version_id = $2, status = 'issued', last_issued_at = now(), last_error = NULL,
			version = version + 1, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL
	`, material.CertificateID, material.ID); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT deployment_target_id FROM certificate_deployments WHERE certificate_id = $1 AND enabled AND auto_deploy`, material.CertificateID)
	if err != nil {
		return err
	}
	targetIDs := make([]string, 0)
	for rows.Next() {
		var targetID string
		if err := rows.Scan(&targetID); err != nil {
			rows.Close()
			return err
		}
		targetIDs = append(targetIDs, targetID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, targetID := range targetIDs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO jobs (id, kind, status, idempotency_scope, idempotency_key, payload, next_run_at, attempt, max_attempts)
			VALUES ($1, 'deploy', 'queued', $2, $3, jsonb_build_object('certificate_id', $4::text, 'deployment_target_id', $2::text), now(), 0, 5)
			ON CONFLICT (idempotency_scope, idempotency_key) DO NOTHING
		`, id.New(), targetID, material.ID, material.CertificateID); err != nil {
			return err
		}
	}
	// New certificate versions fan out to active delivery tasks once their
	// encrypted material and current-version pointer are durable in this tx.
	rows, err = tx.Query(ctx, `
		SELECT a.id, a.action_type, COALESCE(a.cloud_credential_id::text, ''), COALESCE(att.deployment_target_id::text, '')
		FROM automation_tasks a
		LEFT JOIN automation_task_targets att ON att.automation_task_id = a.id AND att.enabled
		WHERE a.certificate_id = $1 AND a.action_type IN ('upload_ssl', 'deploy_alb') AND a.enabled AND a.deleted_at IS NULL
		ORDER BY a.id, att.position
	`, material.CertificateID)
	if err != nil {
		return err
	}
	type deliveryTask struct {
		id, actionType, credentialID string
		targetIDs                    []string
	}
	deliveryTasks := make([]deliveryTask, 0)
	taskIndexes := make(map[string]int)
	for rows.Next() {
		var taskID, actionType, credentialID, targetID string
		if err := rows.Scan(&taskID, &actionType, &credentialID, &targetID); err != nil {
			rows.Close()
			return err
		}
		index, exists := taskIndexes[taskID]
		if !exists {
			index = len(deliveryTasks)
			taskIndexes[taskID] = index
			deliveryTasks = append(deliveryTasks, deliveryTask{id: taskID, actionType: actionType, credentialID: credentialID})
		}
		if targetID != "" {
			deliveryTasks[index].targetIDs = append(deliveryTasks[index].targetIDs, targetID)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, task := range deliveryTasks {
		totalJobs := 1
		if task.actionType == "deploy_alb" {
			totalJobs = len(task.targetIDs)
		}
		if totalJobs == 0 {
			continue
		}
		runID := id.New()
		if _, err := tx.Exec(ctx, `
			INSERT INTO automation_runs (id, automation_task_id, certificate_id, certificate_version_id, trigger_type, status, total_jobs)
			VALUES ($1, $2, $3, $4, 'certificate_issued', 'queued', $5)
		`, runID, task.id, material.CertificateID, material.ID, totalJobs); err != nil {
			return err
		}
		queuedJobs := 0
		if task.actionType == "upload_ssl" {
			result, err := tx.Exec(ctx, `
				INSERT INTO jobs (id, kind, status, idempotency_scope, idempotency_key, payload, automation_task_id, automation_run_id, next_run_at, attempt, max_attempts)
				VALUES ($1, 'upload', 'queued', $2, $3, jsonb_build_object('certificate_id', $4::text, 'cloud_credential_id', $5::text), $2::uuid, $6::uuid, now(), 0, 5)
				ON CONFLICT (idempotency_scope, idempotency_key) DO NOTHING
			`, id.New(), task.id, material.ID, material.CertificateID, task.credentialID, runID)
			if err != nil {
				return err
			}
			queuedJobs = int(result.RowsAffected())
		} else {
			for _, targetID := range task.targetIDs {
				result, err := tx.Exec(ctx, `
					INSERT INTO jobs (id, kind, status, idempotency_scope, idempotency_key, payload, automation_task_id, automation_run_id, next_run_at, attempt, max_attempts)
					VALUES ($1, 'deploy', 'queued', $2, $3, jsonb_build_object('certificate_id', $4::text, 'deployment_target_id', $5::text), $2::uuid, $6::uuid, now(), 0, 5)
					ON CONFLICT (idempotency_scope, idempotency_key) DO NOTHING
				`, id.New(), task.id, material.ID+":"+targetID, material.CertificateID, targetID, runID)
				if err != nil {
					return err
				}
				queuedJobs += int(result.RowsAffected())
			}
		}
		if queuedJobs == 0 {
			if _, err := tx.Exec(ctx, `DELETE FROM automation_runs WHERE id = $1`, runID); err != nil {
				return err
			}
			continue
		}
		if _, err := tx.Exec(ctx, `UPDATE automation_runs SET total_jobs = $2, updated_at = now() WHERE id = $1`, runID, queuedJobs); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE automation_tasks SET last_status = 'queued', last_error = NULL, last_run_at = now(), updated_at = now() WHERE id = $1`, task.id); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// QueueDueRenewals creates at most one queued or running renewal per current
// certificate version. Its deterministic idempotency key makes repeated scans
// and multiple scheduler instances safe.
func (s *Store) QueueDueRenewals(ctx context.Context) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT c.id, c.current_certificate_version_id, v.not_after
		FROM certificates c
		JOIN certificate_versions v ON v.id = c.current_certificate_version_id
		WHERE c.deleted_at IS NULL
			AND c.renew_enabled = true
			AND NOT EXISTS (SELECT 1 FROM automation_tasks a WHERE a.certificate_id = c.id AND a.enabled AND a.deleted_at IS NULL)
			AND c.status IN ('issued', 'expiring')
			AND v.not_after <= now() + (c.renew_before_days * interval '1 day')
			AND NOT EXISTS (
				SELECT 1 FROM jobs j
				WHERE j.kind IN ('issue', 'renew')
					AND j.status IN ('queued', 'running')
					AND j.payload->>'certificate_id' = c.id::text
			)
		FOR UPDATE OF c SKIP LOCKED
	`)
	if err != nil {
		return 0, err
	}
	deferred := make([]struct {
		certificateID string
		versionID     string
		notAfter      time.Time
	}, 0)
	for rows.Next() {
		var item struct {
			certificateID string
			versionID     string
			notAfter      time.Time
		}
		if err := rows.Scan(&item.certificateID, &item.versionID, &item.notAfter); err != nil {
			rows.Close()
			return 0, err
		}
		deferred = append(deferred, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()

	queued := 0
	for _, item := range deferred {
		key := fmt.Sprintf("renew:%s:%s:%s", item.certificateID, item.versionID, item.notAfter.UTC().Format("2006-01-02"))
		result, err := tx.Exec(ctx, `
			INSERT INTO jobs (id, kind, status, idempotency_scope, idempotency_key, payload, next_run_at, attempt, max_attempts)
			VALUES ($1, 'renew', 'queued', $2, $3, jsonb_build_object('certificate_id', $2::text), now(), 0, 5)
			ON CONFLICT (idempotency_scope, idempotency_key) DO NOTHING
		`, id.New(), item.certificateID, key)
		if err != nil {
			return 0, err
		}
		if result.RowsAffected() == 0 {
			continue
		}
		queued++
		if _, err := tx.Exec(ctx, `
			INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload)
			VALUES ($1, 'certificate.renewal.queued', 'certificate', $2, jsonb_build_object('idempotency_key', $3::text))
		`, id.New(), item.certificateID, key); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return queued, nil
}

// RecoverExpiredJobs makes tasks from a dead worker eligible for a later
// attempt. The interrupted attempt remains visible as a failed execution.
func (s *Store) RecoverExpiredJobs(ctx context.Context, retryDelay time.Duration) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT id, kind, COALESCE(payload->>'certificate_id', ''), attempt, max_attempts
		FROM jobs
		WHERE status = 'running' AND lease_expires_at <= now()
		FOR UPDATE SKIP LOCKED
	`)
	if err != nil {
		return 0, err
	}
	deferred := make([]struct {
		id            string
		kind          string
		certificateID string
		attempt       int
		maxAttempts   int
	}, 0)
	for rows.Next() {
		var item struct {
			id            string
			kind          string
			certificateID string
			attempt       int
			maxAttempts   int
		}
		if err := rows.Scan(&item.id, &item.kind, &item.certificateID, &item.attempt, &item.maxAttempts); err != nil {
			rows.Close()
			return 0, err
		}
		deferred = append(deferred, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()

	for _, item := range deferred {
		if _, err := tx.Exec(ctx, `
			UPDATE workflow_executions
			SET status = 'failed', finished_at = now(), error_code = 'worker_lease_expired', error_message = 'worker lease expired before the task completed'
			WHERE job_id = $1 AND status = 'running'
		`, item.id); err != nil {
			return 0, err
		}

		if item.attempt >= item.maxAttempts {
			if _, err := tx.Exec(ctx, `
				UPDATE jobs
				SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
				WHERE id = $1
			`, item.id); err != nil {
				return 0, err
			}
			if item.certificateID != "" && (item.kind == "issue" || item.kind == "renew") {
				if _, err := tx.Exec(ctx, `
					UPDATE certificates
					SET status = CASE
						WHEN $2::text = 'issue' THEN 'failed'
						WHEN $2::text = 'renew' AND current_certificate_version_id IS NOT NULL THEN 'issued'
							ELSE status
						END,
						last_error = 'worker lease expired before the task completed', updated_at = now()
					WHERE id = $1 AND deleted_at IS NULL
				`, item.certificateID, item.kind); err != nil {
					return 0, err
				}
			}
			continue
		}
		if item.certificateID != "" && (item.kind == "issue" || item.kind == "renew") {
			if _, err := tx.Exec(ctx, `
				UPDATE certificates
				SET status = CASE
						WHEN $2::text = 'issue' THEN 'pending'
						WHEN $2::text = 'renew' AND current_certificate_version_id IS NOT NULL THEN 'issued'
						ELSE status
					END,
					updated_at = now()
				WHERE id = $1 AND deleted_at IS NULL
			`, item.certificateID, item.kind); err != nil {
				return 0, err
			}
		}

		if _, err := tx.Exec(ctx, `
			UPDATE jobs
			SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
				next_run_at = now() + $2::interval, updated_at = now()
			WHERE id = $1
		`, item.id, intervalLiteral(retryDelay)); err != nil {
			return 0, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(deferred), nil
}

// ClaimJob leases one due task with SKIP LOCKED and creates its execution
// record in the same transaction. Multiple worker processes can call it.
func (s *Store) ClaimJob(ctx context.Context, workerID string, leaseDuration time.Duration) (*ClaimedJob, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var job ClaimedJob
	err = tx.QueryRow(ctx, `
		WITH next_job AS (
			SELECT id
			FROM jobs
			WHERE status = 'queued' AND next_run_at <= now() AND cancel_requested_at IS NULL
			ORDER BY next_run_at, created_at
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE jobs AS j
		SET status = 'running', attempt = j.attempt + 1, lease_owner = $1,
			lease_expires_at = now() + $2::interval, updated_at = now()
		FROM next_job
		WHERE j.id = next_job.id
		RETURNING j.id, j.kind, j.payload, j.attempt, j.max_attempts,
			COALESCE(j.payload->>'certificate_id', ''), COALESCE(j.payload->>'deployment_target_id', ''), COALESCE(j.automation_task_id::text, j.payload->>'automation_task_id', ''), COALESCE(j.automation_run_id::text, '')
	`, workerID, intervalLiteral(leaseDuration)).Scan(&job.ID, &job.Kind, &job.Payload, &job.Attempt, &job.MaxAttempts, &job.CertificateID, &job.DeploymentTargetID, &job.AutomationTaskID, &job.AutomationRunID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	job.ExecutionID = id.New()
	trigger := "manual"
	if job.Attempt > 1 {
		trigger = "retry"
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO workflow_executions (id, job_id, kind, certificate_id, deployment_target_id, automation_task_id, trigger_type, status, attempt, max_attempts, started_at)
		VALUES ($1, $2, $3, NULLIF($4, '')::uuid, NULLIF($5, '')::uuid, NULLIF($6, '')::uuid, $7, 'running', $8, $9, now())
	`, job.ExecutionID, job.ID, job.Kind, job.CertificateID, job.DeploymentTargetID, job.AutomationTaskID, trigger, job.Attempt, job.MaxAttempts); err != nil {
		return nil, err
	}

	if job.CertificateID != "" && (job.Kind == "issue" || job.Kind == "renew") {
		status := "issuing"
		if job.Kind == "renew" {
			status = "renewing"
		}
		if _, err := tx.Exec(ctx, `
			UPDATE certificates SET status = $2, updated_at = now()
			WHERE id = $1 AND deleted_at IS NULL
		`, job.CertificateID, status); err != nil {
			return nil, err
		}
	}
	if job.AutomationRunID != "" {
		if _, err := tx.Exec(ctx, `UPDATE automation_runs SET status = 'running', started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1 AND status = 'queued'`, job.AutomationRunID); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &job, nil
}

func (s *Store) StartExecutionStep(ctx context.Context, executionID string, sequence int, name string, summary json.RawMessage) error {
	if len(summary) == 0 {
		summary = json.RawMessage(`{}`)
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO workflow_execution_steps (id, execution_id, name, sequence, status, started_at, summary)
		VALUES ($1, $2, $3, $4, 'running', now(), $5::jsonb)
	`, id.New(), executionID, name, sequence, summary)
	return err
}

func (s *Store) FinishExecutionStep(ctx context.Context, executionID string, sequence int, summary json.RawMessage, errMessage string) error {
	if len(summary) == 0 {
		summary = json.RawMessage(`{}`)
	}
	status := "succeeded"
	if errMessage != "" {
		status = "failed"
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE workflow_execution_steps
		SET status = $3, finished_at = now(), summary = $4::jsonb, error_message = NULLIF($5, '')
		WHERE execution_id = $1 AND sequence = $2 AND status = 'running'
	`, executionID, sequence, status, summary, truncateError(errMessage))
	return err
}

func (s *Store) CompleteJob(ctx context.Context, job ClaimedJob, workerID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	result, err := tx.Exec(ctx, `
		UPDATE jobs SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
		WHERE id = $1 AND status = 'running' AND lease_owner = $2
	`, job.ID, workerID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("job lease is no longer held")
	}
	if _, err := tx.Exec(ctx, `
		UPDATE workflow_executions SET status = 'succeeded', finished_at = now()
		WHERE id = $1 AND status = 'running'
	`, job.ExecutionID); err != nil {
		return err
	}
	if job.AutomationRunID != "" {
		if err := refreshAutomationRun(ctx, tx, job.AutomationRunID); err != nil {
			return err
		}
	} else if job.AutomationTaskID != "" {
		if _, err := tx.Exec(ctx, `UPDATE automation_tasks SET last_status = 'succeeded', last_error = NULL, updated_at = now() WHERE id = $1`, job.AutomationTaskID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// refreshAutomationRun derives the batch state from its durable child jobs so
// a successful target can never hide a failure from another target.
func refreshAutomationRun(ctx context.Context, tx pgx.Tx, runID string) error {
	var taskID, lastError string
	var total, succeeded, failed, active, waiting int
	if err := tx.QueryRow(ctx, `
		SELECT r.automation_task_id::text, COALESCE((
			SELECT e.error_message FROM workflow_executions e
			JOIN jobs failed_job ON failed_job.id = e.job_id
			WHERE failed_job.automation_run_id = r.id AND e.status = 'failed'
			ORDER BY e.finished_at DESC NULLS LAST LIMIT 1
		), ''),
			COUNT(j.id),
			COUNT(j.id) FILTER (WHERE j.status = 'succeeded'),
			COUNT(j.id) FILTER (WHERE j.status = 'failed'),
			COUNT(j.id) FILTER (WHERE j.status IN ('queued', 'running')),
			COUNT(j.id) FILTER (WHERE j.status = 'waiting_user')
		FROM automation_runs r
		LEFT JOIN jobs j ON j.automation_run_id = r.id
		WHERE r.id = $1
		GROUP BY r.automation_task_id
	`, runID).Scan(&taskID, &lastError, &total, &succeeded, &failed, &active, &waiting); err != nil {
		return err
	}
	status := "queued"
	finished := false
	switch {
	case waiting > 0:
		status = "waiting_user"
	case active > 0:
		status = "running"
	case failed > 0 && succeeded > 0:
		status, finished = "partial_failed", true
	case failed > 0:
		status, finished = "failed", true
	case total > 0 && succeeded == total:
		status, finished = "succeeded", true
	}
	if _, err := tx.Exec(ctx, `
		UPDATE automation_runs
		SET status = $2, total_jobs = $3, succeeded_jobs = $4, failed_jobs = $5,
			last_error = NULLIF($6, ''), finished_at = CASE WHEN $7 THEN now() ELSE NULL END, updated_at = now()
		WHERE id = $1
	`, runID, status, total, succeeded, failed, truncateError(lastError), finished); err != nil {
		return err
	}
	taskStatus := status
	if taskStatus == "partial_failed" || taskStatus == "waiting_user" {
		taskStatus = "failed"
	}
	if status == "queued" || status == "running" {
		taskStatus = "queued"
	}
	_, err := tx.Exec(ctx, `UPDATE automation_tasks SET last_status = $2, last_error = CASE WHEN $2 = 'failed' THEN NULLIF($3, '') ELSE NULL END, updated_at = now() WHERE id = $1`, taskID, taskStatus, truncateError(lastError))
	return err
}

// FailJob finalizes the current execution. Retry scheduling changes only the
// job state; each attempt remains a separate failed execution for diagnosis.
func (s *Store) FailJob(ctx context.Context, job ClaimedJob, workerID string, failure JobFailure, retryDelay *time.Duration) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	result, err := tx.Exec(ctx, `
		UPDATE jobs SET lease_owner = NULL, lease_expires_at = NULL, updated_at = now(),
			status = CASE WHEN $3::interval IS NULL THEN 'failed' ELSE 'queued' END,
			next_run_at = CASE WHEN $3::interval IS NULL THEN next_run_at ELSE now() + $3::interval END
		WHERE id = $1 AND status = 'running' AND lease_owner = $2
	`, job.ID, workerID, durationInterval(retryDelay))
	if err != nil {
		return false, err
	}
	if result.RowsAffected() == 0 {
		return false, fmt.Errorf("job lease is no longer held")
	}
	if _, err := tx.Exec(ctx, `
		UPDATE workflow_executions
		SET status = 'failed', finished_at = now(), error_code = $2, error_message = $3
		WHERE id = $1 AND status = 'running'
	`, job.ExecutionID, failure.Code, truncateError(failure.Message)); err != nil {
		return false, err
	}
	if job.AutomationRunID != "" {
		if err := refreshAutomationRun(ctx, tx, job.AutomationRunID); err != nil {
			return false, err
		}
	} else if job.AutomationTaskID != "" {
		if _, err := tx.Exec(ctx, `UPDATE automation_tasks SET last_status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`, job.AutomationTaskID, truncateError(failure.Message)); err != nil {
			return false, err
		}
	}

	if job.CertificateID != "" && (job.Kind == "issue" || job.Kind == "renew") {
		terminal := retryDelay == nil
		if _, err := tx.Exec(ctx, `
			UPDATE certificates
			SET status = CASE
					WHEN $3::boolean AND $4::text = 'issue' THEN 'failed'
					WHEN $3::boolean AND $4::text = 'renew' AND current_certificate_version_id IS NOT NULL THEN 'issued'
					ELSE status
				END,
				last_error = $2, updated_at = now()
			WHERE id = $1 AND deleted_at IS NULL
		`, job.CertificateID, truncateError(failure.Message), terminal, job.Kind); err != nil {
			return false, err
		}
	}
	if retryDelay == nil && job.CertificateID != "" {
		eventType := "certificate.issue.failed"
		if job.Kind == "renew" {
			eventType = "certificate.renew.failed"
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload)
			VALUES ($1, $2, 'certificate', $3, jsonb_build_object('job_id', $4::text, 'execution_id', $5::text, 'error_code', $6::text))
		`, id.New(), eventType, job.CertificateID, job.ID, job.ExecutionID, failure.Code); err != nil {
			return false, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return retryDelay != nil, nil
}

func intervalLiteral(value time.Duration) string {
	return fmt.Sprintf("%f seconds", value.Seconds())
}

func durationInterval(value *time.Duration) any {
	if value == nil {
		return nil
	}
	return intervalLiteral(*value)
}

func truncateError(message string) string {
	const maxLength = 1000
	if len(message) <= maxLength {
		return message
	}
	return message[:maxLength]
}
