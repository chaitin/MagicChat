-- +goose Up
CREATE TABLE message_app_reactions (
  message_id uuid NOT NULL REFERENCES message_registry(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  text varchar(128) NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (message_id, app_id, text)
);

CREATE INDEX message_app_reactions_message_text_index
  ON message_app_reactions (message_id, text, created_at);

CREATE INDEX message_app_reactions_app_message_index
  ON message_app_reactions (app_id, message_id);

-- +goose Down
DROP TABLE message_app_reactions;
