package store

import (
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func organizationMigrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("POSTGRES_TEST_DSN"))
	if dsn == "" {
		t.Skip("POSTGRES_TEST_DSN is not configured")
	}
	base, err := OpenPostgres(dsn)
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := base.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = baseSQL.Close() })
	schema := "organization_migration_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	organizationMigrationExec(t, base, "CREATE SCHEMA "+quotePostgresTestIdentifier(schema))
	t.Cleanup(func() {
		if err := base.Exec("DROP SCHEMA " + quotePostgresTestIdentifier(schema) + " CASCADE").Error; err != nil {
			t.Errorf("drop test schema: %v", err)
		}
	})
	testDSN, err := postgresDSNWithSearchPath(dsn, schema)
	if err != nil {
		t.Fatal(err)
	}
	db, err := OpenPostgres(testDSN)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}

func organizationMigrationExec(t *testing.T, db *gorm.DB, query string, args ...any) {
	t.Helper()
	if err := db.Exec(query, args...).Error; err != nil {
		t.Fatalf("execute fixture SQL: %v", err)
	}
}

func organizationMigrationCheck(t *testing.T, db *gorm.DB, query string, args ...any) {
	t.Helper()
	var ok bool
	if err := db.Raw(query, args...).Scan(&ok).Error; err != nil {
		t.Fatalf("check migration result: %v", err)
	}
	if !ok {
		t.Fatalf("migration result did not satisfy: %s", query)
	}
}

func organizationMigrationText(t *testing.T, db *gorm.DB, query string) string {
	t.Helper()
	var value string
	if err := db.Raw(query).Scan(&value).Error; err != nil {
		t.Fatal(err)
	}
	return value
}

func organizationMigrationUser(t *testing.T, db *gorm.DB, status string) string {
	t.Helper()
	id := uuid.NewString()
	// Use the old schema explicitly: the current User model includes job_title.
	organizationMigrationExec(t, db, `INSERT INTO users
		(id, email, name, password_hash, status, created_at, updated_at)
		VALUES (?, ?, '迁移测试成员', 'retained-password-hash', ?, now(), now())`, id, id+"@example.com", status)
	return id
}

func organizationMigrationUp(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := RunPostgresMigrations(db, "../../migrations"); err != nil {
		t.Fatalf("upgrade through production migration runner: %v", err)
	}
	organizationMigrationCheck(t, db, "SELECT max(version_id) = 52 FROM goose_db_version WHERE is_applied")
}

func TestPostgresOrganizationMigrationsFreshAndRepeatedStartup(t *testing.T) {
	db := organizationMigrationDB(t)
	organizationMigrationUp(t, db)
	organizationMigrationCheck(t, db, "SELECT count(*) = 1 FROM organization_units WHERE id = ?", RootOrganizationUnitID)
	organizationMigrationCheck(t, db, "SELECT count(*) = 1 FROM organization_departments WHERE id = ? AND is_root", RootDepartmentID)
	organizationMigrationCheck(t, db, "SELECT count(*) = 1 FROM organization_policy WHERE id = 1 AND visibility_scope = 'all'")
	member := organizationMigrationUser(t, db, UserStatusActive)
	organizationMigrationCheck(t, db, `SELECT count(*) = 1 FROM organization_assignments
		WHERE user_id = ? AND department_id = ? AND is_primary`, member, RootDepartmentID)
	organizationMigrationUp(t, db)
	organizationMigrationUp(t, db)
	organizationMigrationCheck(t, db, "SELECT count(*) = 1 FROM organization_assignments WHERE user_id = ?", member)
	organizationMigrationCheck(t, db, "SELECT count(*) = 52 FROM goose_db_version WHERE is_applied AND version_id > 0")
}

