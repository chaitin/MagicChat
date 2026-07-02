package store

import (
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := "file:" + uuid.NewString() + "?mode=memory&cache=shared"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite db: %v", err)
	}
	if err := AutoMigrate(db); err != nil {
		t.Fatalf("AutoMigrate() error = %v", err)
	}

	return db
}

func TestAutoMigrateCreatesAuthTables(t *testing.T) {
	db := openTestDB(t)
	now := time.Now().UTC()

	user := User{
		ID:           uuid.NewString(),
		Avatar:       DefaultUserAvatar,
		Email:        "wenlei@example.com",
		Name:         "Wenlei Zhu",
		Nickname:     "",
		PasswordHash: "hash",
		Status:       UserStatusActive,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	adminSession := AdminSession{
		ID:         uuid.NewString(),
		TokenHash:  "admin-token-hash",
		ExpiresAt:  now.Add(7 * 24 * time.Hour),
		LastSeenAt: now,
	}
	if err := db.Create(&adminSession).Error; err != nil {
		t.Fatalf("create admin session: %v", err)
	}

	userSession := UserSession{
		ID:         uuid.NewString(),
		TokenHash:  "user-token-hash",
		UserID:     user.ID,
		ExpiresAt:  now.Add(7 * 24 * time.Hour),
		LastSeenAt: now,
	}
	if err := db.Create(&userSession).Error; err != nil {
		t.Fatalf("create user session: %v", err)
	}
}

func TestUserEmailIsUnique(t *testing.T) {
	db := openTestDB(t)

	first := User{
		ID:           uuid.NewString(),
		Avatar:       DefaultUserAvatar,
		Email:        "wenlei@example.com",
		Name:         "Wenlei Zhu",
		Nickname:     "",
		PasswordHash: "hash",
		Status:       UserStatusActive,
	}
	if err := db.Create(&first).Error; err != nil {
		t.Fatalf("create first user: %v", err)
	}

	second := User{
		ID:           uuid.NewString(),
		Avatar:       DefaultUserAvatar,
		Email:        "wenlei@example.com",
		Name:         "Another User",
		Nickname:     "",
		PasswordHash: "hash",
		Status:       UserStatusActive,
	}
	if err := db.Create(&second).Error; err == nil {
		t.Fatal("create duplicate email user error = nil, want unique constraint error")
	}
}
