-- DNS accounts retain the non-sensitive description and the cloud credential
-- version that was last proven to have DNS write access.  A credential can be
-- disabled or become invalid without deleting the DNS account itself; the
-- version marker lets the API require an explicit re-verification.
ALTER TABLE dns_accounts
    ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS verified_credential_version_id uuid REFERENCES cloud_credential_versions(id);

CREATE INDEX IF NOT EXISTS dns_accounts_credential_idx
    ON dns_accounts (cloud_credential_id)
    WHERE deleted_at IS NULL;
