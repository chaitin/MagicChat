package userblock

import (
	"context"
	"testing"
	"time"

	"app/internal/store"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestBlockIsDirectionalAndIdempotent(t *testing.T) {
	db := newUserBlockTestDB(t)
	first := createUserBlockTestUser(t, db, "first")
	second := createUserBlockTestUser(t, db, "second")
	now := time.Date(2026, 9, 7, 8, 0, 0, 0, time.UTC)
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})

	created, err := service.Block(context.Background(), Command{AccountID: first.ID, UserID: second.ID})
	if err != nil {
		t.Fatalf("block user: %v", err)
	}
	if !created.Blocked || created.BlockedAt == nil || !created.BlockedAt.Equal(now) {
		t.Fatalf("unexpected block status: %#v", created)
	}

	secondNow := now.Add(time.Hour)
	service.now = func() time.Time { return secondNow }
	repeated, err := service.Block(context.Background(), Command{AccountID: first.ID, UserID: second.ID})
	if err != nil {
		t.Fatalf("repeat block: %v", err)
	}
	if repeated.BlockedAt == nil || !repeated.BlockedAt.Equal(now) {
		t.Fatalf("repeat changed creation time: %#v", repeated)
	}

	reverse, err := service.GetStatus(context.Background(), Command{AccountID: second.ID, UserID: first.ID})
	if err != nil || reverse.Blocked {
		t.Fatalf("reverse status = %#v, err = %v", reverse, err)
	}

	if err := service.Unblock(context.Background(), Command{AccountID: first.ID, UserID: second.ID}); err != nil {
		t.Fatalf("unblock user: %v", err)
	}
	if err := service.Unblock(context.Background(), Command{AccountID: first.ID, UserID: second.ID}); err != nil {
		t.Fatalf("repeat unblock: %v", err)
	}
	status, err := service.GetStatus(context.Background(), Command{AccountID: first.ID, UserID: second.ID})
	if err != nil || status.Blocked {
		t.Fatalf("status after unblock = %#v, err = %v", status, err)
	}
}

func TestBlockRejectsSelfAndMissingUser(t *testing.T) {
	db := newUserBlockTestDB(t)
	user := createUserBlockTestUser(t, db, "self")
	service := NewService(Dependencies{DB: db})

	_, err := service.Block(context.Background(), Command{AccountID: user.ID, UserID: user.ID})
	if ErrorCodeOf(err) != CodeInvalidRequest {
		t.Fatalf("self block error = %v", err)
	}
	_, err = service.Block(context.Background(), Command{AccountID: user.ID, UserID: uuid.NewString()})
	if ErrorCodeOf(err) != CodeNotFound {
		t.Fatalf("missing user error = %v", err)
	}
}

func newUserBlockTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&store.User{}, &store.UserBlock{}, &store.Conversation{}, &store.DirectConversation{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	return db
}

func createUserBlockTestUser(t *testing.T, db *gorm.DB, prefix string) store.User {
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
