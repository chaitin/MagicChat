package account

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPostgresActivityFlushUsesTypedBatches(t *testing.T) {
	db := openAccountPostgresTestDB(t)
	for _, ddl := range []string{
		`CREATE TABLE user_sessions (id uuid PRIMARY KEY, last_seen_at timestamptz NOT NULL)`,
		`CREATE TABLE users (id uuid PRIMARY KEY, last_online_at timestamptz, updated_at timestamptz NOT NULL)`,
	} {
		if err := db.Exec(ddl).Error; err != nil {
			t.Fatal(err)
		}
	}
	initial := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	first, second, userID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	if err := db.Exec("INSERT INTO user_sessions VALUES (?, ?), (?, ?)", first, initial, second, initial).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO users VALUES (?, NULL, ?)", userID, initial).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService(Dependencies{DB: db})
	latest := initial.Add(time.Minute)
	service.recordSessionActivity(first, latest)
	service.recordSessionActivity(second, latest.Add(time.Second))
	if err := service.RecordOnlineActivity(t.Context(), userID, latest); err != nil {
		t.Fatal(err)
	}
	if err := service.FlushActivity(t.Context()); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]time.Time{first: latest, second: latest.Add(time.Second)} {
		var got time.Time
		if err := db.Raw("SELECT last_seen_at FROM user_sessions WHERE id = ?", id).Scan(&got).Error; err != nil || !got.Equal(want) {
			t.Fatalf("session time = %v, want %v, error=%v", got, want, err)
		}
	}
	var got struct {
		LastOnlineAt time.Time
		UpdatedAt    time.Time
	}
	if err := db.Table("users").Where("id = ?", userID).Take(&got).Error; err != nil {
		t.Fatal(err)
	}
	if !got.LastOnlineAt.Equal(latest) || !got.UpdatedAt.Equal(initial) {
		t.Fatalf("online activity = %+v", got)
	}
	// A delayed instance must not regress the value already committed.
	service.recordSessionActivity(first, initial)
	if err := service.FlushActivity(t.Context()); err != nil {
		t.Fatal(err)
	}
	var preserved time.Time
	if err := db.Raw("SELECT last_seen_at FROM user_sessions WHERE id = ?", first).Scan(&preserved).Error; err != nil || !preserved.Equal(latest) {
		t.Fatalf("timestamp regressed: %v, %v", preserved, err)
	}
}
