ALTER TABLE acme_accounts ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;
ALTER TABLE acme_accounts ADD COLUMN IF NOT EXISTS last_error text NOT NULL DEFAULT '';
