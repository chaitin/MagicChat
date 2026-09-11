-- +goose Up
CREATE TABLE push_rate_limits (
  scope text NOT NULL,
  key_hash bytea NOT NULL,
  window_start timestamptz NOT NULL,
  count bigint NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (scope, key_hash, window_start),
  CONSTRAINT push_rate_limits_count_check CHECK (count > 0)
);

CREATE INDEX push_rate_limits_updated_index ON push_rate_limits (updated_at);

CREATE TABLE push_installations (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  provider_token text NOT NULL,
  platform text NOT NULL,
  environment text NOT NULL DEFAULT 'production',
  app_version text NOT NULL DEFAULT '',
  management_token_hash bytea NOT NULL,
  status text NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT push_installations_provider_check CHECK (provider IN ('apns', 'jpush', 'getui', 'fake')),
  CONSTRAINT push_installations_platform_check CHECK (platform IN ('android', 'ios')),
  CONSTRAINT push_installations_environment_check CHECK (environment IN ('development', 'production')),
  CONSTRAINT push_installations_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT push_installations_provider_token_length_check CHECK (octet_length(provider_token) BETWEEN 8 AND 255),
  CONSTRAINT push_installations_provider_token_unique UNIQUE (provider, environment, provider_token)
);

CREATE INDEX push_installations_retention_index ON push_installations (updated_at);

CREATE TABLE push_grants (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES push_installations(id) ON DELETE CASCADE,
  send_token_hash bytea NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT push_grants_status_check CHECK (status IN ('active', 'revoked', 'expired'))
);

CREATE UNIQUE INDEX push_grants_one_active_per_installation
  ON push_grants (installation_id)
  WHERE status = 'active';
CREATE INDEX push_grants_expiration_index ON push_grants (status, expires_at);
CREATE INDEX push_grants_retention_index ON push_grants (status, updated_at);

CREATE TABLE push_jobs (
  id uuid PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES push_grants(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  event_type text NOT NULL,
  route_token text NOT NULL,
  collapse_key text NOT NULL DEFAULT '',
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  locked_at timestamptz,
  lock_token text NOT NULL DEFAULT '',
  provider_message_id text NOT NULL DEFAULT '',
  last_error_code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT push_jobs_status_check CHECK (status IN ('queued', 'sending', 'retry', 'accepted', 'failed', 'expired')),
  CONSTRAINT push_jobs_attempts_check CHECK (attempts >= 0),
  CONSTRAINT push_jobs_idempotency_unique UNIQUE (grant_id, idempotency_key)
);

CREATE INDEX push_jobs_dispatch_index ON push_jobs (status, next_attempt_at, created_at);
CREATE INDEX push_jobs_grant_created_index ON push_jobs (grant_id, created_at);

-- +goose Down
DROP TABLE push_jobs;
DROP TABLE push_grants;
DROP TABLE push_installations;
DROP TABLE push_rate_limits;
