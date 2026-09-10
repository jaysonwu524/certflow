-- Older installations may have generated different names for inline CHECK
-- constraints. Rebuild both kind constraints so the upload worker is accepted.
DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'jobs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%kind%';
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE jobs DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check
    CHECK (kind IN ('issue', 'renew', 'upload', 'deploy', 'notify', 'cleanup_dns'));

DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'workflow_executions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%kind%';
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE workflow_executions DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

ALTER TABLE workflow_executions
    ADD CONSTRAINT workflow_executions_kind_check
    CHECK (kind IN ('issue', 'renew', 'upload', 'deploy', 'notify', 'cleanup_dns'));
