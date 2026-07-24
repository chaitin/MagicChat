-- +goose Up
ALTER TABLE app_settings
  ADD COLUMN assistant_auto_group_naming_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN assistant_auto_group_naming_message_count integer NOT NULL DEFAULT 5,
  ADD CONSTRAINT app_settings_assistant_auto_group_naming_message_count_check
    CHECK (assistant_auto_group_naming_message_count BETWEEN 1 AND 30);

CREATE TABLE conversation_auto_name_tasks (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  message_count integer NOT NULL DEFAULT 0,
  message_limit integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  triggered_version integer NOT NULL DEFAULT 0,
  trigger_message_seq bigint,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT conversation_auto_name_tasks_status_check
    CHECK (status IN ('pending', 'completed', 'skipped', 'failed')),
  CONSTRAINT conversation_auto_name_tasks_message_count_check CHECK (message_count >= 0),
  CONSTRAINT conversation_auto_name_tasks_message_limit_check CHECK (message_limit BETWEEN 1 AND 30),
  CONSTRAINT conversation_auto_name_tasks_version_check CHECK (version >= 1),
  CONSTRAINT conversation_auto_name_tasks_triggered_version_check CHECK (triggered_version >= 0)
);

CREATE INDEX conversation_auto_name_tasks_status_index
  ON conversation_auto_name_tasks (status, updated_at);

-- +goose Down
DROP TABLE conversation_auto_name_tasks;

ALTER TABLE app_settings
  DROP CONSTRAINT app_settings_assistant_auto_group_naming_message_count_check,
  DROP COLUMN assistant_auto_group_naming_message_count,
  DROP COLUMN assistant_auto_group_naming_enabled;
