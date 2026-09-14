-- An automation task is a policy. Each execution of that policy is recorded
-- separately so multi-target delivery has one authoritative outcome.
CREATE TABLE IF NOT EXISTS automation_runs (
    id uuid PRIMARY KEY,
    automation_task_id uuid NOT NULL REFERENCES automation_tasks(id),
    certificate_id uuid NOT NULL REFERENCES certificates(id),
    certificate_version_id uuid REFERENCES certificate_versions(id),
    trigger_type text NOT NULL CHECK (trigger_type IN ('manual', 'scheduler', 'certificate_issued')),
    status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'partial_failed', 'failed', 'waiting_user', 'cancelled')),
    total_jobs integer NOT NULL DEFAULT 0 CHECK (total_jobs >= 0),
    succeeded_jobs integer NOT NULL DEFAULT 0 CHECK (succeeded_jobs >= 0),
    failed_jobs integer NOT NULL DEFAULT 0 CHECK (failed_jobs >= 0),
    started_at timestamptz,
    finished_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_runs_task_created_idx
    ON automation_runs (automation_task_id, created_at DESC);

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS automation_run_id uuid REFERENCES automation_runs(id);

CREATE INDEX IF NOT EXISTS jobs_automation_run_idx
    ON jobs (automation_run_id) WHERE automation_run_id IS NOT NULL;

-- A cloud certificate asset is owned by a certificate version and one cloud
-- credential. Upload and ALB deployment can therefore share the same remote
-- certificate instead of creating duplicate Certificate Management entries.
CREATE TABLE IF NOT EXISTS certificate_cloud_assets (
    id uuid PRIMARY KEY,
    certificate_id uuid NOT NULL REFERENCES certificates(id),
    certificate_version_id uuid NOT NULL REFERENCES certificate_versions(id),
    cloud_credential_id uuid NOT NULL REFERENCES cloud_credentials(id),
    remote_certificate_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (certificate_version_id, cloud_credential_id)
);

CREATE INDEX IF NOT EXISTS certificate_cloud_assets_certificate_idx
    ON certificate_cloud_assets (certificate_id, cloud_credential_id, created_at DESC);
