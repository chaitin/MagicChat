package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestAdminUserCreationProvisionsPersonalWorkspace(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	adminCookie := loginAsAdmin(t, server)
	resp, body := postJSON(t, server, "/api/admin/users", map[string]any{
		"email": "personal-workspace-admin@example.com",
		"name":  "Admin Created User",
	}, adminCookie)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201, body = %#v", resp.StatusCode, body)
	}
	requireSuccess(t, body)

	var user store.User
	if err := db.First(&user, "email = ?", "personal-workspace-admin@example.com").Error; err != nil {
		t.Fatalf("find created user: %v", err)
	}
	requirePersonalWorkspace(t, db, user)
}

func TestFirstTimeThirdPartyUserCreationProvisionsOnePersonalWorkspace(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	provider := insertTestThirdPartyLoginProvider(t, db, store.ThirdPartyLoginProvider{
		Name:    "Personal Workspace SSO",
		Key:     "personal-workspace-sso",
		Enabled: true,
	})
	profile := externalUserProfile{
		ExternalUserID: "personal-workspace-external-user",
		Email:          "personal-workspace-third-party@example.com",
		Name:           "Third Party User",
		Raw:            json.RawMessage(`{"sub":"personal-workspace-external-user"}`),
	}
	subject := &Server{db: db}

	user, err := subject.findOrCreateThirdPartyUser(provider, profile)
	if err != nil {
		t.Fatalf("find or create third-party user: %v", err)
	}
	requirePersonalWorkspace(t, db, user)
	var account store.ThirdPartyAccount
	if err := db.First(
		&account,
		"provider_id = ? AND external_user_id = ?",
		provider.ID,
		profile.ExternalUserID,
	).Error; err != nil {
		t.Fatalf("find third-party account before repeated login: %v", err)
	}
	if account.UserID != user.ID {
		t.Fatalf("third-party account user ID = %q, want %q", account.UserID, user.ID)
	}

	repeatedUser, err := subject.findOrCreateThirdPartyUser(provider, profile)
	if err != nil {
		t.Fatalf("repeat find or create third-party user: %v", err)
	}
	if repeatedUser.ID != user.ID {
		t.Fatalf("repeated user ID = %q, want %q", repeatedUser.ID, user.ID)
	}
	requirePersonalWorkspace(t, db, user)
}

func TestAdminUserCreationRollsBackWhenPersonalWorkspaceInsertFails(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	adminCookie := loginAsAdmin(t, server)
	failPersonalWorkspaceCreates(t, db)

	resp, body := postJSON(t, server, "/api/admin/users", map[string]any{
		"email": "personal-workspace-admin-rollback@example.com",
		"name":  "Rolled Back Admin User",
	}, adminCookie)
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body = %#v", resp.StatusCode, body)
	}
	requireError(t, body, "internal_error")

	requireRowCount(t, db, &store.User{}, 0, "email = ?", "personal-workspace-admin-rollback@example.com")
	requireRowCount(t, db.Unscoped(), &store.Project{}, 0, "1 = 1")
}

func TestFirstTimeThirdPartyUserCreationRollsBackPersonalWorkspaceWhenAccountInsertFails(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	provider := insertTestThirdPartyLoginProvider(t, db, store.ThirdPartyLoginProvider{
		Name:    "Personal Workspace Account Failure SSO",
		Key:     "personal-workspace-account-failure-sso",
		Enabled: true,
	})
	var projectCountBefore int64
	if err := db.Unscoped().Model(&store.Project{}).Count(&projectCountBefore).Error; err != nil {
		t.Fatalf("count projects before third-party account failure: %v", err)
	}

	accountInsertErr := errors.New("forced third-party account insertion failure")
	failCreatesForTable(
		t,
		db,
		"test:fail_third_party_account_create",
		"third_party_accounts",
		accountInsertErr,
	)
	profile := externalUserProfile{
		ExternalUserID: "personal-workspace-account-failure-external-user",
		Email:          "personal-workspace-account-failure@example.com",
		Name:           "Rolled Back Account User",
		Raw:            json.RawMessage(`{"sub":"personal-workspace-account-failure-external-user"}`),
	}

	_, err := (&Server{db: db}).findOrCreateThirdPartyUser(provider, profile)
	if !errors.Is(err, accountInsertErr) {
		t.Fatalf("find or create third-party user error = %v, want %v", err, accountInsertErr)
	}

	requireRowCount(t, db, &store.User{}, 0, "email = ?", profile.Email)
	requireRowCount(t, db.Unscoped(), &store.Project{}, projectCountBefore, "1 = 1")
	requireRowCount(
		t,
		db,
		&store.ThirdPartyAccount{},
		0,
		"provider_id = ? AND external_user_id = ?",
		provider.ID,
		profile.ExternalUserID,
	)
}

