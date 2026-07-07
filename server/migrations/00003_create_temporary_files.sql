-- +goose Up
CREATE TABLE temporary_files (
  id uuid PRIMARY KEY,
  object_key text NOT NULL,
  size_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT temporary_files_object_key_unique UNIQUE (object_key),
  CONSTRAINT temporary_files_size_bytes_check CHECK (size_bytes >= 0)
);

-- +goose Down
DROP TABLE temporary_files;
