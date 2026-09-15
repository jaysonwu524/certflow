CREATE TABLE IF NOT EXISTS automation_tasks (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE,
    certificate_id uuid NOT NULL REFERENCES certificates(id),
    action_type text NOT NULL CHECK (action_type IN ('renew_certificate', 'renew_and_deploy_alb')),
    interval_minutes integer NOT NULL CHECK (interval_minutes BETWEEN 60 AND 10080),
    enabled boolean NOT NULL DEFAULT true,
    next_run_at timestamptz NOT NULL DEFAULT now(),
    last_run_at timestamptz,
    last_status text NOT NULL DEFAULT 'pending' CHECK (last_status IN ('pending', 'queued', 'succeeded', 'failed', 'skipped')),
    last_error text,
    config_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS automation_tasks_due_idx ON automation_tasks (next_run_at) WHERE enabled AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS automation_task_targets (
    automation_task_id uuid NOT NULL REFERENCES automation_tasks(id) ON DELETE CASCADE,
    deployment_target_id uuid NOT NULL REFERENCES deployment_targets(id),
    position integer NOT NULL DEFAULT 0,
    enabled boolean NOT NULL DEFAULT true,
    PRIMARY KEY (automation_task_id, deployment_target_id)
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS automation_task_id uuid REFERENCES automation_tasks(id);
ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS automation_task_id uuid REFERENCES automation_tasks(id);