func TestAdminUserCreationTreatsPersonalWorkspaceUniqueFailureAsInternalError(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	adminCookie := loginAsAdmin(t, server)
	failCreatesForTable(
		t,
		db,
		"test:fail_personal_workspace_unique_create",
		"projects",
		errors.New("UNIQUE constraint failed: projects.owner_user_id"),
	)

	const email = "personal-workspace-unique-failure@example.com"
	resp, body := postJSON(t, server, "/api/admin/users", map[string]any{
		"email": email,
		"name":  "Unique Project Failure User",
	}, adminCookie)
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500, body = %#v", resp.StatusCode, body)
	}
	requireError(t, body, "internal_error")

	requireRowCount(t, db, &store.User{}, 0, "email = ?", email)
	requireRowCount(t, db.Unscoped(), &store.Project{}, 0, "1 = 1")
}

func TestFirstTimeThirdPartyUserCreationRollsBackWhenPersonalWorkspaceInsertFails(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	provider := insertTestThirdPartyLoginProvider(t, db, store.ThirdPartyLoginProvider{
		Name:    "Personal Workspace Rollback SSO",
		Key:     "personal-workspace-rollback-sso",
		Enabled: true,
	})
	failPersonalWorkspaceCreates(t, db)

	profile := externalUserProfile{
		ExternalUserID: "personal-workspace-rollback-external-user",
		Email:          "personal-workspace-third-party-rollback@example.com",
		Name:           "Rolled Back Third Party User",
		Raw:            json.RawMessage(`{"sub":"personal-workspace-rollback-external-user"}`),
	}
	_, err := (&Server{db: db}).findOrCreateThirdPartyUser(provider, profile)
	if err == nil {
		t.Fatal("find or create third-party user error = nil, want project insertion failure")
	}

	requireRowCount(t, db, &store.User{}, 0, "email = ?", profile.Email)
	requireRowCount(
		t,
		db,
		&store.ThirdPartyAccount{},
		0,
		"provider_id = ? AND external_user_id = ?",
		provider.ID,
		profile.ExternalUserID,
	)
	requireRowCount(t, db.Unscoped(), &store.Project{}, 0, "1 = 1")
}

func requirePersonalWorkspace(t *testing.T, db *gorm.DB, user store.User) store.Project {
	t.Helper()

	var projects []store.Project
	if err := db.Unscoped().Where("owner_user_id = ?", user.ID).Find(&projects).Error; err != nil {
		t.Fatalf("find personal workspace: %v", err)
	}
	if len(projects) != 1 {
		t.Fatalf("project count for user %q = %d, want 1", user.ID, len(projects))
	}

	project := projects[0]
	if _, err := uuid.Parse(project.ID); err != nil {
		t.Fatalf("project ID = %q, want UUID: %v", project.ID, err)
	}
	if project.Name != "个人工作区" {
		t.Fatalf("project name = %q, want 个人工作区", project.Name)
	}
	if project.Description != "" {
		t.Fatalf("project description = %q, want empty", project.Description)
	}
	if project.Avatar != "" {
		t.Fatalf("project avatar = %q, want empty", project.Avatar)
	}
	if project.OwnerUserID != user.ID {
		t.Fatalf("project owner user ID = %q, want %q", project.OwnerUserID, user.ID)
	}
	if project.CreatedByUserID != user.ID {
		t.Fatalf("project created-by user ID = %q, want %q", project.CreatedByUserID, user.ID)
	}
	if !project.IsPersonal {
		t.Fatal("project is_personal = false, want true")
	}
	if project.CreatedAt.IsZero() {
		t.Fatal("project created_at is zero")
	}
	if !project.CreatedAt.Equal(project.UpdatedAt) {
		t.Fatalf("project timestamps differ: created_at = %v, updated_at = %v", project.CreatedAt, project.UpdatedAt)
	}

	return project
}

func failPersonalWorkspaceCreates(t *testing.T, db *gorm.DB) {
	t.Helper()

	failCreatesForTable(
		t,
		db,
		"test:fail_personal_workspace_create",
		"projects",
		errors.New("forced personal workspace insertion failure"),
	)
}

func failCreatesForTable(t *testing.T, db *gorm.DB, callbackName string, table string, createErr error) {
	t.Helper()

	if err := db.Callback().Create().Before("gorm:create").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table == table {
			tx.AddError(createErr)
		}
	}); err != nil {
		t.Fatalf("register %s create callback: %v", table, err)
	}
	t.Cleanup(func() {
		if err := db.Callback().Create().Remove(callbackName); err != nil {
			t.Errorf("remove %s create callback: %v", table, err)
		}
	})
}

func requireRowCount(t *testing.T, db *gorm.DB, model any, want int64, query string, args ...any) {
	t.Helper()

	var count int64
	if err := db.Model(model).Where(query, args...).Count(&count).Error; err != nil {
		t.Fatalf("count %T rows: %v", model, err)
	}
	if count != want {
		t.Fatalf("%T row count = %d, want %d", model, count, want)
	}
}
