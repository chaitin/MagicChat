package account

import (
	"testing"
	"time"

	"app/internal/auth"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestPostgresCachedProfileUsesLiveNicknamePolicy(t *testing.T) {
	db := openAccountPostgresTestDB(t)
	if err := db.AutoMigrate(&store.User{}, &store.UserSession{}, &store.AppSettings{}); err != nil {
		t.Fatal(err)
	}
	if err := store.InstallUserNicknamePolicy(db); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	user := store.User{
		ID: uuid.NewString(), Email: "policy-cache@example.com", Name: "Real name", Nickname: "Nickname",
		Status: store.UserStatusActive, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&store.UserSession{
		ID: uuid.NewString(), UserID: user.ID, TokenHash: auth.HashSessionToken(activityTestToken),
		ExpiresAt: now.Add(time.Hour), CreatedAt: now, LastSeenAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	reads := 0
	if err := db.Callback().Query().Before("gorm:query").Register("test:postgres_profile_reads", func(db *gorm.DB) {
		if db.Statement.Table == "users" {
			reads++
		}
	}); err != nil {
		t.Fatal(err)
	}
	// No settings row must preserve the same default as the store hook.
	result, err := service.AuthenticateSession(t.Context(), activityTestToken)
	if err != nil || result.Account.Nickname != user.Nickname || result.Account.Phone != "" || result.Account.Avatar != store.DefaultUserAvatar {
		t.Fatalf("profile without settings = %+v, error=%v", result, err)
	}
	if err := db.Create(&store.AppSettings{ID: store.AppSettingsID, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	for _, allow := range []bool{false, true} {
		if err := db.Model(&store.AppSettings{}).Where("id = ?", store.AppSettingsID).
			Update("allow_user_nickname_editing", allow).Error; err != nil {
			t.Fatal(err)
		}
		want := user.Name
		if allow {
			want = user.Nickname
		}
		result, err := service.AuthenticateSession(t.Context(), activityTestToken)
		if err != nil || result.Account.Nickname != want {
			t.Fatalf("allow=%v: authenticated nickname=%q want=%q error=%v", allow, result.Account.Nickname, want, err)
		}
		profile, err := service.GetProfile(t.Context(), user.ID)
		if err != nil || profile.Nickname != want {
			t.Fatalf("allow=%v: profile nickname=%q want=%q error=%v", allow, profile.Nickname, want, err)
		}
	}
	if reads != 1 {
		t.Fatalf("full profile reads = %d, want 1", reads)
	}
}
