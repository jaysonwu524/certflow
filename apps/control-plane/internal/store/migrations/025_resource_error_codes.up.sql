-- Stable error identifiers let clients localize and aggregate failures without
-- parsing provider-specific text. The existing last_error columns remain the
-- human-readable diagnostic for operators.
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE cloud_credentials ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE dns_accounts ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE deployment_targets ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE certificate_deployments ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE automation_tasks ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS last_error_code text;

CREATE INDEX IF NOT EXISTS certificates_error_code_idx
    ON certificates (last_error_code) WHERE last_error_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS automation_tasks_error_code_idx
    ON automation_tasks (last_error_code) WHERE last_error_code IS NOT NULL;
