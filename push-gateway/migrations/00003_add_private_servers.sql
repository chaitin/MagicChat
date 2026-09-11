-- +goose Up
CREATE TABLE push_servers (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  server_key text NOT NULL UNIQUE,
  status text NOT NULL,
  daily_quota bigint NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT push_servers_name_check CHECK (char_length(name) BETWEEN 1 AND 64),
  CONSTRAINT push_servers_key_check CHECK (server_key ~ '^[0-9a-f]{32}$'),
  CONSTRAINT push_servers_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT push_servers_daily_quota_check CHECK (daily_quota BETWEEN 1 AND 100000000)
);

CREATE TABLE push_server_daily_usage (
  server_id uuid NOT NULL REFERENCES push_servers(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  accepted_count bigint NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (server_id, usage_date),
  CONSTRAINT push_server_daily_usage_count_check CHECK (accepted_count >= 0)
);

CREATE TABLE push_admin_sessions (
  id uuid PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE,
  csrf_token_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX push_admin_sessions_expiration_index ON push_admin_sessions (expires_at);

CREATE TABLE push_admin_audit_events (
  id uuid PRIMARY KEY,
  action text NOT NULL,
  server_id uuid REFERENCES push_servers(id) ON DELETE SET NULL,
  request_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL
);

CREATE INDEX push_admin_audit_events_created_index ON push_admin_audit_events (created_at);

ALTER TABLE push_jobs
  ADD COLUMN server_id uuid REFERENCES push_servers(id) ON DELETE RESTRICT,
  ADD COLUMN quota_date date;

CREATE INDEX push_jobs_server_created_index ON push_jobs (server_id, created_at);

-- +goose Down
DROP INDEX push_jobs_server_created_index;
ALTER TABLE push_jobs DROP COLUMN quota_date, DROP COLUMN server_id;
DROP TABLE push_admin_audit_events;
DROP TABLE push_admin_sessions;
DROP TABLE push_server_daily_usage;
DROP TABLE push_servers;
