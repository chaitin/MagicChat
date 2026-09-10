package account

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"strings"
	"testing"
	"time"

	fileapp "app/internal/application/file"
	"app/internal/auth"
	"app/internal/store"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestServiceLoginAuthenticateAndLogout(t *testing.T) {
	db := openAccountTestDB(t)
	now := time.Date(2026, 7, 15, 4, 0, 0, 0, time.UTC)
	user := insertAccountTestUser(t, db, "alice@example.com", "test-password", now)
	service := NewService(Dependencies{
		DB:                   db,
		Now:                  func() time.Time { return now },
		GenerateSessionToken: func() (string, error) { return "session-token", nil },
	})

	result, err := service.Login(context.Background(), LoginCommand{
		Email:     " Alice@Example.com ",
		Password:  "test-password",
		UserAgent: "account-test",
		IP:        "127.0.0.1",
	})
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if result.Account.ID != user.ID || result.Session.Token != "session-token" {
		t.Fatalf("login result = %#v", result)
	}
	if want := now.Add(defaultSessionTTL); !result.Session.ExpiresAt.Equal(want) {
		t.Fatalf("expires at = %v, want %v", result.Session.ExpiresAt, want)
	}

	var storedSession store.UserSession
	if err := db.First(&storedSession, "user_id = ?", user.ID).Error; err != nil {
		t.Fatalf("load session: %v", err)
	}
	if storedSession.TokenHash != auth.HashSessionToken("session-token") {
		t.Fatalf("stored token hash = %q", storedSession.TokenHash)
	}

	authenticated, err := service.AuthenticateSession(context.Background(), "session-token")
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	if authenticated.ID != storedSession.ID || authenticated.Account.ID != user.ID {
		t.Fatalf("authenticated session = %#v", authenticated)
	}
	installationID := uuid.NewString()
	if err := db.Create(&store.UserPushGrant{
		ID: uuid.NewString(), UserID: user.ID, SessionID: storedSession.ID, InstallationID: installationID,
		GatewayGrantID: uuid.NewString(), SendTokenCiphertext: []byte("encrypted"),
		Platform: "ios", ExpiresAt: now.Add(time.Hour), Status: "active",
		LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatalf("create push grant: %v", err)
	}

	if err := service.Logout(context.Background(), LogoutCommand{
		Token: "session-token", InstallationID: installationID,
	}); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if _, err := service.AuthenticateSession(context.Background(), "session-token"); ErrorCodeOf(err) != CodeUnauthorized {
		t.Fatalf("authenticate after logout error = %v, code = %q", err, ErrorCodeOf(err))
	}
	var grantCount int64
	if err := db.Model(&store.UserPushGrant{}).Where("installation_id = ?", installationID).Count(&grantCount).Error; err != nil {
		t.Fatalf("count push grants after logout: %v", err)
	}
	if grantCount != 0 {
		t.Fatalf("push grants after logout = %d, want 0", grantCount)
	}
}

func TestDelayedOldSessionLogoutDoesNotDeleteReplacementGrant(t *testing.T) {
	db := openAccountTestDB(t)
	now := time.Date(2026, 7, 15, 4, 0, 0, 0, time.UTC)
	user := insertAccountTestUser(t, db, "push-session-generation@example.com", "test-password", now)
	oldSession := store.UserSession{
		ID: uuid.NewString(), TokenHash: auth.HashSessionToken("old-session-token"), UserID: user.ID,
		ExpiresAt: now.Add(time.Hour), CreatedAt: now, LastSeenAt: now,
	}
	newSession := store.UserSession{
		ID: uuid.NewString(), TokenHash: auth.HashSessionToken("new-session-token"), UserID: user.ID,
		ExpiresAt: now.Add(time.Hour), CreatedAt: now.Add(time.Second), LastSeenAt: now.Add(time.Second),
	}
	if err := db.Create(&[]store.UserSession{oldSession, newSession}).Error; err != nil {
		t.Fatalf("create sessions: %v", err)
	}
	installationID := uuid.NewString()
	grant := store.UserPushGrant{
		ID: uuid.NewString(), UserID: user.ID, SessionID: newSession.ID,
		InstallationID: installationID, GatewayGrantID: uuid.NewString(),
		SendTokenCiphertext: []byte("encrypted"), Platform: "ios",
		ExpiresAt: now.Add(time.Hour), Status: "active", LastSeenAt: now,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&grant).Error; err != nil {
		t.Fatalf("create replacement grant: %v", err)
	}
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	if err := service.Logout(t.Context(), LogoutCommand{
		Token: "old-session-token", InstallationID: installationID,
	}); err != nil {
		t.Fatalf("logout old session: %v", err)
	}
	var grantCount int64
	if err := db.Model(&store.UserPushGrant{}).Where("id = ?", grant.ID).Count(&grantCount).Error; err != nil || grantCount != 1 {
		t.Fatalf("replacement grant count = %d, err = %v", grantCount, err)
	}
}

func TestServiceLoginDoesNotRevealDisabledOrMissingAccount(t *testing.T) {
	db := openAccountTestDB(t)
	now := time.Date(2026, 7, 15, 4, 0, 0, 0, time.UTC)
	user := insertAccountTestUser(t, db, "disabled@example.com", "test-password", now)
	if err := db.Model(&user).Update("status", store.UserStatusDisabled).Error; err != nil {
		t.Fatalf("disable user: %v", err)
	}
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})

	for _, email := range []string{"disabled@example.com", "missing@example.com", "not-an-email"} {
		_, err := service.Login(context.Background(), LoginCommand{Email: email, Password: "test-password"})
		if ErrorCodeOf(err) != CodeInvalidCredentials || ErrorMessage(err) != "邮箱或密码错误" {
			t.Fatalf("login %q error = %v, code = %q", email, err, ErrorCodeOf(err))
		}
	}
}