func TestPostgresOrganizationMigrationsUpgrade46RetainsBusinessData(t *testing.T) {
	db := organizationMigrationDB(t)
	if err := runPostgresTestMigrationsTo(db, 46); err != nil {
		t.Fatal(err)
	}
	member := organizationMigrationUser(t, db, UserStatusActive)
	disabled := organizationMigrationUser(t, db, UserStatusDisabled)
	conversation, message, session := uuid.NewString(), uuid.NewString(), uuid.NewString()
	organizationMigrationExec(t, db, `INSERT INTO conversations
		(id, kind, name, created_by_user_id, created_at, updated_at)
		VALUES (?, 'group', '迁移前会话', ?, now(), now())`, conversation, member)
	organizationMigrationExec(t, db, `INSERT INTO conversation_members
		(conversation_id, member_type, member_id, role, joined_at)
		VALUES (?, 'user', ?, 'owner', now())`, conversation, member)
	organizationMigrationExec(t, db, `INSERT INTO messages
		(id, conversation_id, seq, sender_type, sender_id, client_message_id, body, summary, created_at, updated_at)
		VALUES (?, ?, 1, 'user', ?, 'retained-client-id',
			'{"type":"text","content":"迁移前消息"}', '迁移前消息', now(), now())`, message, conversation, member)
	organizationMigrationExec(t, db, `INSERT INTO user_sessions
		(id, token_hash, user_id, expires_at, created_at, last_seen_at, refresh_token_hash,
		 refresh_expires_at, refresh_absolute_expires_at)
		VALUES (?, 'retained-session-token', ?, now() + interval '1 day', now(), now(),
			'retained-refresh-token', now() + interval '7 days', now() + interval '30 days')`, session, member)

	snapshots := map[string]string{
		"users":         `SELECT jsonb_agg(to_jsonb(t) - 'job_title' ORDER BY id)::text FROM users t`,
		"conversations": `SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM conversations t`,
		"members":       `SELECT jsonb_agg(to_jsonb(t) ORDER BY member_id)::text FROM conversation_members t`,
		"messages":      `SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM messages t`,
		"registry":      `SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM message_registry t`,
		"sessions":      `SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM user_sessions t`,
		"settings":      `SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM app_settings t`,
	}
	before := make(map[string]string, len(snapshots))
	for name, query := range snapshots {
		before[name] = organizationMigrationText(t, db, query)
	}
	checkBusinessData := func() {
		t.Helper()
		for name, query := range snapshots {
			if got := organizationMigrationText(t, db, query); got != before[name] {
				t.Fatalf("%s changed across organization migration: got %s, want %s", name, got, before[name])
			}
		}
	}
	organizationMigrationUp(t, db)
	checkBusinessData()
	organizationMigrationCheck(t, db, `SELECT count(*) = 2 AND bool_and(is_primary)
		FROM organization_assignments WHERE user_id IN (?, ?) AND department_id = ?`, member, disabled, RootDepartmentID)
	organizationMigrationCheck(t, db, "SELECT count(*) = 2 FROM users WHERE job_title = ''")
	organizationMigrationUp(t, db)
	checkBusinessData()
	if err := runPostgresTestMigrationsDownTo(db, 46); err != nil {
		t.Fatalf("down to 46: %v", err)
	}
	checkBusinessData()
	organizationMigrationCheck(t, db, "SELECT to_regclass('organization_assignments') IS NULL")
	organizationMigrationCheck(t, db, `SELECT count(*) = 0 FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'job_title'`)
	organizationMigrationUp(t, db)
	checkBusinessData()
	organizationMigrationCheck(t, db, "SELECT count(*) = 2 FROM organization_assignments")
}

