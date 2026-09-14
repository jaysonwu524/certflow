CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    persistent boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS auth_refresh_tokens_lookup_idx
    ON auth_refresh_tokens (token_hash) WHERE revoked_at IS NULL;
