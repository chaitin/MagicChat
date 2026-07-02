package store

import (
	"os"
	"strings"
	"testing"
)

func TestConversationMigrationDefinesConversationMemberConstraints(t *testing.T) {
	rawSQL, err := os.ReadFile("../../migrations/00005_create_conversations.sql")
	if err != nil {
		t.Fatalf("read conversation migration: %v", err)
	}
	sql := strings.ToLower(string(rawSQL))

	for _, required := range []string{
		"user_member_id uuid generated always as",
		"when member_type = 'user' then member_id",
		"references users(id) on delete restrict",
		"conversation_members_one_owner_per_conversation",
		"where role = 'owner' and left_at is null",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("conversation migration missing %q", required)
		}
	}
}

func TestUserProfileMigrationDefinesPhoneAndAvatarDefaults(t *testing.T) {
	rawSQL, err := os.ReadFile("../../migrations/00006_add_user_profile_fields.sql")
	if err != nil {
		t.Fatalf("read user profile migration: %v", err)
	}
	sql := strings.ToLower(string(rawSQL))

	for _, required := range []string{
		"add column phone text",
		"add column nickname text not null default ''",
		"add column avatar text",
		"set avatar = '/assets/avatars/builtin/01.webp'",
		"alter column avatar set not null",
		"create unique index users_phone_unique",
		"where phone is not null",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("user profile migration missing %q", required)
		}
	}
}
