package admin

import (
	"encoding/base64"
	"fmt"
	"testing"
	"time"

	"push-gateway/internal/model"
	"push-gateway/internal/secure"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"
	"gorm.io/gorm"
)

func TestPlaintextAdminPasswordIsHashedAtStartup(t *testing.T) {
	db := newAdminDependencies(t)
	service, err := New(Options{
		DB: db, Username: "admin", Password: "admin",
	})
	if err != nil {
		t.Fatalf("create service: %v", err)
	}
	if service.passwordHash == "" || service.passwordHash == "admin" {
		t.Fatal("plaintext password was retained instead of hashing")
	}
	if _, err := service.Login(t.Context(), "admin", "admin", "203.0.113.1"); err != nil {
		t.Fatalf("login with plaintext configuration: %v", err)
	}
}

func TestListServersReturnsEmptySlice(t *testing.T) {
	service, _ := newTestAdmin(t)
	servers, err := service.ListServers(t.Context())
	if err != nil {
		t.Fatalf("list servers: %v", err)
	}
	if servers == nil || len(servers) != 0 {
		t.Fatalf("servers = %#v, want non-nil empty slice", servers)
	}
}

func TestAdminSessionAndServerLifecycle(t *testing.T) {
	service, db := newTestAdmin(t)
	credential, err := service.Login(t.Context(), "operator", "correct password", "203.0.113.1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	session, err := service.Authenticate(t.Context(), credential.SessionToken)
	if err != nil || service.VerifyCSRF(session, credential.CSRFToken) != nil {
		t.Fatalf("session authentication: session=%#v err=%v", session, err)
	}
	if _, err := service.Login(t.Context(), "operator", "wrong", "203.0.113.2"); failureCode(err) != "invalid_credentials" {
		t.Fatalf("wrong password error = %v", err)
	}

	issued, err := service.CreateServer(t.Context(), " 生产环境一号 ", 100_000, "request-create")
	if err != nil || issued.Server.Name != "生产环境一号" || issued.Key == "" {
		t.Fatalf("created = %#v, err = %v", issued, err)
	}
	if !secure.ValidServerKey(issued.Key) {
		t.Fatal("issued key is invalid")
	}
	revealed, err := service.RevealServerKey(t.Context(), issued.Server.ID, "request-reveal")
	if err != nil || revealed != issued.Key {
		t.Fatalf("revealed key mismatch: %v", err)
	}
	rotated, err := service.RotateServerKey(t.Context(), issued.Server.ID, "request-rotate")
	if err != nil || rotated.Key == issued.Key {
		t.Fatalf("rotated = %#v, err = %v", rotated, err)
	}
	var storedServer model.Server
	if err := db.First(&storedServer, "id = ?", issued.Server.ID).Error; err != nil {
		t.Fatalf("load rotated server: %v", err)
	}
	if storedServer.ServerKey != rotated.Key || storedServer.ServerKey == issued.Key {
		t.Fatalf("stored server key was not replaced")
	}
	disabled, err := service.SetServerStatus(t.Context(), issued.Server.ID, model.ServerStatusDisabled, "request-disable")
	if err != nil || disabled.Status != model.ServerStatusDisabled {
		t.Fatalf("disabled = %#v, err = %v", disabled, err)
	}
	updated, err := service.UpdateServer(t.Context(), issued.Server.ID, "生产环境", 200_000, "request-update")
	if err != nil || updated.DailyQuota != 200_000 || updated.Revision <= issued.Server.Revision {
		t.Fatalf("updated = %#v, err = %v", updated, err)
	}
	servers, err := service.ListServers(t.Context())
	if err != nil || len(servers) != 1 || servers[0].ID != issued.Server.ID {
		t.Fatalf("servers = %#v, err = %v", servers, err)
	}
	var auditCount int64
	if err := db.Model(&model.AdminAuditEvent{}).Count(&auditCount).Error; err != nil || auditCount != 5 {
		t.Fatalf("audit count = %d, err = %v", auditCount, err)
	}
	if err := service.Logout(t.Context(), credential.SessionToken); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if _, err := service.Authenticate(t.Context(), credential.SessionToken); failureCode(err) != "admin_unauthorized" {
		t.Fatalf("logged out session error = %v", err)
	}
}

func newTestAdmin(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db := newAdminDependencies(t)
	service, err := New(Options{
		DB: db, Username: "operator", PasswordHash: testPasswordHash("correct password"),
		Now: func() time.Time { return time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatalf("create service: %v", err)
	}
	return service, db
}

func newAdminDependencies(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(
		&model.RateLimit{}, &model.Installation{}, &model.Grant{}, &model.Server{},
		&model.ServerDailyUsage{}, &model.AdminSession{}, &model.AdminAuditEvent{}, &model.Job{},
	); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	return db
}

func testPasswordHash(password string) string {
	salt := []byte("0123456789abcdef")
	encoded := argon2.IDKey([]byte(password), salt, 1, 8*1024, 1, 32)
	return fmt.Sprintf("$argon2id$v=19$m=8192,t=1,p=1$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(encoded))
}

func failureCode(err error) string {
	if failure, ok := FailureOf(err); ok {
		return failure.Code
	}
	return ""
}