func TestServiceRejectsPasswordLoginWhenDisabled(t *testing.T) {
	policy := &fakePasswordLoginPolicy{enabled: false}
	service := NewService(Dependencies{
		DB: openAccountTestDB(t), PasswordLoginPolicy: policy,
	})

	_, err := service.Login(context.Background(), LoginCommand{
		Email: "alice@example.com", Password: "test-password",
	})
	if ErrorCodeOf(err) != CodeLoginUnavailable || ErrorMessage(err) != "密码登录未启用" {
		t.Fatalf("login error = %v, code = %q", err, ErrorCodeOf(err))
	}
	if policy.calls != 1 {
		t.Fatalf("password login policy calls = %d", policy.calls)
	}
}

func TestServiceVerifiedEmailLoginCreatesMissingAccountAndPersonalWorkspace(t *testing.T) {
	db := openAccountTestDB(t)
	now := time.Date(2026, 7, 15, 4, 0, 0, 0, time.UTC)
	service := NewService(Dependencies{
		DB: db, Now: func() time.Time { return now },
		GenerateSessionToken: func() (string, error) { return "new-user-session-token", nil },
		RandomAvatar:         func() string { return "/assets/avatars/builtin/07.webp" },
	})

	allowed, err := service.CanLoginWithEmail(context.Background(), " New.User@Example.com ", true)
	if err != nil || !allowed {
		t.Fatalf("missing email allowed = %t, error = %v", allowed, err)
	}
	result, err := service.LoginWithVerifiedEmail(context.Background(), VerifiedEmailLoginCommand{
		Email: "New.User@Example.com", UserAgent: "verified-email-test", IP: "127.0.0.1", AllowRegistration: true,
	})
	if err != nil {
		t.Fatalf("verified registration: %v", err)
	}
	if result.Account.Email != "new.user@example.com" || result.Account.Name != "new.user" || result.Session.Token != "new-user-session-token" {
		t.Fatalf("verified registration result = %#v", result)
	}
	if result.Account.Status != store.UserStatusActive || result.Account.Avatar != "/assets/avatars/builtin/07.webp" {
		t.Fatalf("registered account = %#v", result.Account)
	}
	var project store.Project
	if err := db.Where("owner_user_id = ? AND is_personal = ?", result.Account.ID, true).First(&project).Error; err != nil {
		t.Fatalf("load personal workspace: %v", err)
	}
}

