package directmessagepolicy

import (
	"errors"
	"testing"
	"time"

	"app/internal/store"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestRequireRejectsOnlySenderBlockedByRecipient(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&store.User{}, &store.UserBlock{}, &store.UserFriendship{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	first := createPolicyTestUser(t, db, "first")
	second := createPolicyTestUser(t, db, "second")
	if err := db.Create(&store.UserBlock{
		BlockerUserID: first.ID, BlockedUserID: second.ID, CreatedAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatalf("create block: %v", err)
	}
	policy := New(nil)

	if err := policy.Require(db, second.ID, first.ID); !errors.Is(err, ErrRecipientUnavailable) {
		t.Fatalf("blocked sender error = %v", err)
	}
	if err := policy.Require(db, first.ID, second.ID); err != nil {
		t.Fatalf("blocker should still send: %v", err)
	}
}

func createPolicyTestUser(t *testing.T, db *gorm.DB, prefix string) store.User {
	t.Helper()
	now := time.Now().UTC()
	value := store.User{
		ID: uuid.NewString(), Email: prefix + "@example.com", Name: prefix,
		PasswordHash: "hash", Status: store.UserStatusActive, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&value).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return value
}
