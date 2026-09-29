package conversation

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"app/internal/store"
)

func TestSetMemberRoleRequiresManagerAndProtectsOwner(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
	owner := insertConversationTestUser(t, db, "owner-roles@example.com", "Owner", now)
	admin := insertConversationTestUser(t, db, "admin-roles@example.com", "Admin", now)
	member := insertConversationTestUser(t, db, "member-roles@example.com", "Member", now)
	outsider := insertConversationTestUser(t, db, "outsider-roles@example.com", "Outsider", now)
	notifications := &conversationNotificationRecorder{db: db}
	service := NewService(Dependencies{DB: db, Notifications: notifications, Now: func() time.Time { return now }})
	created, err := service.CreateGroup(context.Background(), CreateGroupCommand{
		Actor: actorFromTestUser(owner), Name: "Roles", MemberIDs: []string{admin.ID, member.ID},
	})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	groupID := created.Conversation.ID
	command := func(actor store.User, targetID, role string) SetMemberRoleCommand {
		return SetMemberRoleCommand{
			Actor: actorFromTestUser(actor), ConversationID: groupID,
			MemberType: store.ConversationMemberTypeUser, MemberID: targetID, Role: role,
		}
	}

	promoted, err := service.SetMemberRole(context.Background(), command(owner, admin.ID, store.ConversationMemberRoleAdmin))
	if err != nil || promoted.Message == nil {
		t.Fatalf("promote admin = %#v, err = %v", promoted, err)
	}
	var body groupMemberRoleUpdatedSystemEventBody
	if err := json.Unmarshal(promoted.Message.Body, &body); err != nil || body.Event != "group_member_role_updated" || body.Role != store.ConversationMemberRoleAdmin || body.Target.ID != admin.ID {
		t.Fatalf("role event = %#v, err = %v", body, err)
	}
	unchanged, err := service.SetMemberRole(context.Background(), command(owner, admin.ID, store.ConversationMemberRoleAdmin))
	if err != nil || unchanged.Message != nil {
		t.Fatalf("unchanged role = %#v, err = %v", unchanged, err)
	}
	if _, err := service.SetMemberRole(context.Background(), command(admin, member.ID, store.ConversationMemberRoleAdmin)); err != nil {
		t.Fatalf("admin promote: %v", err)
	}
	demoted, err := service.SetMemberRole(context.Background(), command(admin, member.ID, store.ConversationMemberRoleMember))
	if err != nil || demoted.Message == nil {
		t.Fatalf("admin demote = %#v, err = %v", demoted, err)
	}
	var stored store.ConversationMember
	if err := db.First(&stored, "conversation_id = ? AND member_type = ? AND member_id = ?", groupID, store.ConversationMemberTypeUser, member.ID).Error; err != nil || stored.Role != store.ConversationMemberRoleMember {
		t.Fatalf("member role = %q, err = %v", stored.Role, err)
	}
	for _, actor := range []store.User{member, outsider} {
		if _, err := service.SetMemberRole(context.Background(), command(actor, admin.ID, store.ConversationMemberRoleMember)); ErrorCodeOf(err) != CodeForbidden {
			t.Fatalf("%s must not manage roles: %v", actor.Name, err)
		}
	}
	if _, err := service.SetMemberRole(context.Background(), command(admin, owner.ID, store.ConversationMemberRoleMember)); ErrorCodeOf(err) != CodeForbidden {
		t.Fatalf("owner role must be protected: %v", err)
	}
	if _, err := service.SetMemberRole(context.Background(), command(owner, admin.ID, "owner")); ErrorCodeOf(err) != CodeInvalidRequest {
		t.Fatalf("invalid role must be rejected: %v", err)
	}
	if notifications.messages != 4 {
		t.Fatalf("published messages = %d, want 4", notifications.messages)
	}
}