func TestServiceIssuesSessionOnlyForVerifiedActiveEmail(t *testing.T) {
	db := openAccountTestDB(t)
	now := time.Date(2026, 7, 15, 4, 0, 0, 0, time.UTC)
	user := insertAccountTestUser(t, db, "alice@example.com", "test-password", now)
	service := NewService(Dependencies{
		DB:                   db,
		Now:                  func() time.Time { return now },
		GenerateSessionToken: func() (string, error) { return "verified-session-token", nil },
	})

	allowed, err := service.CanLoginWithEmail(context.Background(), " Alice@Example.com ", true)
	if err != nil || !allowed {
		t.Fatalf("active email allowed = %t, error = %v", allowed, err)
	}
	result, err := service.LoginWithVerifiedEmail(context.Background(), VerifiedEmailLoginCommand{
		Email: "Alice@example.com", UserAgent: "verified-email-test", IP: "127.0.0.1",
	})
	if err != nil {
		t.Fatalf("verified login: %v", err)
	}
	if result.Account.ID != user.ID || result.Session.Token != "verified-session-token" {
		t.Fatalf("verified login result = %#v", result)
	}

	if err := db.Model(&user).Update("status", store.UserStatusDisabled).Error; err != nil {
		t.Fatalf("disable user: %v", err)
	}
	allowed, err = service.CanLoginWithEmail(context.Background(), user.Email, true)
	if err != nil || allowed {
		t.Fatalf("disabled email allowed = %t, error = %v", allowed, err)
	}
	if _, err := service.LoginWithVerifiedEmail(context.Background(), VerifiedEmailLoginCommand{Email: user.Email}); ErrorCodeOf(err) != CodeInvalidCredentials {
		t.Fatalf("disabled verified login error = %v", err)
	}
}

func TestServiceUpdatesProfileAndOnlineActivity(t *testing.T) {
	db := openAccountTestDB(t)
	now := time.Date(2026, 7, 15, 4, 0, 0, 0, time.UTC)
	user := insertAccountTestUser(t, db, "alice@example.com", "test-password", now)
	notifications := &accountProfileNotificationRecorder{}
	service := NewService(Dependencies{DB: db, ProfileNotifications: notifications})
	nickname := " Alice A "
	avatar := "/assets/avatars/builtin/03.webp"

	updated, err := service.UpdateProfile(context.Background(), UpdateProfileCommand{
		AccountID: user.ID,
		Avatar:    &avatar,
		Nickname:  &nickname,
	})
	if err != nil {
		t.Fatalf("update profile: %v", err)
	}
	if updated.Avatar != avatar || updated.Nickname != "Alice A" {
		t.Fatalf("updated account = %#v", updated)
	}
	if notifications.userID != user.ID || !notifications.updatedAt.Equal(updated.UpdatedAt) {
		t.Fatalf("profile notification = %#v", notifications)
	}

	activityAt := now.Add(time.Hour)
	if err := service.RecordOnlineActivity(context.Background(), user.ID, activityAt); err != nil {
		t.Fatalf("record activity: %v", err)
	}
	profile, err := service.GetProfile(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("get profile: %v", err)
	}
	if profile.LastOnlineAt == nil || !profile.LastOnlineAt.Equal(activityAt) {
		t.Fatalf("last online at = %v, want %v", profile.LastOnlineAt, activityAt)
	}

	invalidAvatar := "https://example.com/avatar.webp"
	if _, err := service.UpdateProfile(context.Background(), UpdateProfileCommand{AccountID: user.ID, Avatar: &invalidAvatar}); ErrorCodeOf(err) != CodeInvalidRequest {
		t.Fatalf("invalid avatar error = %v, code = %q", err, ErrorCodeOf(err))
	}
}

func TestServiceRejectsNicknameUpdateWhenServerDisablesIt(t *testing.T) {
	db := openAccountTestDB(t)
	now := time.Date(2026, 7, 15, 4, 0, 0, 0, time.UTC)
	user := insertAccountTestUser(t, db, "nickname-disabled@example.com", "test-password", now)
	service := NewService(Dependencies{DB: db, UserNicknamePolicy: fixedUserNicknamePolicy(false)})
	nickname := "New Nickname"

	_, err := service.UpdateProfile(context.Background(), UpdateProfileCommand{
		AccountID: user.ID,
		Nickname:  &nickname,
	})
	if ErrorCodeOf(err) != CodeNicknameDisabled || ErrorMessage(err) != "当前服务器禁止修改昵称" {
		t.Fatalf("update nickname error = %v, code = %q", err, ErrorCodeOf(err))
	}
}

type fixedUserNicknamePolicy bool

