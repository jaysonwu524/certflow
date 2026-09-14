CREATE TABLE user_notification_reads (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    realtime_event_id bigint NOT NULL REFERENCES realtime_events(id) ON DELETE CASCADE,
    read_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, realtime_event_id)
);

CREATE INDEX user_notification_reads_event_idx ON user_notification_reads (realtime_event_id);
