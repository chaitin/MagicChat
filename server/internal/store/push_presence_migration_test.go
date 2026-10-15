package store

import (
	"os"
	"strings"
	"testing"
)

func TestPushPresenceMigrationAddsExpiringSessionStateAndOptInPreference(t *testing.T) {
	raw, err := os.ReadFile("../../migrations/00045_add_push_presence_and_preferences.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := strings.ToLower(string(raw))
	for _, part := range []string{"create table user_push_preferences", "pause_when_desktop_active boolean not null default false", "create table user_push_presences", "references user_sessions(id) on delete cascade", "expires_at timestamptz not null", "user_push_presences_user_active_index"} {
		if !strings.Contains(sql, part) {
			t.Fatalf("migration missing %q", part)
		}
	}
	if strings.Contains(sql, "delete from user_push_grants") {
		t.Fatal("presence migration must preserve existing push grants")
	}
}
