package account

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"app/internal/auth"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const activityTestToken = "session-activity-test-token"

func TestAuthenticationBuffersActivityUntilFlush(t *testing.T) {
	initial := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	service, session := newSessionActivityTestService(t, initial)
	now := initial
	service.now = func() time.Time { return now }
	writes := 0
	if err := service.db.Callback().Update().Before("gorm:update").Register("test:count_activity_writes", func(db *gorm.DB) { writes++ }); err != nil {
		t.Fatal(err)
	}
	for _, elapsed := range []time.Duration{time.Second, 10 * time.Second, 59 * time.Second} {
		now = initial.Add(elapsed)
		if _, err := service.AuthenticateSession(t.Context(), activityTestToken); err != nil {
			t.Fatal(err)
		}
	}
	if writes != 0 {
		t.Fatalf("authentication performed %d writes", writes)
	}
	assertSessionLastSeen(t, service.db, session.ID, initial)
	if err := service.FlushActivity(t.Context()); err != nil {
		t.Fatal(err)
	}
	assertSessionLastSeen(t, service.db, session.ID, now)
	if writes != 1 {
		t.Fatalf("flush writes = %d, want 1", writes)
	}
	if err := service.FlushActivity(t.Context()); err != nil {
		t.Fatal(err)
	}
	if writes != 1 {
		t.Fatal("empty flush wrote to database")
	}
}

func TestActivityFlushBatchesAndNeverMovesTimeBackwards(t *testing.T) {
	initial := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	service, session := newSessionActivityTestService(t, initial)
	other := session
	other.ID, other.TokenHash = uuid.NewString(), auth.HashSessionToken("other-session")
	if err := service.db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	latest := initial.Add(time.Minute)
	var wg sync.WaitGroup
	for i := range 32 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			service.recordSessionActivity(session.ID, initial.Add(time.Duration(i)*time.Second))
		}()
	}
	wg.Wait()
	service.recordSessionActivity(session.ID, latest)
	service.recordSessionActivity(session.ID, initial)
	service.recordSessionActivity(other.ID, latest)
	if err := service.RecordOnlineActivity(t.Context(), session.UserID, latest); err != nil {
		t.Fatal(err)
	}
	profile, err := service.GetProfile(t.Context(), session.UserID)
	if err != nil || profile.LastOnlineAt == nil || !profile.LastOnlineAt.Equal(latest) {
		t.Fatalf("pending online time: %+v, %v", profile, err)
	}
	writes := 0
	if err := service.db.Callback().Update().Before("gorm:update").Register("test:count_batches", func(db *gorm.DB) { writes++ }); err != nil {
		t.Fatal(err)
	}
	if err := service.FlushActivity(t.Context()); err != nil {
		t.Fatal(err)
	}
	if writes != 2 {
		t.Fatalf("batch writes = %d, want 2 (sessions and users)", writes)
	}
	assertSessionLastSeen(t, service.db, session.ID, latest)
	assertSessionLastSeen(t, service.db, other.ID, latest)
	var user store.User
	if err := service.db.First(&user, "id = ?", session.UserID).Error; err != nil {
		t.Fatal(err)
	}
	if user.LastOnlineAt == nil || !user.LastOnlineAt.Equal(latest) {
		t.Fatal("online time not persisted")
	}
	if !user.UpdatedAt.Equal(initial) {
		t.Fatal("activity changed the profile version")
	}
	// A stale buffer on another instance must not overwrite newer timestamps.
	stale := NewService(Dependencies{DB: service.db})
	stale.recordSessionActivity(session.ID, initial.Add(time.Second))
	_ = stale.RecordOnlineActivity(t.Context(), session.UserID, initial.Add(time.Second))
	if err := stale.FlushActivity(t.Context()); err != nil {
		t.Fatal(err)
	}
	assertSessionLastSeen(t, service.db, session.ID, latest)
}

