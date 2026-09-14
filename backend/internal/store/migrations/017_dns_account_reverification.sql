-- Existing DNS accounts predate the write/delete permission check. Do not
-- silently treat them as verified; require one explicit live verification.
UPDATE dns_accounts
SET status = 'invalid',
    last_error = 'DNS account requires re-verification after security hardening',
    updated_at = now()
WHERE deleted_at IS NULL
  AND status = 'active'
  AND verified_credential_version_id IS NULL;
