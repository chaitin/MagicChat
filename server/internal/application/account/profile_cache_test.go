package account

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
)

func TestProfileCacheCoalescesLoadsAndInvalidatesAfterUpdate(t *testing.T) {
	initial := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	service, session := newSessionActivityTestService(t, initial)
	now := initial
	service.now = func() time.Time { return now }
	var reads atomic.Int32
	if err := service.db.Callback().Query().Before("gorm:query").Register("test:profile_reads", func(db *gorm.DB) {
		if db.Statement.Table == "users" {
			reads.Add(1)
		}
	}); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if profile, err := service.GetProfile(t.Context(), session.UserID); err != nil || profile.ID != session.UserID {
				t.Errorf("profile = %+v, %v", profile, err)
			}
		}()
	}
	wg.Wait()
	if reads.Load() != 1 {
		t.Fatalf("profile reads = %d, want 1", reads.Load())
	}
	nickname := "Updated nickname"
	updated, err := service.UpdateProfile(t.Context(), UpdateProfileCommand{AccountID: session.UserID, Nickname: &nickname})
	if err != nil || updated.Nickname != nickname {
		t.Fatalf("update = %+v, %v", updated, err)
	}
	if reads.Load() != 2 {
		t.Fatalf("profile not reloaded after update: %d", reads.Load())
	}
	cached, err := service.GetProfile(t.Context(), session.UserID)
	if err != nil || cached.Nickname != nickname || reads.Load() != 2 {
		t.Fatalf("cached updated profile = %+v, %v", cached, err)
	}
	now = now.Add(profileCacheTTL)
	if _, err := service.GetProfile(t.Context(), session.UserID); err != nil {
		t.Fatal(err)
	}
	if reads.Load() != 3 {
		t.Fatal("expired profile did not reload")
	}
}

func TestAuthenticationUsesCachedProfileButChecksVersionAndRevocation(t *testing.T) {
	for _, change := range []string{"profile", "disabled", "logout", "expired"} {
		t.Run(change, func(t *testing.T) {
			initial := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
			service, session := newSessionActivityTestService(t, initial)
			reads := 0
			if err := service.db.Callback().Query().Before("gorm:query").Register("test:auth_profile_reads", func(db *gorm.DB) {
				if db.Statement.Table == "users" {
					reads++
				}
			}); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if _, err := service.AuthenticateSession(t.Context(), activityTestToken); err != nil {
					t.Fatal(err)
				}
			}
			if reads != 1 {
				t.Fatalf("full profile reads = %d, want 1", reads)
			}
			switch change {
			case "profile":
				// Simulate another service/process writing user data, bypassing
				// local invalidation. Authentication must notice the DB version.
				if err := service.db.Model(&store.User{}).Where("id = ?", session.UserID).Updates(map[string]any{"name": "New name", "updated_at": initial.Add(time.Second)}).Error; err != nil {
					t.Fatal(err)
				}
			case "disabled":
				if err := service.db.Model(&store.User{}).Where("id = ?", session.UserID).Update("status", store.UserStatusDisabled).Error; err != nil {
					t.Fatal(err)
				}
			case "logout":
				if err := service.Logout(t.Context(), LogoutCommand{Token: activityTestToken}); err != nil {
					t.Fatal(err)
				}
			case "expired":
				if err := service.db.Model(&store.UserSession{}).Where("id = ?", session.ID).UpdateColumn("expires_at", initial).Error; err != nil {
					t.Fatal(err)
				}
			}
			result, err := service.AuthenticateSession(t.Context(), activityTestToken)
			if change == "profile" {
				if err != nil || result.Account.Name != "New name" || reads != 2 {
					t.Fatalf("profile refresh: %+v, %v, reads=%d", result, err, reads)
				}
			} else if ErrorCodeOf(err) != CodeUnauthorized {
				t.Fatalf("authentication after %s: %v", change, err)
			}
		})
	}
}

func TestProfileCacheRejectsStaleFillAndBoundsMemory(t *testing.T) {
	service := NewService(Dependencies{})
	now := time.Now().UTC()
	value := Account{ID: "user", Name: "Before", UpdatedAt: now, LastOnlineAt: &now}
	_, _, generation := service.profiles.get(value.ID, now, nil)
	service.InvalidateProfile(value.ID)
	service.profiles.put(value, now, generation)
	if _, hit, _ := service.profiles.get(value.ID, now, nil); hit {
		t.Fatal("stale query refilled invalidated cache")
	}
	_, _, generation = service.profiles.get(value.ID, now, nil)
	service.profiles.put(value, now, generation)
	cached, _, _ := service.profiles.get(value.ID, now, nil)
	*cached.LastOnlineAt = now.Add(time.Hour)
	unchanged, _, _ := service.profiles.get(value.ID, now, nil)
	if !unchanged.LastOnlineAt.Equal(now) {
		t.Fatal("caller mutated cached time")
	}
	for i := range profileCacheCapacity {
		service.profiles.put(Account{ID: fmt.Sprint(i)}, now, generation)
	}
	if service.profiles.lru.Len() != profileCacheCapacity || len(service.profiles.entries) != profileCacheCapacity {
		t.Fatal("profile cache exceeded capacity")
	}
	if _, hit, _ := service.profiles.get(value.ID, now, nil); hit {
		t.Fatal("least recently used profile not evicted")
	}
}

func TestProfileReadsShowPendingOnlineTimeAfterFlush(t *testing.T) {
	initial := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	service, session := newSessionActivityTestService(t, initial)
	if _, err := service.GetProfile(t.Context(), session.UserID); err != nil {
		t.Fatal(err)
	}
	latest := initial.Add(time.Minute)
	if err := service.RecordOnlineActivity(t.Context(), session.UserID, latest); err != nil {
		t.Fatal(err)
	}
	for _, flush := range []bool{false, true} {
		if flush {
			if err := service.FlushActivity(t.Context()); err != nil {
				t.Fatal(err)
			}
		}
		profile, err := service.GetProfile(t.Context(), session.UserID)
		if err != nil || profile.LastOnlineAt == nil || !profile.LastOnlineAt.Equal(latest) {
			t.Fatalf("flush=%v: %+v, %v", flush, profile, err)
		}
	}
}
