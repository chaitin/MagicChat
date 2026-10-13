package message

import (
	"context"
	"fmt"
	"testing"
	"time"

	"app/internal/store"
)

func TestSetAppReactionIdempotencyMixedActorsAndRevoke(t *testing.T) {
	db := openMessageTestDB(t)
	fixture := insertMessageTestFixture(t, db)
	message := insertReactionTestMessage(t, db, fixture.conversation.ID, fixture.user.ID, 1, store.MessageSenderTypeUser)
	notifications := &reactionNotificationRecorder{}
	service := NewService(Dependencies{DB: db, ReactionNotifications: notifications})
	cmd := SetAppReactionCommand{AppID: fixture.app.ID, ConversationID: fixture.conversation.ID, MessageID: message.ID, Text: " 收到 ", Reacted: true}
	added, err := service.SetAppReaction(context.Background(), cmd)
	if err != nil || !added.Changed || added.ReactionVersion != 1 || len(added.Reactions) != 1 {
		t.Fatalf("add = %#v, error = %v", added, err)
	}
	if reaction := added.Reactions[0]; reaction.Text != "收到" || reaction.Count != 1 || !reaction.ReactedByMe ||
		len(reaction.Users) != 1 || reaction.Users[0] != (ReactionUser{ID: fixture.app.ID, Name: fixture.app.Name, Type: "app"}) {
		t.Fatalf("reaction = %#v", reaction)
	}
	if event := notifications.events[0]; event.ActorAppID != fixture.app.ID || event.ActorUserID != "" {
		t.Fatalf("event = %#v", event)
	}
	duplicate, err := service.SetAppReaction(context.Background(), cmd)
	if err != nil || duplicate.Changed || duplicate.ReactionVersion != 1 || len(notifications.events) != 1 {
		t.Fatalf("duplicate = %#v, error = %v", duplicate, err)
	}
	userResult, err := service.SetReaction(context.Background(), SetReactionCommand{
		AccountID: fixture.user.ID, ConversationID: fixture.conversation.ID, MessageID: message.ID, Text: "收到", Reacted: true,
	})
	if err != nil || userResult.ReactionVersion != 2 || userResult.Reactions[0].Count != 2 || !userResult.Reactions[0].ReactedByMe {
		t.Fatalf("user add = %#v, error = %v", userResult, err)
	}
	users, err := service.ListReactionUsers(context.Background(), ListReactionUsersCommand{
		AccountID: fixture.user.ID, ConversationID: fixture.conversation.ID, MessageID: message.ID, Text: "收到",
	})
	if err != nil || len(users.Users) != 2 || users.Users[0].Type != "app" || users.Users[1].ID != fixture.user.ID {
		t.Fatalf("participants = %#v, error = %v", users, err)
	}
	cmd.Reacted = false
	removed, err := service.SetAppReaction(context.Background(), cmd)
	if err != nil || !removed.Changed || removed.ReactionVersion != 3 || removed.Reactions[0].Count != 1 || removed.Reactions[0].ReactedByMe {
		t.Fatalf("remove = %#v, error = %v", removed, err)
	}
	cmd.Reacted = true
	if _, err := service.SetAppReaction(context.Background(), cmd); err != nil {
		t.Fatal(err)
	}
	before := fixture.conversation
	if err := db.First(&before, "id = ?", before.ID).Error; err != nil {
		t.Fatal(err)
	}
	if before.LastMessageSeq != message.Seq || before.LastMessageID == nil || *before.LastMessageID != message.ID {
		t.Fatalf("reactions changed conversation ordering: %#v", before)
	}
	if _, err := service.Revoke(context.Background(), RevokeCommand{AccountID: fixture.user.ID, ConversationID: fixture.conversation.ID, MessageID: message.ID}); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&store.MessageAppReaction{}).Where("message_id = ?", message.ID).Count(&count)
	if count != 0 {
		t.Fatalf("app reactions remain after revoke: %d", count)
	}
}

func TestSetAppReactionAccessAndTextLimits(t *testing.T) {
	for _, scenario := range []string{"left", "disabled", "invisible", "revoked", "system", "closed"} {
		t.Run(scenario, func(t *testing.T) {
			db := openMessageTestDB(t)
			fixture := insertMessageTestFixture(t, db)
			message := insertReactionTestMessage(t, db, fixture.conversation.ID, fixture.user.ID, 1, store.MessageSenderTypeUser)
			want := CodeForbidden
			var err error
			switch scenario {
			case "left":
				err = db.Model(&store.ConversationMember{}).Where("conversation_id = ? AND member_type = ?", fixture.conversation.ID, "app").Update("left_at", time.Now().UTC()).Error
			case "disabled":
				err = db.Model(&store.App{}).Where("id = ?", fixture.app.ID).Update("enabled", false).Error
			case "invisible":
				err = db.Model(&store.ConversationMember{}).Where("conversation_id = ? AND member_type = ?", fixture.conversation.ID, "app").Update("history_visible_from_seq", 2).Error
			case "revoked":
				err = db.Model(&store.Message{}).Where("id = ?", message.ID).Update("revoked_at", time.Now().UTC()).Error
				want = CodeConflict
			case "system":
				err = db.Model(&store.Message{}).Where("id = ?", message.ID).Update("sender_type", store.MessageSenderTypeSystem).Error
				want = CodeConflict
			case "closed":
				err = db.Model(&store.Conversation{}).Where("id = ?", fixture.conversation.ID).Update("status", "dissolved").Error
			}
			if err != nil {
				t.Fatal(err)
			}
			_, err = NewService(Dependencies{DB: db}).SetAppReaction(context.Background(), SetAppReactionCommand{
				AppID: fixture.app.ID, ConversationID: fixture.conversation.ID, MessageID: message.ID, Reacted: true, Text: "收到",
			})
			if ErrorCodeOf(err) != want {
				t.Fatalf("error = %v, want %s", err, want)
			}
		})
	}
	db := openMessageTestDB(t)
	fixture := insertMessageTestFixture(t, db)
	message := insertReactionTestMessage(t, db, fixture.conversation.ID, fixture.user.ID, 1, store.MessageSenderTypeUser)
	service := NewService(Dependencies{DB: db})
	cmd := SetAppReactionCommand{AppID: fixture.app.ID, ConversationID: fixture.conversation.ID, MessageID: message.ID, Reacted: true}
	for _, text := range []string{"", "hello\nworld", "hello\u2028world"} {
		cmd.Text = text
		if _, err := service.SetAppReaction(context.Background(), cmd); ErrorCodeOf(err) != CodeInvalidRequest {
			t.Fatalf("text %q error = %v", text, err)
		}
	}
	for i := 0; i < maxReactionsPerUserMessage; i++ {
		cmd.Text = fmt.Sprintf("app-%d", i)
		if _, err := service.SetAppReaction(context.Background(), cmd); err != nil {
			t.Fatal(err)
		}
	}
	cmd.Text = "overflow"
	if _, err := service.SetAppReaction(context.Background(), cmd); ErrorCodeOf(err) != CodeConflict {
		t.Fatalf("limit error = %v", err)
	}
}
