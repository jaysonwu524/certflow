-- Bounded admin-dashboard aggregates are filtered by these columns on every
-- refresh. Partial indexes keep the write path lightweight for deleted rows.
CREATE INDEX IF NOT EXISTS workflow_executions_status_created_idx
    ON workflow_executions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS certificates_status_not_deleted_idx
    ON certificates (status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS automation_tasks_status_not_deleted_idx
    ON automation_tasks (enabled, last_status) WHERE deleted_at IS NULL;