func TestActivityFlushRetainsFailuresAndConcurrentNewerUpdates(t *testing.T) {
	initial := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	service, session := newSessionActivityTestService(t, initial)
	first, latest := initial.Add(time.Second), initial.Add(2*time.Second)
	service.recordSessionActivity(session.ID, first)
	attempt := 0
	if err := service.db.Callback().Update().Before("gorm:update").Register("test:interleave_activity", func(db *gorm.DB) {
		attempt++
		if attempt == 1 {
			db.AddError(errors.New("write unavailable"))
		}
		if attempt == 2 {
			service.recordSessionActivity(session.ID, latest)
		}
	}); err != nil {
		t.Fatal(err)
	}
	if err := service.FlushActivity(t.Context()); err == nil {
		t.Fatal("want flush failure")
	}
	assertSessionLastSeen(t, service.db, session.ID, initial)
	if err := service.FlushActivity(t.Context()); err != nil {
		t.Fatal(err)
	}
	assertSessionLastSeen(t, service.db, session.ID, first)
	if err := service.FlushActivity(t.Context()); err != nil {
		t.Fatal(err)
	}
	assertSessionLastSeen(t, service.db, session.ID, latest)
}

func TestActivityShutdownFlushesAndDoesNotRecreateDeletedSessions(t *testing.T) {
	initial := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	service, session := newSessionActivityTestService(t, initial)
	service.recordSessionActivity(session.ID, initial.Add(time.Minute))
	if err := service.Logout(t.Context(), LogoutCommand{Token: activityTestToken}); err != nil {
		t.Fatal(err)
	}
	if err := service.CloseActivity(t.Context()); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := service.db.Model(&store.UserSession{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("sessions = %d, %v", count, err)
	}
	service.recordSessionActivity(session.ID, initial.Add(2*time.Minute))
	if len(service.activity.sessions) != 0 {
		t.Fatal("closed buffer accepted new activity")
	}
}

func TestActivityFlushSplitsLargeBatches(t *testing.T) {
	initial := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	service, session := newSessionActivityTestService(t, initial)
	sessions := make([]store.UserSession, activityBatchSize+1)
	for i := range sessions {
		sessions[i] = session
		sessions[i].ID, sessions[i].TokenHash = uuid.NewString(), fmt.Sprintf("batch-token-%d", i)
		service.recordSessionActivity(sessions[i].ID, initial.Add(time.Minute))
	}
	if err := service.db.CreateInBatches(sessions, 100).Error; err != nil {
		t.Fatal(err)
	}
	writes := 0
	if err := service.db.Callback().Update().Before("gorm:update").Register("test:batch_limit", func(db *gorm.DB) { writes++ }); err != nil {
		t.Fatal(err)
	}
	if err := service.FlushActivity(t.Context()); err != nil {
		t.Fatal(err)
	}
	if writes != 2 {
		t.Fatalf("writes = %d, want 2", writes)
	}
	assertSessionLastSeen(t, service.db, sessions[len(sessions)-1].ID, initial.Add(time.Minute))
}

func newSessionActivityTestService(t *testing.T, now time.Time) (*Service, store.UserSession) {
	t.Helper()
	db := openAccountTestDB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	user := insertAccountTestUser(t, db, "session-activity@example.com", "test-password", now)
	session := store.UserSession{ID: uuid.NewString(), TokenHash: auth.HashSessionToken(activityTestToken), UserID: user.ID, ExpiresAt: now.Add(time.Hour), CreatedAt: now, LastSeenAt: now}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	return NewService(Dependencies{DB: db, Now: func() time.Time { return now }}), session
}

func assertSessionLastSeen(t *testing.T, db *gorm.DB, sessionID string, want time.Time) {
	t.Helper()
	var session store.UserSession
	if err := db.First(&session, "id = ?", sessionID).Error; err != nil {
		t.Fatal(err)
	}
	if !session.LastSeenAt.Equal(want) {
		t.Fatalf("last_seen_at = %v, want %v", session.LastSeenAt, want)
	}
}

func TestActivityFlushKeepsCanceledBatch(t *testing.T) {
	initial := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	service, session := newSessionActivityTestService(t, initial)
	latest := initial.Add(time.Minute)
	service.recordSessionActivity(session.ID, latest)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := service.FlushActivity(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled flush: %v", err)
	}
	if err := service.CloseActivity(t.Context()); err != nil {
		t.Fatal(err)
	}
	assertSessionLastSeen(t, service.db, session.ID, latest)
}
