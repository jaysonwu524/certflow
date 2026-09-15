DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'workflow_executions_kind_check'
          AND conrelid = 'workflow_executions'::regclass
    ) THEN
        ALTER TABLE workflow_executions DROP CONSTRAINT workflow_executions_kind_check;
    END IF;
END $$;

ALTER TABLE workflow_executions
    ADD CONSTRAINT workflow_executions_kind_check
    CHECK (kind IN ('issue', 'renew', 'deploy', 'notify', 'cleanup_dns'));
