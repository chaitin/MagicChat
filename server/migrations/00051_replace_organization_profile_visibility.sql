-- +goose Up
ALTER TABLE organization_policy
  ADD COLUMN show_job_title boolean NOT NULL DEFAULT true,
  ADD COLUMN show_reporting boolean NOT NULL DEFAULT true,
  ADD COLUMN show_department boolean NOT NULL DEFAULT true;

-- Contact visibility and organization-profile visibility have different meanings.
-- New profile fields stay visible until an administrator changes them.
ALTER TABLE organization_policy DROP COLUMN show_email, DROP COLUMN show_phone;

-- +goose Down
ALTER TABLE organization_policy
  ADD COLUMN show_email boolean NOT NULL DEFAULT true,
  ADD COLUMN show_phone boolean NOT NULL DEFAULT true;
ALTER TABLE organization_policy
  DROP COLUMN show_job_title, DROP COLUMN show_reporting, DROP COLUMN show_department;
