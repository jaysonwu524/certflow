ALTER TABLE cloud_credentials
    ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
