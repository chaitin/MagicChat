-- +goose Up
ALTER TABLE apps
  DROP CONSTRAINT apps_visibility_check;

ALTER TABLE apps
  ADD CONSTRAINT apps_visibility_check CHECK (visibility IN ('creator', 'restricted', 'public'));

CREATE TABLE app_user_grants (
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, user_id)
);

CREATE INDEX app_user_grants_user_id_index ON app_user_grants (user_id, app_id);

-- +goose Down
DROP INDEX app_user_grants_user_id_index;
DROP TABLE app_user_grants;

UPDATE apps
SET visibility = 'creator'
WHERE visibility = 'restricted';

ALTER TABLE apps
  DROP CONSTRAINT apps_visibility_check;

ALTER TABLE apps
  ADD CONSTRAINT apps_visibility_check CHECK (visibility IN ('creator', 'public'));
