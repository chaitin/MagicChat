-- +goose Up
ALTER TABLE app_conversations ADD COLUMN app_initiated boolean NOT NULL DEFAULT false;

CREATE TABLE app_message_send_states (
  app_id uuid PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE
);

CREATE TABLE app_message_sends (
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  client_message_id varchar(128) NOT NULL,
  recipient_user_id uuid,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (app_id, client_message_id)
);
CREATE INDEX app_message_sends_window ON app_message_sends (app_id, created_at);

-- +goose Down
DROP TABLE app_message_sends;
DROP TABLE app_message_send_states;
ALTER TABLE app_conversations DROP COLUMN app_initiated;
