package account

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
)

func TestCachedProfileAppliesCurrentNicknamePolicyAcrossServices(t *testing.T) {
	now := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	service, session := newSessionActivityTestService(t, now)
	db := service.db
	if err := db.Create(&store.AppSettings{
		ID: store.AppSettingsID, AllowUserNicknameEditing: true, CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&store.User{}).Where("id = ?", session.UserID).Update("nickname", "Custom nickname").Error; err != nil {
		t.Fatal(err)
	}
	if err := store.InstallUserNicknamePolicy(db); err != nil {
		t.Fatal(err)
	}
	other := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	profileReads := 0
	if err := db.Callback().Query().Before("gorm:query").Register("test:policy_profile_reads", func(db *gorm.DB) {
		if db.Statement.Table == "users" {
			profileReads++
		}
	}); err != nil {
		t.Fatal(err)
	}

	// Change settings directly to model another instance, without a local
	// invalidation notification or a change to users.updated_at. Warm the
	// cache with nicknames disabled first, then exercise both transitions.
	for _, allow := range []bool{false, true, false} {
		if err := db.Model(&store.AppSettings{}).Where("id = ?", store.AppSettingsID).
			Update("allow_user_nickname_editing", allow).Error; err != nil {
			t.Fatal(err)
		}
		want := "Alice"
		if allow {
			want = "Custom nickname"
		}
		for _, current := range []*Service{service, other} {
			authenticated, err := current.AuthenticateSession(t.Context(), activityTestToken)
			if err != nil || authenticated.Account.Nickname != want {
				t.Fatalf("authenticate with allow=%v: nickname=%q want=%q error=%v", allow, authenticated.Account.Nickname, want, err)
			}
			profile, err := current.GetProfile(t.Context(), session.UserID)
			if err != nil || profile.Nickname != want {
				t.Fatalf("get profile with allow=%v: nickname=%q want=%q error=%v", allow, profile.Nickname, want, err)
			}
			cached, hit, _ := current.profiles.get(session.UserID, now, nil)
			if !hit || cached.Nickname != "Custom nickname" {
				t.Fatalf("cache must retain stored nickname: hit=%v nickname=%q", hit, cached.Nickname)
			}
		}
		if profileReads != 2 {
			t.Fatalf("profile reads = %d, want one per service despite policy changes", profileReads)
		}
	}
}

func TestCanceledProfileLoadDoesNotWaitForAnotherRequest(t *testing.T) {
	now := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	service, session := newSessionActivityTestService(t, now)
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	started := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	var reads atomic.Int32
	if err := service.db.Callback().Query().Before("gorm:query").Register("test:block_profile_read", func(db *gorm.DB) {
		if db.Statement.Table != "users" || reads.Add(1) != 1 {
			return
		}
		close(started)
		select {
		case <-release:
		case <-ctx.Done():
			db.AddError(ctx.Err())
		}
	}); err != nil {
		t.Fatal(err)
	}
	leader := make(chan error, 1)
	go func() {
		_, err := service.GetProfile(ctx, session.UserID)
		leader <- err
	}()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("first lookup did not start")
	}

	waitCtx, stopWaiting := context.WithTimeout(ctx, 20*time.Millisecond)
	defer stopWaiting()
	follower := make(chan error, 1)
	go func() {
		_, err := service.GetProfile(waitCtx, session.UserID)
		follower <- err
	}()
	select {
	case err := <-follower:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Errorf("waiting lookup error = %v, want deadline exceeded", err)
		}
	case <-time.After(time.Second):
		t.Error("expired lookup remained blocked behind another request")
		unblock()
		<-follower
	}
	// Canceling the follower must not cancel or release the leader's load.
	select {
	case err := <-leader:
		t.Fatalf("first lookup ended before release: %v", err)
	default:
	}
	unblock()
	if err := <-leader; err != nil {
		t.Fatalf("first lookup: %v", err)
	}
	if _, err := service.GetProfile(ctx, session.UserID); err != nil {
		t.Fatalf("lookup after canceled wait: %v", err)
	}
	if reads.Load() != 1 {
		t.Fatalf("full profile reads = %d, want 1", reads.Load())
	}
}

func TestProfileLoadLockRejectsCanceledContextEvenWhenAvailable(t *testing.T) {
	var lock profileLoadLock
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	for range 64 {
		if err := lock.lock(canceled); !errors.Is(err, context.Canceled) {
			t.Fatalf("lock with canceled context: %v", err)
		}
		ctx, stop := context.WithTimeout(t.Context(), time.Second)
		err := lock.lock(ctx)
		stop()
		if err != nil {
			t.Fatalf("canceled acquisition leaked the lock: %v", err)
		}
		lock.unlock()
	}
}
