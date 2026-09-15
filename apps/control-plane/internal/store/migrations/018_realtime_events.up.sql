CREATE TABLE realtime_events (
    id bigserial PRIMARY KEY,
    owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic text NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    status text NOT NULL DEFAULT '',
    payload jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX realtime_events_owner_id_idx ON realtime_events (owner_user_id, id DESC);

CREATE OR REPLACE FUNCTION certflow_emit_realtime_event(
    p_owner_user_id uuid,
    p_topic text,
    p_resource_type text,
    p_resource_id uuid,
    p_status text,
    p_payload jsonb
) RETURNS void AS $$
DECLARE
    event_id bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RETURN;
    END IF;
    INSERT INTO realtime_events (owner_user_id, topic, resource_type, resource_id, status, payload)
    VALUES (p_owner_user_id, p_topic, p_resource_type, p_resource_id, p_status, COALESCE(p_payload, '{}'::jsonb))
    RETURNING id INTO event_id;
    PERFORM pg_notify('certflow_realtime_events', event_id::text);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION certflow_realtime_certificate_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.current_certificate_version_id IS DISTINCT FROM NEW.current_certificate_version_id THEN
        PERFORM certflow_emit_realtime_event(
            NEW.owner_user_id,
            'certificate.status',
            'certificate',
            NEW.id,
            NEW.status,
            jsonb_build_object('certificateId', NEW.id::text, 'name', NEW.name, 'status', NEW.status)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER certflow_realtime_certificate_trigger
AFTER INSERT OR UPDATE OF status, current_certificate_version_id ON certificates
FOR EACH ROW EXECUTE FUNCTION certflow_realtime_certificate_change();

CREATE OR REPLACE FUNCTION certflow_realtime_execution_change() RETURNS trigger AS $$
DECLARE
    event_owner uuid;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
        RETURN NEW;
    END IF;
    SELECT c.owner_user_id INTO event_owner
    FROM certificates c
    WHERE c.id = NEW.certificate_id;
    IF event_owner IS NULL AND NEW.automation_task_id IS NOT NULL THEN
        SELECT a.owner_user_id INTO event_owner
        FROM automation_tasks a
        WHERE a.id = NEW.automation_task_id;
    END IF;
    PERFORM certflow_emit_realtime_event(
        event_owner,
        'execution.status',
        'execution',
        NEW.id,
        NEW.status,
        jsonb_build_object(
            'executionId', NEW.id::text,
            'certificateId', COALESCE(NEW.certificate_id::text, ''),
            'kind', NEW.kind,
            'status', NEW.status
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER certflow_realtime_execution_trigger
AFTER INSERT OR UPDATE OF status ON workflow_executions
FOR EACH ROW EXECUTE FUNCTION certflow_realtime_execution_change();
