package bootstrap

import (
	"testing"

	"app/internal/appregistry"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestEnsureAssistantConversationMembershipBackfillsAndIsIdempotent(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`CREATE TABLE conversations (id TEXT PRIMARY KEY, kind TEXT, status TEXT, last_message_seq INTEGER NOT NULL)`,
		`CREATE TABLE conversation_members (conversation_id TEXT, member_type TEXT, member_id TEXT, role TEXT, joined_at TEXT, history_visible_from_seq INTEGER, left_at TEXT, PRIMARY KEY (conversation_id, member_type, member_id))`,
		`CREATE TABLE conversation_topics (conversation_id TEXT, parent_conversation_id TEXT)`,
		`CREATE TABLE conversation_topic_participants (conversation_id TEXT, participant_type TEXT, participant_id TEXT, joined_reason TEXT, joined_at TEXT, history_visible_from_seq INTEGER, created_at TEXT, updated_at TEXT, PRIMARY KEY (conversation_id, participant_type, participant_id))`,
		`INSERT INTO conversations VALUES ('direct', 'direct', 'active', 5), ('archived-group', 'group', 'dissolved', 1), ('assistant-app', 'app', 'active', 0), ('topic', 'topic', 'archived', 2)`,
		`INSERT INTO conversation_topics VALUES ('topic', 'direct')`,
		`INSERT INTO conversation_members VALUES ('assistant-app', 'app', '00000000-0000-0000-0000-000000000001', 'owner', CURRENT_TIMESTAMP, 1, NULL)`,
		`INSERT INTO conversation_members VALUES ('direct', 'app', '00000000-0000-0000-0000-000000000001', 'member', CURRENT_TIMESTAMP, 6, CURRENT_TIMESTAMP)`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	for run := 0; run < 2; run++ {
		if err := ensureAssistantConversationMembership(db); err != nil {
			t.Fatalf("backfill run %d: %v", run, err)
		}
	}
	var rows []struct {
		ConversationID        string  `gorm:"column:conversation_id"`
		Role                  string  `gorm:"column:role"`
		HistoryVisibleFromSeq int64   `gorm:"column:history_visible_from_seq"`
		LeftAt                *string `gorm:"column:left_at"`
	}
	if err := db.Table("conversation_members").Where("member_id = ?", appregistry.AIAssistantAppID).Order("conversation_id").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 || rows[0].ConversationID != "archived-group" || rows[0].HistoryVisibleFromSeq != 2 || rows[1].ConversationID != "assistant-app" || rows[1].Role != "owner" || rows[2].ConversationID != "direct" || rows[2].HistoryVisibleFromSeq != 6 || rows[2].LeftAt != nil {
		t.Fatalf("backfilled members = %#v", rows)
	}
	var participants []struct {
		HistoryVisibleFromSeq int64 `gorm:"column:history_visible_from_seq"`
	}
	if err := db.Table("conversation_topic_participants").Where("participant_id = ? AND conversation_id = ?", appregistry.AIAssistantAppID, "topic").Find(&participants).Error; err != nil {
		t.Fatal(err)
	}
	if len(participants) != 1 || participants[0].HistoryVisibleFromSeq != 3 {
		t.Fatalf("backfilled archived topic participants = %#v", participants)
	}
}
