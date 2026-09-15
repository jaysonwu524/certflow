ALTER TABLE auth_sessions
    ADD COLUMN IF NOT EXISTS device_label text NOT NULL DEFAULT 'Web browser';

CREATE INDEX IF NOT EXISTS auth_sessions_user_active_idx
    ON auth_sessions (user_id, last_seen_at DESC)
    WHERE revoked_at IS NULL;
