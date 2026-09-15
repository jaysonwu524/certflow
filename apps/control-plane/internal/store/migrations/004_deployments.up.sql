ALTER TABLE certificate_deployments ADD COLUMN IF NOT EXISTS remote_certificate_id text;
ALTER TABLE certificate_deployments ADD COLUMN IF NOT EXISTS last_deployed_version_id uuid REFERENCES certificate_versions(id);