func (policy fixedUserNicknamePolicy) WithUserNicknameEditingPolicy(_ context.Context, operation func(*gorm.DB, bool) error) error {
	return operation(nil, bool(policy))
}

func TestServiceUploadsAvatarThroughStoragePort(t *testing.T) {
	db := openAccountTestDB(t)
	now := time.Date(2026, 7, 15, 4, 0, 0, 0, time.UTC)
	user := insertAccountTestUser(t, db, "alice@example.com", "test-password", now)
	storage := &recordingAvatarStorage{}
	service := NewService(Dependencies{DB: db, Files: storage})
	content := accountTestWebP(256, 256)

	updated, err := service.UploadAvatar(context.Background(), UploadAvatarCommand{
		AccountID: user.ID,
		Size:      int64(len(content)),
		Content:   bytes.NewReader(content),
	})
	if err != nil {
		t.Fatalf("upload avatar: %v", err)
	}
	if !strings.HasPrefix(storage.key, "avatars/users/"+user.ID+"/") || !strings.HasSuffix(storage.key, ".webp") {
		t.Fatalf("avatar key = %q", storage.key)
	}
	if !bytes.Equal(storage.content, content) || storage.contentType != avatarContentType {
		t.Fatalf("stored avatar = %#v, type = %q", storage.content, storage.contentType)
	}
	if updated.Avatar != storage.url {
		t.Fatalf("updated avatar = %q, want %q", updated.Avatar, storage.url)
	}

	wrongSize := accountTestWebP(128, 128)
	if _, err := service.UploadAvatar(context.Background(), UploadAvatarCommand{
		AccountID: user.ID,
		Size:      int64(len(wrongSize)),
		Content:   bytes.NewReader(wrongSize),
	}); ErrorCodeOf(err) != CodeInvalidRequest {
		t.Fatalf("wrong dimension error = %v, code = %q", err, ErrorCodeOf(err))
	}
}

type recordingAvatarStorage struct {
	key         string
	content     []byte
	contentType string
	url         string
}

type fakePasswordLoginPolicy struct {
	enabled bool
	calls   int
}

type accountProfileNotificationRecorder struct {
	updatedAt time.Time
	userID    string
}

func (r *accountProfileNotificationRecorder) PublishUserProfileUpdated(_ context.Context, userID string, updatedAt time.Time) {
	r.userID = userID
	r.updatedAt = updatedAt
}

func (p *fakePasswordLoginPolicy) PasswordLoginEnabled(context.Context) (bool, error) {
	p.calls++
	return p.enabled, nil
}

func (s *recordingAvatarStorage) UploadPublic(_ context.Context, cmd fileapp.UploadPublicCommand) (fileapp.PublicFile, error) {
	s.key = cmd.ObjectKey
	s.content, _ = io.ReadAll(cmd.Content)
	s.contentType = cmd.ContentType
	s.url = "https://assets.example.test/public/" + cmd.ObjectKey
	return fileapp.PublicFile{ObjectKey: cmd.ObjectKey, URL: s.url, ContentType: cmd.ContentType, SizeBytes: cmd.SizeBytes}, nil
}

func openAccountTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&store.User{}, &store.UserSession{}, &store.UserPushGrant{}, &store.Project{}, &store.AppSettings{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	return db
}

func insertAccountTestUser(t *testing.T, db *gorm.DB, email string, password string, now time.Time) store.User {
	t.Helper()
	passwordHash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	user := store.User{
		ID:           uuid.NewString(),
		Email:        email,
		Name:         "Alice",
		Avatar:       store.DefaultUserAvatar,
		PasswordHash: passwordHash,
		Status:       store.UserStatusActive,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return user
}

func accountTestWebP(width int, height int) []byte {
	content := make([]byte, 30)
	copy(content[0:4], "RIFF")
	binary.LittleEndian.PutUint32(content[4:8], uint32(len(content)-8))
	copy(content[8:12], "WEBP")
	copy(content[12:16], "VP8X")
	binary.LittleEndian.PutUint32(content[16:20], 10)
	w := width - 1
	h := height - 1
	content[24] = byte(w)
	content[25] = byte(w >> 8)
	content[26] = byte(w >> 16)
	content[27] = byte(h)
	content[28] = byte(h >> 8)
	content[29] = byte(h >> 16)
	return content
}
