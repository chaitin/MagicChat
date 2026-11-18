-- +goose Up
ALTER TABLE users ADD COLUMN job_title varchar(160) NOT NULL DEFAULT '';

-- The member's existing primary organization determines the initial job title.
UPDATE users AS u
SET job_title = a.title
FROM organization_assignments AS a
WHERE a.user_id = u.id AND a.is_primary = true;

ALTER TABLE organization_assignments DROP COLUMN title;

-- +goose Down
ALTER TABLE organization_assignments ADD COLUMN title varchar(160) NOT NULL DEFAULT '';
-- Restore the current member-level title to every membership before rollback.
UPDATE organization_assignments AS a
SET title = u.job_title
FROM users AS u
WHERE a.user_id = u.id;
ALTER TABLE users DROP COLUMN job_title;
