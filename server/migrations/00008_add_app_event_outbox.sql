-- +goose Up
CREATE TABLE app_event_outbox (
  id bigserial PRIMARY KEY,
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT app_event_outbox_payload_object_check CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX app_event_outbox_app_cursor_index ON app_event_outbox (app_id, id);

CREATE TABLE app_event_acks (
  app_id uuid PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,
  last_acked_cursor bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL,
  CONSTRAINT app_event_acks_cursor_check CHECK (last_acked_cursor >= 0)
);

-- +goose Down
DROP TABLE app_event_acks;
DROP TABLE app_event_outbox;
