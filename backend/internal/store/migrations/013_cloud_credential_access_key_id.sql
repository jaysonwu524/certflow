ALTER TABLE cloud_credentials
    ADD COLUMN IF NOT EXISTS access_key_id text NOT NULL DEFAULT '';
