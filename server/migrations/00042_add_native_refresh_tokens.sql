-- +goose Up
ALTER TABLE user_sessions ADD COLUMN refresh_token_hash varchar(64);
ALTER TABLE user_sessions ADD COLUMN refresh_expires_at timestamptz;
ALTER TABLE user_sessions ADD COLUMN refresh_absolute_expires_at timestamptz;
ALTER TABLE user_sessions ADD COLUMN native_exchange_until timestamptz;
CREATE UNIQUE INDEX user_sessions_refresh_token_hash_key ON user_sessions (refresh_token_hash);

CREATE TABLE used_native_refresh_tokens (
  token_hash varchar(64) PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX used_native_refresh_tokens_expires_at_idx ON used_native_refresh_tokens (expires_at);

-- +goose Down
DROP TABLE used_native_refresh_tokens;
DROP INDEX user_sessions_refresh_token_hash_key;
ALTER TABLE user_sessions DROP COLUMN native_exchange_until;
ALTER TABLE user_sessions DROP COLUMN refresh_absolute_expires_at;
ALTER TABLE user_sessions DROP COLUMN refresh_expires_at;
ALTER TABLE user_sessions DROP COLUMN refresh_token_hash;
