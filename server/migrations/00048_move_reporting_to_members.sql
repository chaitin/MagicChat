-- +goose Up
-- A member has one formal reporting line, independent of department membership.
-- Preserve all old assignment-specific values for review when they disagree.
CREATE TABLE IF NOT EXISTS organization_reporting_legacy_assignments (
  assignment_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  department_id uuid NOT NULL,
  is_primary boolean NOT NULL,
  direct_manager_user_id uuid,
  dotted_manager_user_ids uuid[] NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO organization_reporting_legacy_assignments (
  assignment_id, user_id, department_id, is_primary,
  direct_manager_user_id, dotted_manager_user_ids
)
SELECT a.id, a.user_id, a.department_id, a.is_primary,
  a.direct_manager_user_id,
  coalesce(
    array_agg(d.manager_user_id ORDER BY d.manager_user_id)
      FILTER (WHERE d.manager_user_id IS NOT NULL),
    ARRAY[]::uuid[]
  )
FROM organization_assignments a
LEFT JOIN organization_dotted_managers d ON d.assignment_id = a.id
GROUP BY a.id
ON CONFLICT (assignment_id) DO NOTHING;

CREATE TABLE organization_member_reporting (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  direct_manager_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_member_reporting_not_self CHECK (
    direct_manager_user_id IS NULL OR direct_manager_user_id <> user_id
  )
);
CREATE INDEX organization_member_reporting_manager_index
  ON organization_member_reporting(direct_manager_user_id);

INSERT INTO organization_member_reporting (user_id, direct_manager_user_id)
SELECT u.id, manager.direct_manager_user_id
FROM users u
LEFT JOIN (
  SELECT DISTINCT ON (user_id) user_id, direct_manager_user_id
  FROM organization_assignments
  WHERE direct_manager_user_id IS NOT NULL
  ORDER BY user_id, is_primary DESC, sort_order, id
) manager ON manager.user_id = u.id;

CREATE TABLE organization_member_dotted_managers (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manager_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, manager_user_id),
  CONSTRAINT organization_member_dotted_not_self CHECK (user_id <> manager_user_id)
);

INSERT INTO organization_member_dotted_managers (user_id, manager_user_id)
SELECT DISTINCT a.user_id, d.manager_user_id
FROM organization_dotted_managers d
JOIN organization_assignments a ON a.id = d.assignment_id
JOIN organization_member_reporting r ON r.user_id = a.user_id
WHERE d.manager_user_id <> a.user_id
  AND d.manager_user_id IS DISTINCT FROM r.direct_manager_user_id;

DROP TABLE organization_dotted_managers;
ALTER TABLE organization_assignments DROP COLUMN direct_manager_user_id;

-- +goose Down
ALTER TABLE organization_assignments
  ADD COLUMN direct_manager_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organization_assignments
  ADD CONSTRAINT organization_assignments_not_self_manager
    CHECK (direct_manager_user_id IS NULL OR direct_manager_user_id <> user_id);
CREATE INDEX organization_assignments_direct_manager_index
  ON organization_assignments(direct_manager_user_id);
UPDATE organization_assignments a
SET direct_manager_user_id = r.direct_manager_user_id
FROM organization_member_reporting r
WHERE r.user_id = a.user_id;

CREATE TABLE organization_dotted_managers (
  assignment_id uuid NOT NULL REFERENCES organization_assignments(id) ON DELETE CASCADE,
  manager_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (assignment_id, manager_user_id)
);
INSERT INTO organization_dotted_managers (assignment_id, manager_user_id)
SELECT a.id, d.manager_user_id
FROM organization_assignments a
JOIN organization_member_dotted_managers d ON d.user_id = a.user_id;

DROP TABLE organization_member_dotted_managers;
DROP TABLE organization_member_reporting;
-- Keep organization_reporting_legacy_assignments as an audit backup.
