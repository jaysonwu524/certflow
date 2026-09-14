CREATE TABLE acme_accounts (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE,
    directory_url text NOT NULL,
    email text NOT NULL,
    account_url text,
    private_key_ciphertext bytea NOT NULL,
    private_key_algorithm text NOT NULL,
    eab_kid text,
    eab_hmac_ciphertext bytea,
    status text NOT NULL CHECK (status IN ('active', 'disabled', 'error')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE cloud_credentials (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE,
    description text NOT NULL DEFAULT '',
    provider text NOT NULL CHECK (provider = 'aliyun'),
    credential_hint text NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'disabled', 'invalid', 'rotating')),
    current_version_id uuid,
    last_verified_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE cloud_credential_versions (
    id uuid PRIMARY KEY,
    cloud_credential_id uuid NOT NULL REFERENCES cloud_credentials(id),
    credentials_ciphertext bytea NOT NULL,
    credential_hint text NOT NULL,
    version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    retired_at timestamptz,
    UNIQUE (cloud_credential_id, version)
);

ALTER TABLE cloud_credentials ADD CONSTRAINT cloud_credentials_current_version_fk FOREIGN KEY (current_version_id) REFERENCES cloud_credential_versions(id);

CREATE TABLE dns_accounts (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE,
    provider text NOT NULL CHECK (provider = 'aliyun'),
    cloud_credential_id uuid NOT NULL REFERENCES cloud_credentials(id),
    config_version integer NOT NULL DEFAULT 1,
    allowed_zones text[] NOT NULL DEFAULT '{}',
    status text NOT NULL CHECK (status IN ('active', 'disabled', 'invalid')),
    last_verified_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE certificates (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE,
    acme_account_id uuid REFERENCES acme_accounts(id),
    default_dns_account_id uuid REFERENCES dns_accounts(id),
    key_algorithm text NOT NULL CHECK (key_algorithm IN ('rsa_2048', 'rsa_4096', 'ecdsa_p256', 'ecdsa_p384')),
    challenge_type text NOT NULL CHECK (challenge_type = 'dns_01'),
    renew_enabled boolean NOT NULL DEFAULT true,
    renew_before_days integer NOT NULL DEFAULT 30 CHECK (renew_before_days BETWEEN 1 AND 90),
    status text NOT NULL CHECK (status IN ('draft', 'pending', 'issuing', 'issued', 'renewing', 'failed', 'expiring', 'expired', 'revoked', 'disabled')),
    current_certificate_version_id uuid,
    last_issued_at timestamptz,
    last_error text,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE certificate_versions (
    id uuid PRIMARY KEY,
    certificate_id uuid NOT NULL REFERENCES certificates(id),
    issued_by_execution_id uuid,
    certificate_ciphertext bytea NOT NULL,
    private_key_ciphertext bytea NOT NULL,
    chain_ciphertext bytea NOT NULL,
    serial_number text NOT NULL,
    sha256_fingerprint text NOT NULL UNIQUE,
    not_before timestamptz NOT NULL,
    not_after timestamptz NOT NULL,
    revoked_at timestamptz,
    revocation_reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE certificates ADD CONSTRAINT certificates_current_version_fk FOREIGN KEY (current_certificate_version_id) REFERENCES certificate_versions(id);

CREATE TABLE certificate_domains (
    id uuid PRIMARY KEY,
    certificate_id uuid NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
    domain text NOT NULL,
    position integer NOT NULL CHECK (position >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (certificate_id, domain),
    UNIQUE (certificate_id, position)
);

CREATE TABLE certificate_domain_validations (
    certificate_domain_id uuid PRIMARY KEY REFERENCES certificate_domains(id) ON DELETE CASCADE,
    dns_account_id uuid REFERENCES dns_accounts(id),
    managed_zone text NOT NULL,
    challenge_fqdn text NOT NULL,
    validation_mode text NOT NULL CHECK (validation_mode IN ('direct', 'cname_delegated')),
    config_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deployment_targets (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE,
    type text NOT NULL CHECK (type = 'aliyun_alb'),
    cloud_credential_id uuid NOT NULL REFERENCES cloud_credentials(id),
    config_version integer NOT NULL DEFAULT 1,
    config jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'disabled', 'invalid')),
    last_verified_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE certificate_deployments (
    id uuid PRIMARY KEY,
    certificate_id uuid NOT NULL REFERENCES certificates(id),
    deployment_target_id uuid NOT NULL REFERENCES deployment_targets(id),
    auto_deploy boolean NOT NULL DEFAULT true,
    enabled boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    last_deployed_fingerprint text,
    last_deployed_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (certificate_id, deployment_target_id)
);

CREATE TABLE jobs (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('issue', 'renew', 'deploy', 'notify', 'cleanup_dns')),
    status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    idempotency_scope text NOT NULL,
    idempotency_key text NOT NULL,
    payload jsonb NOT NULL,
    next_run_at timestamptz NOT NULL,
    attempt integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    lease_owner text,
    lease_expires_at timestamptz,
    cancel_requested_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (idempotency_scope, idempotency_key)
);

CREATE INDEX jobs_queue_idx ON jobs (status, next_run_at) WHERE status = 'queued';

CREATE TABLE workflow_executions (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id),
    kind text NOT NULL CHECK (kind IN ('issue', 'renew', 'deploy', 'notify', 'cleanup_dns')),
    certificate_id uuid REFERENCES certificates(id),
    deployment_target_id uuid REFERENCES deployment_targets(id),
    trigger_type text NOT NULL CHECK (trigger_type IN ('manual', 'scheduler', 'certificate_issued', 'retry')),
    status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    attempt integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 5,
    started_at timestamptz,
    finished_at timestamptz,
    error_code text,
    error_message text,
    summary jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflow_executions_created_idx ON workflow_executions (created_at DESC);

CREATE TABLE workflow_execution_steps (
    id uuid PRIMARY KEY,
    execution_id uuid NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
    name text NOT NULL,
    sequence integer NOT NULL,
    status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
    started_at timestamptz,
    finished_at timestamptz,
    summary jsonb NOT NULL DEFAULT '{}',
    error_message text,
    UNIQUE (execution_id, sequence)
);

CREATE TABLE outbox_events (
    id uuid PRIMARY KEY,
    event_type text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    last_error text
);

CREATE INDEX outbox_events_unpublished_idx ON outbox_events (created_at) WHERE published_at IS NULL;

CREATE TABLE notification_endpoints (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE,
    type text NOT NULL CHECK (type = 'webhook'),
    url_ciphertext bytea NOT NULL,
    secret_ciphertext bytea,
    enabled boolean NOT NULL DEFAULT true,
    event_filter text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE audit_events (
    id uuid PRIMARY KEY,
    actor_subject text NOT NULL,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid,
    request_id text NOT NULL,
    source_ip inet,
    summary jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_created_idx ON audit_events (created_at DESC);
