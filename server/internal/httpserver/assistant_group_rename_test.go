package httpserver

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	conversationapp "app/internal/application/conversation"
	"app/internal/appregistry"
	"app/internal/config"
	"app/internal/realtime"
	"app/internal/store"
)

func TestAssistantGroupRenameRequiresOwnerOrAdminAndDoesNotRequireAppMembership(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Date(2026, 7, 23, 11, 0, 0, 0, time.UTC)
	owner := insertTestUser(t, db, "rename-owner@example.com", "Owner", store.UserStatusActive, now)
	member := insertTestUser(t, db, "rename-member@example.com", "Member", store.UserStatusActive, now)
	authorizationConversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: owner.ID, kind: store.ConversationKindGroup, memberIDs: []string{owner.ID, member.ID}, name: "授权会话", now: now,
	})
	insertTestAppConversationMember(t, db, appregistry.AIAssistantAppID, authorizationConversation.ID, now)
	target := insertTestConversation(t, db, testConversationInput{
		createdByUserID: owner.ID, kind: store.ConversationKindGroup, memberIDs: []string{owner.ID, member.ID}, name: "新群聊", now: now,
	})
	if err := db.Create(&store.ConversationAutoNameTask{
		ConversationID: target.ID, Status: store.ConversationAutoNameStatusPending,
		MessageLimit: 5, Version: 1, CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	ownerTrigger := insertTestMessageFromSender(t, db, authorizationConversation.ID, store.MessageSenderTypeUser, owner.ID, 1, "请改群名", now)
	memberTrigger := insertTestMessageFromSender(t, db, authorizationConversation.ID, store.MessageSenderTypeUser, member.ID, 2, "请改群名", now)
	conn := dialAppWebSocket(t, server, appregistry.AIAssistantAppID, "test-ai-assistant-secret")

	denied := sendRawAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "assistant-rename-member", Method: appMethodAssistantGroupRename,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"actor_user_id": member.ID, "authorization_conversation_id": authorizationConversation.ID,
			"conversation_id": target.ID, "mode": "explicit", "name": "成员命名",
			"trigger_message_id": memberTrigger.ID,
		}),
	})
	requireAppErrorResponse(t, denied, "forbidden")

	sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "assistant-rename-owner", Method: appMethodAssistantGroupRename,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"actor_user_id": owner.ID, "authorization_conversation_id": authorizationConversation.ID,
			"conversation_id": target.ID, "mode": "explicit", "name": "发布冲刺组",
			"trigger_message_id": ownerTrigger.ID,
		}),
	})

	var updated store.Conversation
	if err := db.First(&updated, "id = ?", target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if updated.Name != "发布冲刺组" {
		t.Fatalf("name = %q", updated.Name)
	}
	var task store.ConversationAutoNameTask
	if err := db.First(&task, "conversation_id = ?", target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if task.Status != store.ConversationAutoNameStatusSkipped {
		t.Fatalf("task status = %q", task.Status)
	}
	var message store.Message
	if err := db.Where("conversation_id = ?", target.ID).Order("seq DESC").First(&message).Error; err != nil {
		t.Fatal(err)
	}
	var body struct {
		Actor struct {
			ID string `json:"id"`
		} `json:"actor"`
		Event string `json:"event"`
	}
	if err := json.Unmarshal(message.Body, &body); err != nil {
		t.Fatal(err)
	}
	if message.SenderType != store.MessageSenderTypeSystem || body.Event != "group_name_updated" || body.Actor.ID != appregistry.AIAssistantAppID {
		t.Fatalf("message = %#v body = %#v", message, body)
	}
}

func TestThirdPartyApplicationCannotCallAssistantGroupRename(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Date(2026, 7, 23, 11, 30, 0, 0, time.UTC)
	creator := insertTestUser(t, db, "third-party-rename@example.com", "Creator", store.UserStatusActive, now)
	creatorID := creator.ID
	app := insertTestApp(t, db, store.App{Name: "Third Party", CreatorUserID: &creatorID, Enabled: true, Visibility: store.AppVisibilityRestricted, ConnectionSecret: "third-party-rename-secret", CreatedAt: now, UpdatedAt: now})
	conn := dialAppWebSocket(t, server, app.ID, app.ConnectionSecret)
	response := sendRawAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "third-party-assistant-rename", Method: appMethodAssistantGroupRename,
		Payload: mustMarshalPayloadForTest(t, map[string]any{}),
	})
	requireAppErrorResponse(t, response, "forbidden")
}

