-- +goose Up
ALTER TABLE temporary_files
  ADD COLUMN expires_at timestamptz;

UPDATE temporary_files
SET expires_at = created_at + CASE
  WHEN size_bytes > 10485760 THEN INTERVAL '30 days'
  ELSE INTERVAL '180 days'
END;

ALTER TABLE temporary_files
  ALTER COLUMN expires_at SET NOT NULL,
  ADD CONSTRAINT temporary_files_expires_at_check CHECK (expires_at > created_at);

CREATE INDEX temporary_files_expires_at_index ON temporary_files (expires_at);

-- +goose Down
DROP INDEX temporary_files_expires_at_index;

ALTER TABLE temporary_files
  DROP CONSTRAINT temporary_files_expires_at_check,
  DROP COLUMN expires_at;
