-- +goose Up
ALTER TABLE organization_policy
  DROP COLUMN show_job_title,
  DROP COLUMN show_reporting,
  DROP COLUMN show_department;

-- +goose Down
ALTER TABLE organization_policy
  ADD COLUMN show_job_title boolean NOT NULL DEFAULT true,
  ADD COLUMN show_reporting boolean NOT NULL DEFAULT true,
  ADD COLUMN show_department boolean NOT NULL DEFAULT true;
