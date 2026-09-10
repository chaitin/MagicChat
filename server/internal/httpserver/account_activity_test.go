package httpserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"app/internal/auth"
	"app/internal/config"
	"app/internal/store"

	"github.com/google/uuid"
)

func TestAccountActivityFlushesOnWorkerShutdown(t *testing.T) {
	initialRouter, db := newTestRouter(t)
	initialRouter.Close()
	initial := time.Now().UTC().Add(-time.Minute)
	user := insertTestUser(t, db, "activity-shutdown@example.com", "Activity", store.UserStatusActive, initial)
	session := store.UserSession{
		ID: uuid.NewString(), TokenHash: auth.HashSessionToken("shutdown-session"), UserID: user.ID,
		CreatedAt: initial, LastSeenAt: initial, ExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	workerCtx, stop := context.WithCancel(t.Context())
	defer stop()
	router, finish := NewRouterWithTaskReminderWorker(workerCtx, db, config.Config{})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/client/me", nil)
	request.Header.Set("Authorization", "Bearer shutdown-session")
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("authenticate: %d %s", recorder.Code, recorder.Body.String())
	}
	var before store.UserSession
	if err := db.First(&before, "id = ?", session.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !before.LastSeenAt.Equal(initial) {
		t.Fatal("activity was written before worker flush")
	}
	stop()
	shutdownCtx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	if err := finish(shutdownCtx); err != nil {
		t.Fatal(err)
	}
	var after store.UserSession
	if err := db.First(&after, "id = ?", session.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !after.LastSeenAt.After(initial) {
		t.Fatal("shutdown did not flush pending activity")
	}
}
