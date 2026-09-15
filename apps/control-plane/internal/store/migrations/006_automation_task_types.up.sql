-- Automation owns renewal and delivery policies. Certificates retain only the
-- renewal window, while tasks determine whether and where a new version runs.
ALTER TABLE automation_tasks
    ADD COLUMN IF NOT EXISTS cloud_credential_id uuid REFERENCES cloud_credentials(id);

ALTER TABLE automation_tasks
    DROP CONSTRAINT IF EXISTS automation_tasks_action_type_check;

UPDATE automation_tasks
SET action_type = 'deploy_alb'
WHERE action_type = 'renew_and_deploy_alb';

ALTER TABLE automation_tasks
    ADD CONSTRAINT automation_tasks_action_type_check
    CHECK (action_type IN ('renew_certificate', 'upload_ssl', 'deploy_alb'));

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_kind_check
    CHECK (kind IN ('issue', 'renew', 'upload', 'deploy', 'notify', 'cleanup_dns'));

ALTER TABLE workflow_executions DROP CONSTRAINT IF EXISTS workflow_executions_kind_check;
ALTER TABLE workflow_executions
    ADD CONSTRAINT workflow_executions_kind_check
    CHECK (kind IN ('issue', 'renew', 'upload', 'deploy', 'notify', 'cleanup_dns'));
