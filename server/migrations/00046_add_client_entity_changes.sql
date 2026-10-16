-- +goose Up
CREATE TABLE client_entity_changes (
    type VARCHAR(32) NOT NULL,
    entity_id UUID NOT NULL,
    recipient_id VARCHAR(36) NOT NULL DEFAULT '',
    revision BIGINT NOT NULL,
    published_revision BIGINT NOT NULL DEFAULT 0,
    event VARCHAR(64) NOT NULL,
    public BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (type, entity_id, recipient_id)
);
CREATE INDEX client_entity_changes_pending ON client_entity_changes (updated_at)
    WHERE revision > published_revision;

-- +goose Down
DROP TABLE client_entity_changes;