func TestAssistantExplicitGroupRenameRejectsInvalidRunAsTriggers(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Now().UTC()
	owner := insertTestUser(t, db, "rename-trigger-owner@example.com", "Owner", store.UserStatusActive, now)
	disabledOwner := insertTestUser(t, db, "rename-trigger-disabled@example.com", "Disabled", store.UserStatusDisabled, now)
	authorizationConversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: owner.ID, kind: store.ConversationKindGroup,
		memberIDs: []string{owner.ID, disabledOwner.ID}, name: "授权会话", now: now,
	})
	insertTestAppConversationMember(t, db, appregistry.AIAssistantAppID, authorizationConversation.ID, now)
	target := insertTestConversation(t, db, testConversationInput{
		createdByUserID: owner.ID, kind: store.ConversationKindGroup,
		memberIDs: []string{owner.ID, disabledOwner.ID}, name: "原群名", now: now,
	})
	if err := db.Model(&store.ConversationMember{}).Where(
		"conversation_id = ? AND member_type = ? AND member_id = ?",
		target.ID, store.ConversationMemberTypeUser, disabledOwner.ID,
	).Update("role", store.ConversationMemberRoleAdmin).Error; err != nil {
		t.Fatalf("make disabled user admin: %v", err)
	}

	revoked := insertTestMessageFromSender(t, db, authorizationConversation.ID, store.MessageSenderTypeUser, owner.ID, 1, "撤回的改名请求", now)
	deleted := insertTestMessageFromSender(t, db, authorizationConversation.ID, store.MessageSenderTypeUser, owner.ID, 2, "删除的改名请求", now)
	disabled := insertTestMessageFromSender(t, db, authorizationConversation.ID, store.MessageSenderTypeUser, disabledOwner.ID, 3, "停用用户的请求", now)
	valid := insertTestMessageFromSender(t, db, authorizationConversation.ID, store.MessageSenderTypeUser, owner.ID, 4, "有效但会话不匹配", now)
	if err := db.Model(&store.Message{}).Where("id = ?", revoked.ID).
		Updates(map[string]any{"revoked_at": now, "updated_at": now}).Error; err != nil {
		t.Fatalf("revoke trigger: %v", err)
	}
	if err := db.Model(&store.Message{}).Where("id = ?", deleted.ID).
		Updates(map[string]any{"deleted_at": now, "updated_at": now}).Error; err != nil {
		t.Fatalf("delete trigger: %v", err)
	}

	conn := dialAppWebSocket(t, server, appregistry.AIAssistantAppID, "test-ai-assistant-secret")
	tests := []struct {
		name                        string
		actorID                     string
		authorizationConversationID string
		triggerID                   string
	}{
		{name: "revoked", actorID: owner.ID, authorizationConversationID: authorizationConversation.ID, triggerID: revoked.ID},
		{name: "deleted", actorID: owner.ID, authorizationConversationID: authorizationConversation.ID, triggerID: deleted.ID},
		{name: "disabled user", actorID: disabledOwner.ID, authorizationConversationID: authorizationConversation.ID, triggerID: disabled.ID},
		{name: "authorization conversation mismatch", actorID: owner.ID, authorizationConversationID: target.ID, triggerID: valid.ID},
	}
	for _, test := range tests {
		response := sendRawAppRequest(t, conn, realtime.Envelope{
			V: realtime.ProtocolVersion, Kind: realtime.KindRequest,
			ID: "assistant-invalid-trigger-" + test.name, Method: appMethodAssistantGroupRename,
			Payload: mustMarshalPayloadForTest(t, map[string]any{
				"actor_user_id": test.actorID, "authorization_conversation_id": test.authorizationConversationID,
				"conversation_id": target.ID, "mode": "explicit", "name": "非法改名",
				"trigger_message_id": test.triggerID,
			}),
		})
		requireAppErrorResponse(t, response, "forbidden")
	}
	var unchanged store.Conversation
	if err := db.First(&unchanged, "id = ?", target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.Name != "原群名" {
		t.Fatalf("target name = %q, want unchanged", unchanged.Name)
	}
}

func TestAssistantGroupRenameServiceRevalidatesTriggerInsideMutation(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Now().UTC()
	owner := insertTestUser(t, db, "rename-transaction-owner@example.com", "Owner", store.UserStatusActive, now)
	authorizationConversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: owner.ID, kind: store.ConversationKindGroup,
		memberIDs: []string{owner.ID}, name: "授权会话", now: now,
	})
	target := insertTestConversation(t, db, testConversationInput{
		createdByUserID: owner.ID, kind: store.ConversationKindGroup,
		memberIDs: []string{owner.ID}, name: "原群名", now: now,
	})
	trigger := insertTestMessageFromSender(t, db, authorizationConversation.ID, store.MessageSenderTypeUser, owner.ID, 1, "请改群名", now)
	if err := db.Model(&store.Message{}).Where("id = ?", trigger.ID).
		Updates(map[string]any{"revoked_at": now, "updated_at": now}).Error; err != nil {
		t.Fatalf("revoke trigger: %v", err)
	}
	if _, err := appregistry.EnsureAIAssistantApp(db, config.AppsConfig{AIAssistantSecret: "test-ai-assistant-secret"}); err != nil {
		t.Fatalf("ensure assistant app: %v", err)
	}

	service := conversationapp.NewService(conversationapp.Dependencies{DB: db})
	_, err := service.RenameGroupAsAssistant(context.Background(), conversationapp.RenameGroupAsAssistantCommand{
		AppID: appregistry.AIAssistantAppID, ActorUserID: owner.ID,
		AuthorizationConversationID: authorizationConversation.ID, ConversationID: target.ID,
		Mode: conversationapp.AssistantGroupRenameModeExplicit, Name: "不应生效",
		TriggerMessageID: trigger.ID,
	})
	if conversationapp.ErrorCodeOf(err) != conversationapp.CodeForbidden {
		t.Fatalf("transactional trigger revalidation error = %v, want forbidden", err)
	}
	var unchanged store.Conversation
	if err := db.First(&unchanged, "id = ?", target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.Name != "原群名" {
		t.Fatalf("target name = %q, want unchanged", unchanged.Name)
	}
}

