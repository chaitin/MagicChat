package conversation

import (
	"context"
	"testing"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
)

type readNotificationRecorder struct {
	*pinNotificationRecorder
	db      *gorm.DB
	events  []ReadResult
	userIDs [][]string
}

func (r *readNotificationRecorder) PublishConversationReadUpdated(_ context.Context, users []string, event ReadResult) {
	var member store.ConversationMember
	if err := r.db.Where("conversation_id = ? AND member_id = ?", event.ConversationID, users[0]).First(&member).Error; err != nil || member.LastReadSeq != event.LastReadSeq {
		panic("read notification emitted before commit")
	}
	r.events = append(r.events, event)
	r.userIDs = append(r.userIDs, append([]string(nil), users...))
}

func TestMarkReadNotifiesOnlyAfterCursorAdvances(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 7, 21, 2, 0, 0, 0, time.UTC)
	alice := insertConversationTestUser(t, db, "read-alice@example.com", "Alice", now)
	bob := insertConversationTestUser(t, db, "read-bob@example.com", "Bob", now)
	conversation := insertPinTestConversation(t, db, alice, bob, "会话", now, now)
	if err := db.Model(&store.Conversation{}).Where("id = ?", conversation.ID).Update("last_message_seq", 3).Error; err != nil {
		t.Fatal(err)
	}
	recorder := &readNotificationRecorder{pinNotificationRecorder: &pinNotificationRecorder{}, db: db}
	service := NewService(Dependencies{DB: db, Notifications: recorder})
	upToSeq := int64(2)
	for _, seq := range []int64{2, 2, 3} {
		upToSeq = seq
		result, err := service.MarkRead(context.Background(), ReadCommand{AccountID: bob.ID, ConversationID: conversation.ID, UpToSeq: &upToSeq})
		if err != nil || result.LastReadSeq != seq {
			t.Fatalf("mark read result = %#v, err = %v", result, err)
		}
	}
	if len(recorder.events) != 2 || recorder.events[0].UnreadCount != 1 || recorder.events[1].UnreadCount != 0 || recorder.userIDs[0][0] != bob.ID {
		t.Fatalf("read events = %#v, recipients = %#v", recorder.events, recorder.userIDs)
	}
}
