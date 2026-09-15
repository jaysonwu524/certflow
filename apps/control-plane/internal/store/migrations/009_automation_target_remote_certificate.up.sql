ALTER TABLE automation_task_targets ADD COLUMN IF NOT EXISTS remote_certificate_id text;
ALTER TABLE automation_task_targets ADD COLUMN IF NOT EXISTS last_uploaded_version_id uuid REFERENCES certificate_versions(id);
