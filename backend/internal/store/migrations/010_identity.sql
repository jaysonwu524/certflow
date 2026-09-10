CREATE TABLE users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'user')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    must_change_password boolean NOT NULL DEFAULT false,
    email_verified_at timestamptz,
    failed_login_attempts integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE auth_sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);
CREATE INDEX auth_sessions_lookup_idx ON auth_sessions (token_hash) WHERE revoked_at IS NULL;

CREATE TABLE email_verification_codes (
    id uuid PRIMARY KEY,
    email text NOT NULL,
    purpose text NOT NULL CHECK (purpose IN ('register', 'login')),
    code_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verification_codes_lookup_idx ON email_verification_codes (email, purpose, created_at DESC) WHERE consumed_at IS NULL;

CREATE TABLE system_settings (
    key text PRIMARY KEY,
    value_ciphertext bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE acme_accounts ADD COLUMN owner_user_id uuid REFERENCES users(id);
ALTER TABLE cloud_credentials ADD COLUMN owner_user_id uuid REFERENCES users(id);
ALTER TABLE dns_accounts ADD COLUMN owner_user_id uuid REFERENCES users(id);
ALTER TABLE certificates ADD COLUMN owner_user_id uuid REFERENCES users(id);
ALTER TABLE deployment_targets ADD COLUMN owner_user_id uuid REFERENCES users(id);
ALTER TABLE certificate_deployments ADD COLUMN owner_user_id uuid REFERENCES users(id);
ALTER TABLE automation_tasks ADD COLUMN owner_user_id uuid REFERENCES users(id);
ALTER TABLE notification_endpoints ADD COLUMN owner_user_id uuid REFERENCES users(id);

CREATE INDEX acme_accounts_owner_idx ON acme_accounts (owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX cloud_credentials_owner_idx ON cloud_credentials (owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX dns_accounts_owner_idx ON dns_accounts (owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX certificates_owner_idx ON certificates (owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX deployment_targets_owner_idx ON deployment_targets (owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX certificate_deployments_owner_idx ON certificate_deployments (owner_user_id);
CREATE INDEX automation_tasks_owner_idx ON automation_tasks (owner_user_id) WHERE deleted_at IS NULL;
