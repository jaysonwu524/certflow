-- Realtime events are the single notification source. Delivery work is
-- persisted separately so browser connectivity and transient SMTP/webhook
-- failures never affect certificate workflows.
CREATE TABLE notification_deliveries (
    id bigserial PRIMARY KEY,
    realtime_event_id bigint NOT NULL REFERENCES realtime_events(id) ON DELETE CASCADE,
    owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel text NOT NULL CHECK (channel IN ('email', 'webhook')),
    endpoint_id uuid REFERENCES notification_endpoints(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_expires_at timestamptz,
    last_error text,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX notification_deliveries_email_event_idx
    ON notification_deliveries (realtime_event_id)
    WHERE channel = 'email';

CREATE UNIQUE INDEX notification_deliveries_webhook_event_endpoint_idx
    ON notification_deliveries (realtime_event_id, endpoint_id)
    WHERE channel = 'webhook';

CREATE INDEX notification_deliveries_claim_idx
    ON notification_deliveries (status, next_attempt_at, id)
    WHERE status IN ('queued', 'running');

CREATE OR REPLACE FUNCTION certflow_queue_notification_deliveries() RETURNS trigger AS $$
BEGIN
    -- Email is attempted only when the administrator has configured SMTP. If
    -- SMTP is absent, the delivery worker marks this queued item complete.
    INSERT INTO notification_deliveries (realtime_event_id, owner_user_id, channel)
    VALUES (NEW.id, NEW.owner_user_id, 'email')
    ON CONFLICT DO NOTHING;

    INSERT INTO notification_deliveries (realtime_event_id, owner_user_id, channel, endpoint_id)
    SELECT NEW.id, NEW.owner_user_id, 'webhook', endpoint.id
    FROM notification_endpoints endpoint
    WHERE endpoint.owner_user_id = NEW.owner_user_id
      AND endpoint.type = 'webhook'
      AND endpoint.enabled
      AND endpoint.deleted_at IS NULL
      AND (cardinality(endpoint.event_filter) = 0 OR NEW.topic = ANY(endpoint.event_filter))
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER certflow_notification_delivery_trigger
AFTER INSERT ON realtime_events
FOR EACH ROW EXECUTE FUNCTION certflow_queue_notification_deliveries();