func TestAssistantAutomaticGroupRenameDoesNotRequireGroupMembership(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Date(2026, 7, 23, 12, 0, 0, 0, time.UTC)
	owner := insertTestUser(t, db, "auto-rename-owner@example.com", "Owner", store.UserStatusActive, now)
	target := insertTestConversation(t, db, testConversationInput{
		createdByUserID: owner.ID, kind: store.ConversationKindGroup, memberIDs: []string{owner.ID}, name: "新群聊", now: now,
	})
	if err := db.Create(&store.ConversationAutoNameTask{
		ConversationID: target.ID, Status: store.ConversationAutoNameStatusPending,
		MessageCount: 5, MessageLimit: 5, Version: 2, TriggeredVersion: 2,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	conn := dialAppWebSocket(t, server, appregistry.AIAssistantAppID, "test-ai-assistant-secret")
	sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "assistant-auto-rename", Method: appMethodAssistantGroupRename,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"conversation_id": target.ID, "mode": "auto", "name": "移动端发布组", "task_version": 2,
		}),
	})
	var conversation store.Conversation
	if err := db.First(&conversation, "id = ?", target.ID).Error; err != nil {
		t.Fatal(err)
	}
	var task store.ConversationAutoNameTask
	if err := db.First(&task, "conversation_id = ?", target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if conversation.Name != "移动端发布组" || task.Status != store.ConversationAutoNameStatusCompleted {
		t.Fatalf("conversation = %#v, task = %#v", conversation, task)
	}
	var appMemberCount int64
	if err := db.Model(&store.ConversationMember{}).Where(
		"conversation_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL",
		target.ID, store.ConversationMemberTypeApp, appregistry.AIAssistantAppID,
	).Count(&appMemberCount).Error; err != nil {
		t.Fatal(err)
	}
	if appMemberCount != 0 {
		t.Fatalf("assistant member count = %d, want 0", appMemberCount)
	}
}

func TestAssistantAutomaticGroupRenameTreatsDisabledOrDissolvedTaskAsNoOp(t *testing.T) {
	tests := []struct {
		name      string
		disabled  bool
		dissolved bool
	}{
		{name: "disabled", disabled: true},
		{name: "dissolved", dissolved: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server, db := newTestRouter(t)
			defer server.Close()
			now := time.Date(2026, 7, 23, 12, 30, 0, 0, time.UTC)
			owner := insertTestUser(t, db, test.name+"-auto-owner@example.com", "Owner", store.UserStatusActive, now)
			target := insertTestConversation(t, db, testConversationInput{
				createdByUserID: owner.ID, kind: store.ConversationKindGroup, memberIDs: []string{owner.ID}, name: "新群聊", now: now,
			})
			if test.disabled {
				if err := db.Create(&store.AppSettings{
					ID: store.AppSettingsID, AppName: "即应", OrganizationName: "测试",
					AssistantAutoGroupNamingEnabled: false, AssistantAutoGroupNamingMessageCount: 5,
					CreatedAt: now, UpdatedAt: now,
				}).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Model(&store.AppSettings{}).Where("id = ?", store.AppSettingsID).
					Update("assistant_auto_group_naming_enabled", false).Error; err != nil {
					t.Fatal(err)
				}
			}
			if test.dissolved {
				if err := db.Model(&store.Conversation{}).Where("id = ?", target.ID).
					Updates(map[string]any{"status": store.ConversationStatusDissolved, "dissolved_at": now}).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Create(&store.ConversationAutoNameTask{
				ConversationID: target.ID, Status: store.ConversationAutoNameStatusPending,
				MessageCount: 5, MessageLimit: 5, Version: 2, TriggeredVersion: 2,
				CreatedAt: now, UpdatedAt: now,
			}).Error; err != nil {
				t.Fatal(err)
			}
			conn := dialAppWebSocket(t, server, appregistry.AIAssistantAppID, "test-ai-assistant-secret")
			sendAppRequest(t, conn, realtime.Envelope{
				V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "assistant-auto-noop-" + test.name, Method: appMethodAssistantGroupRename,
				Payload: mustMarshalPayloadForTest(t, map[string]any{
					"conversation_id": target.ID, "mode": "auto", "name": "不应应用", "task_version": 2,
				}),
			})
			var conversation store.Conversation
			if err := db.First(&conversation, "id = ?", target.ID).Error; err != nil {
				t.Fatal(err)
			}
			if conversation.Name != "新群聊" {
				t.Fatalf("conversation name = %q, want unchanged", conversation.Name)
			}
		})
	}
}
