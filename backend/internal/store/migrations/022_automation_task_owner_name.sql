-- Task names are a per-user convenience label. They must not collide across
-- tenants, and a soft-deleted task must not reserve its former name forever.
ALTER TABLE automation_tasks
    DROP CONSTRAINT IF EXISTS automation_tasks_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS automation_tasks_owner_name_key
    ON automation_tasks (owner_user_id, lower(name))
    WHERE deleted_at IS NULL;
