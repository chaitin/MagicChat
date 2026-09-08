-- +goose Up
CREATE TABLE user_blocks (
    blocker_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (blocker_user_id, blocked_user_id),
    CONSTRAINT user_blocks_distinct_users_check CHECK (blocker_user_id <> blocked_user_id)
);

-- +goose Down
DROP TABLE user_blocks;