func TestPostgresOrganizationMigrationsLegacyReportingAndTitle(t *testing.T) {
	db := organizationMigrationDB(t)
	if err := runPostgresTestMigrationsTo(db, 47); err != nil {
		t.Fatal(err)
	}
	member := organizationMigrationUser(t, db, UserStatusActive)
	managerA := organizationMigrationUser(t, db, UserStatusActive)
	managerB := organizationMigrationUser(t, db, UserStatusActive)
	managerC := organizationMigrationUser(t, db, UserStatusActive)
	department, secondary := uuid.NewString(), uuid.NewString()
	organizationMigrationExec(t, db, `INSERT INTO organization_departments
		(id, unit_id, parent_id, name, created_at, updated_at)
		VALUES (?, ?, ?, '兼任部门', now(), now())`, department, RootOrganizationUnitID, RootDepartmentID)
	organizationMigrationExec(t, db, `UPDATE organization_assignments
		SET title = '工程师', direct_manager_user_id = ? WHERE user_id = ?`, managerA, member)
	organizationMigrationExec(t, db, `INSERT INTO organization_assignments
		(id, user_id, department_id, title, is_primary, sort_order, direct_manager_user_id, created_at, updated_at)
		VALUES (?, ?, ?, '旧兼任职务', false, -1, ?, now(), now())`, secondary, member, department, managerB)
	organizationMigrationExec(t, db, `INSERT INTO organization_dotted_managers (assignment_id, manager_user_id)
		SELECT id, ?::uuid FROM organization_assignments WHERE user_id = ?`, managerC, member)
	organizationMigrationExec(t, db, `INSERT INTO organization_dotted_managers (assignment_id, manager_user_id)
		VALUES (?, ?), (?, ?), (?, ?)`, secondary, managerA, secondary, member, secondary, managerB)
	organizationMigrationExec(t, db, `UPDATE organization_policy
		SET visibility_scope = 'same_department', show_contact_details = false WHERE id = 1`)
	legacy := organizationMigrationText(t, db, `SELECT jsonb_agg(jsonb_build_object(
		'assignment_id', a.id, 'user_id', a.user_id, 'department_id', a.department_id,
		'is_primary', a.is_primary, 'direct_manager_user_id', a.direct_manager_user_id,
		'dotted_manager_user_ids', coalesce((SELECT jsonb_agg(d.manager_user_id ORDER BY d.manager_user_id)
			FROM organization_dotted_managers d WHERE d.assignment_id = a.id), '[]'::jsonb))
		ORDER BY a.id)::text FROM organization_assignments a`)
	if err := runPostgresTestMigrationsTo(db, 49); err != nil {
		t.Fatal(err)
	}
	organizationMigrationCheck(t, db, `SELECT count(*) = 1 FROM organization_policy
		WHERE NOT show_email AND NOT show_phone AND visibility_scope = 'same_department'`)
	archiveQuery := `SELECT jsonb_agg(to_jsonb(a) - 'archived_at' ORDER BY assignment_id)::text
		FROM organization_reporting_legacy_assignments a`
	if got := organizationMigrationText(t, db, archiveQuery); got != legacy {
		t.Fatalf("legacy reporting audit differs: got %s, want %s", got, legacy)
	}
	organizationMigrationUp(t, db)
	check := func() {
		t.Helper()
		organizationMigrationCheck(t, db, "SELECT job_title = '工程师' FROM users WHERE id = ?", member)
		organizationMigrationCheck(t, db, "SELECT count(*) = 2 FROM organization_assignments WHERE user_id = ?", member)
		organizationMigrationCheck(t, db, "SELECT direct_manager_user_id = ? FROM organization_member_reporting WHERE user_id = ?", managerA, member)
		organizationMigrationCheck(t, db, `SELECT count(*) = 2 AND bool_and(manager_user_id IN (?, ?))
			FROM organization_member_dotted_managers WHERE user_id = ?`, managerB, managerC, member)
		if got := organizationMigrationText(t, db, archiveQuery); got != legacy {
			t.Fatal("original reporting audit was overwritten")
		}
	}
	check()
	organizationMigrationCheck(t, db, `SELECT count(*) = 0 FROM information_schema.columns
		WHERE table_schema = current_schema() AND
		((table_name = 'organization_assignments' AND column_name IN ('title', 'direct_manager_user_id'))
		OR (table_name = 'organization_policy' AND column_name IN
			('show_email', 'show_phone', 'show_job_title', 'show_reporting', 'show_department')))`)
	organizationMigrationCheck(t, db, `SELECT count(*) = 1 FROM organization_policy
		WHERE visibility_scope = 'same_department' AND NOT show_contact_details`)
	organizationMigrationUp(t, db)
	check()
	if err := runPostgresTestMigrationsDownTo(db, 47); err != nil {
		t.Fatal(err)
	}
	// Down projects current member values to all assignments, not the archived values.
	organizationMigrationCheck(t, db, `SELECT count(*) = 2 AND bool_and(title = '工程师' AND direct_manager_user_id = ?)
		FROM organization_assignments WHERE user_id = ?`, managerA, member)
	organizationMigrationCheck(t, db, `SELECT count(*) = 4 FROM organization_dotted_managers d
		JOIN organization_assignments a ON a.id = d.assignment_id WHERE a.user_id = ?`, member)
	organizationMigrationUp(t, db)
	check()
}

func TestPostgresOrganizationMigrationFailureRollsBackAndRetries(t *testing.T) {
	db := organizationMigrationDB(t)
	if err := runPostgresTestMigrationsTo(db, 49); err != nil {
		t.Fatal(err)
	}
	member := organizationMigrationUser(t, db, UserStatusActive)
	// Version 47 permitted text of any length; version 50 introduces varchar(160).
	organizationMigrationExec(t, db, "UPDATE organization_assignments SET title = ? WHERE user_id = ?", strings.Repeat("职", 161), member)
	if err := RunPostgresMigrations(db, "../../migrations"); err == nil || !strings.Contains(err.Error(), "22001") {
		t.Fatalf("expected PostgreSQL title length failure, got %v", err)
	}
	organizationMigrationCheck(t, db, "SELECT max(version_id) = 49 FROM goose_db_version WHERE is_applied")
	organizationMigrationCheck(t, db, `SELECT count(*) = 0 FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'job_title'`)
	organizationMigrationCheck(t, db, "SELECT char_length(title) = 161 FROM organization_assignments WHERE user_id = ?", member)
	organizationMigrationExec(t, db, "UPDATE organization_assignments SET title = '已修正测试职务' WHERE user_id = ?", member)
	organizationMigrationUp(t, db)
	organizationMigrationCheck(t, db, "SELECT job_title = '已修正测试职务' FROM users WHERE id = ?", member)
}
