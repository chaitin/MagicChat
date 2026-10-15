-- +goose Up
CREATE TABLE user_push_preferences (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    pause_when_desktop_active boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL
);

CREATE TABLE user_push_presences (
    session_id uuid PRIMARY KEY REFERENCES user_sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform varchar(16) NOT NULL,
    foreground boolean NOT NULL,
    expires_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE INDEX user_push_presences_user_active_index
    ON user_push_presences (user_id, platform, expires_at);

-- +goose Down
DROP TABLE user_push_presences;
DROP TABLE user_push_preferences;
