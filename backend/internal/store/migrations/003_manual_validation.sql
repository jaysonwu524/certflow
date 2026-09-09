ALTER TABLE certificates ADD COLUMN IF NOT EXISTS validation_mode text NOT NULL DEFAULT 'auto';
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificates_validation_mode_check' AND conrelid = 'certificates'::regclass) THEN
        ALTER TABLE certificates DROP CONSTRAINT certificates_validation_mode_check;
    END IF;
END $$;
ALTER TABLE certificates ADD CONSTRAINT certificates_validation_mode_check CHECK (validation_mode IN ('auto', 'manual'));

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_status_check' AND conrelid = 'jobs'::regclass) THEN
        ALTER TABLE jobs DROP CONSTRAINT jobs_status_check;
    END IF;
END $$;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN ('queued', 'running', 'waiting_user', 'succeeded', 'failed', 'cancelled'));

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_executions_status_check' AND conrelid = 'workflow_executions'::regclass) THEN
        ALTER TABLE workflow_executions DROP CONSTRAINT workflow_executions_status_check;
    END IF;
END $$;
ALTER TABLE workflow_executions ADD CONSTRAINT workflow_executions_status_check CHECK (status IN ('queued', 'running', 'waiting_user', 'succeeded', 'failed', 'cancelled'));

CREATE TABLE IF NOT EXISTS manual_validation_challenges (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    certificate_id uuid NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
    order_url text NOT NULL,
    authorization_urls jsonb NOT NULL,
    challenges jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('waiting_user', 'approved', 'consumed', 'expired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    approved_at timestamptz,
    consumed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS manual_validation_challenges_job_idx ON manual_validation_challenges(job_id);
CREATE INDEX IF NOT EXISTS manual_validation_challenges_certificate_idx ON manual_validation_challenges(certificate_id, created_at DESC);
