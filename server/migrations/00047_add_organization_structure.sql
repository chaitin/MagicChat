-- +goose Up
CREATE TABLE organization_units (
  id uuid PRIMARY KEY,
  parent_id uuid REFERENCES organization_units(id) ON DELETE RESTRICT,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('group', 'subsidiary', 'business_unit')),
  leader_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT organization_units_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX organization_units_parent_order_index ON organization_units(parent_id, sort_order, id);

CREATE TABLE organization_departments (
  id uuid PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
  parent_id uuid REFERENCES organization_departments(id) ON DELETE RESTRICT,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_root boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT organization_departments_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX organization_departments_parent_order_index ON organization_departments(parent_id, sort_order, id);
CREATE UNIQUE INDEX organization_departments_one_root_per_unit ON organization_departments(unit_id) WHERE is_root;

CREATE TABLE organization_assignments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES organization_departments(id) ON DELETE RESTRICT,
  title text NOT NULL DEFAULT '',
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  direct_manager_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT organization_assignments_not_self_manager CHECK (direct_manager_user_id IS NULL OR direct_manager_user_id <> user_id),
  CONSTRAINT organization_assignments_user_department_unique UNIQUE(user_id, department_id)
);
CREATE UNIQUE INDEX organization_assignments_one_primary ON organization_assignments(user_id) WHERE is_primary;
CREATE INDEX organization_assignments_department_order_index ON organization_assignments(department_id, sort_order, user_id);
CREATE INDEX organization_assignments_direct_manager_index ON organization_assignments(direct_manager_user_id);

CREATE TABLE organization_dotted_managers (
  assignment_id uuid NOT NULL REFERENCES organization_assignments(id) ON DELETE CASCADE,
  manager_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (assignment_id, manager_user_id)
);
CREATE TABLE organization_department_leaders (
  department_id uuid NOT NULL REFERENCES organization_departments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  PRIMARY KEY (department_id, user_id)
);
CREATE UNIQUE INDEX organization_department_leaders_one_primary ON organization_department_leaders(department_id) WHERE is_primary;

CREATE TABLE organization_audit_events (
  id uuid PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX organization_audit_events_target_index ON organization_audit_events(target_type, target_id, created_at DESC);

CREATE TABLE organization_policy (
  id integer PRIMARY KEY CHECK (id = 1),
  visibility_scope text NOT NULL DEFAULT 'all' CHECK (visibility_scope IN ('all', 'same_unit', 'same_department')),
  show_contact_details boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL
);
INSERT INTO organization_policy (id, visibility_scope, show_contact_details, updated_at) VALUES (1, 'all', true, now());

-- The existing singleton workspace becomes the group. Existing users keep
-- their IDs and conversations, and receive one primary assignment.
INSERT INTO organization_units (id, parent_id, name, kind, sort_order, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', NULL, '', 'group', 0, now(), now());
INSERT INTO organization_departments (id, unit_id, parent_id, name, is_root, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', NULL, '', true, now(), now());
INSERT INTO organization_assignments (id, user_id, department_id, is_primary, created_at, updated_at)
SELECT gen_random_uuid(), id, '00000000-0000-0000-0000-000000000002', true, now(), now() FROM users;

-- +goose StatementBegin
CREATE FUNCTION assign_new_user_to_root_department() RETURNS trigger AS $$
BEGIN
  INSERT INTO organization_assignments (id, user_id, department_id, is_primary, created_at, updated_at)
  VALUES (gen_random_uuid(), NEW.id, '00000000-0000-0000-0000-000000000002', true, now(), now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER users_assign_root_department
AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION assign_new_user_to_root_department();

-- +goose Down
DROP TABLE organization_policy;
DROP TRIGGER users_assign_root_department ON users;
DROP FUNCTION assign_new_user_to_root_department();
DROP TABLE organization_audit_events;
DROP TABLE organization_department_leaders;
DROP TABLE organization_dotted_managers;
DROP TABLE organization_assignments;
DROP TABLE organization_departments;
DROP TABLE organization_units;
