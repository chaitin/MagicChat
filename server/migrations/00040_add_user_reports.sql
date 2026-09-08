-- +goose Up
CREATE TABLE user_reports (
    id uuid PRIMARY KEY,
    reporter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reported_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
    reason varchar(64) NOT NULL,
    description varchar(500) NOT NULL,
    created_at timestamptz NOT NULL,
    CONSTRAINT user_reports_distinct_users_check CHECK (reporter_user_id <> reported_user_id),
    CONSTRAINT user_reports_reason_check CHECK (reason IN (
        'sexual_content',
        'violence_or_threat',
        'harassment_or_abuse',
        'hate_or_discrimination',
        'fraud',
        'spam',
        'illegal_content',
        'privacy_or_ip_violation',
        'other'
    )),
    CONSTRAINT user_reports_description_check CHECK (length(btrim(description)) BETWEEN 1 AND 500)
);

CREATE INDEX user_reports_created_at_index ON user_reports (created_at DESC);
CREATE INDEX user_reports_reported_user_index ON user_reports (reported_user_id, created_at DESC);
CREATE INDEX user_reports_reporter_user_index ON user_reports (reporter_user_id, created_at DESC);

-- +goose Down
DROP TABLE user_reports;
