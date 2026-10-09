package httpserver

import (
	"encoding/json"
	"testing"
	"time"

	"app/internal/realtime"
	"app/internal/store"

	"github.com/google/uuid"
)

func TestThirdPartyApplicationOwnsAndManagesGroup(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Date(2026, 7, 20, 8, 0, 0, 0, time.UTC)
	owner := insertTestUser(t, db, "app-group-owner@example.com", "Owner", store.UserStatusActive, now)
	member := insertTestUser(t, db, "app-group-member@example.com", "Member", store.UserStatusActive, now)
	outsider := insertTestUser(t, db, "app-group-outsider@example.com", "Outsider", store.UserStatusActive, now)
	ownerID := owner.ID
	app := insertTestApp(t, db, store.App{
		Name: "Group Operator", CreatorUserID: &ownerID, Enabled: true,
		Visibility: store.AppVisibilityRestricted, ConnectionSecret: "group-operator-secret",
		CreatedAt: now, UpdatedAt: now,
	})
	if err := db.Create(&store.AppUserGrant{
		AppID: app.ID, UserID: member.ID, GrantedByUserID: &ownerID, CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("create app grant: %v", err)
	}
	conn := dialAppWebSocket(t, server, app.ID, app.ConnectionSecret)

	userResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "users-get-owner",
		Method:  appMethodUsersGet,
		Payload: mustMarshalPayloadForTest(t, map[string]any{"user_id": owner.ID}),
	})
	var userPayload appGetUserResponse
	if err := json.Unmarshal(userResponse.Payload, &userPayload); err != nil || userPayload.User.ID != owner.ID {
		t.Fatalf("users.get payload = %#v, err = %v", userPayload, err)
	}
	deniedUser := sendRawAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "users-get-outsider",
		Method:  appMethodUsersGet,
		Payload: mustMarshalPayloadForTest(t, map[string]any{"user_id": outsider.ID}),
	})
	requireAppErrorResponse(t, deniedUser, "not_found")

	applicationResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "apps-get-self",
		Method:  appMethodAppsGet,
		Payload: mustMarshalPayloadForTest(t, map[string]any{"app_id": app.ID}),
	})
	var applicationPayload appGetApplicationResponse
	if err := json.Unmarshal(applicationResponse.Payload, &applicationPayload); err != nil || applicationPayload.App.ID != app.ID {
		t.Fatalf("apps.get payload = %#v, err = %v", applicationPayload, err)
	}

	createResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-owned-group-create",
		Method: appMethodGroupConversationsCreate,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"name": " 应用运营群 ", "member_ids": []string{owner.ID},
		}),
	})
	var created appGroupMutationResponse
	if err := json.Unmarshal(createResponse.Payload, &created); err != nil {
		t.Fatalf("unmarshal created group: %v", err)
	}
	conversationID := created.Conversation.ID
	if conversationID == "" || created.Conversation.Name != "应用运营群" ||
		created.Conversation.Owner.Type != store.ConversationMemberTypeApp ||
		created.Conversation.Owner.ID != app.ID || created.Conversation.CurrentAppRole != store.ConversationMemberRoleOwner ||
		created.Conversation.CreatedBy.Type != store.ConversationMemberTypeApp || created.Conversation.CreatedBy.ID != app.ID {
		t.Fatalf("created group = %#v", created.Conversation)
	}
	var storedConversation store.Conversation
	if err := db.First(&storedConversation, "id = ?", conversationID).Error; err != nil {
		t.Fatalf("load created group: %v", err)
	}
	if storedConversation.CreatedByAppID == nil || *storedConversation.CreatedByAppID != app.ID {
		t.Fatalf("created_by_app_id = %#v, want %s", storedConversation.CreatedByAppID, app.ID)
	}

	addResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-group-members-add",
		Method: appMethodGroupMembersAdd,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"conversation_id": conversationID, "member_ids": []string{member.ID},
		}),
	})
	var added appGroupMutationResponse
	if err := json.Unmarshal(addResponse.Payload, &added); err != nil || added.Conversation.MemberCount != 4 {
		t.Fatalf("members.add = %#v, err = %v", added, err)
	}

	listResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-conversations-list",
		Method: appMethodConversationsList, Payload: mustMarshalPayloadForTest(t, map[string]any{}),
	})
	var listed appListConversationsResponse
	if err := json.Unmarshal(listResponse.Payload, &listed); err != nil || len(listed.Conversations) != 1 || listed.Conversations[0].ConversationID != conversationID {
		t.Fatalf("conversations.list = %#v, err = %v", listed, err)
	}

	membersResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-group-members-list",
		Method:  appMethodGroupMembersList,
		Payload: mustMarshalPayloadForTest(t, map[string]any{"conversation_id": conversationID}),
	})
	var members appListGroupMembersResponse
	if err := json.Unmarshal(membersResponse.Payload, &members); err != nil || members.Total != 4 || len(members.Members) != 4 {
		t.Fatalf("members.list = %#v, err = %v", members, err)
	}

	roleResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-group-set-admin",
		Method: appMethodGroupMembersSetRole,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"conversation_id": conversationID, "member_type": "user",
			"member_id": owner.ID, "role": "admin",
		}),
	})
	var roleUpdated appGroupMutationResponse
	if err := json.Unmarshal(roleResponse.Payload, &roleUpdated); err != nil || roleUpdated.Conversation.ID != conversationID {
		t.Fatalf("members.set_role = %#v, err = %v", roleUpdated, err)
	}
	var storedAdmin store.ConversationMember
	if err := db.First(&storedAdmin,
		"conversation_id = ? AND member_type = ? AND member_id = ?", conversationID, store.ConversationMemberTypeUser, owner.ID,
	).Error; err != nil || storedAdmin.Role != store.ConversationMemberRoleAdmin {
		t.Fatalf("stored admin = %#v, err = %v", storedAdmin, err)
	}

	updateResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-group-update",
		Method: appMethodGroupConversationsUpdate,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"conversation_id": conversationID, "name": "应用管理群",
		}),
	})
	var updated appGroupMutationResponse
	if err := json.Unmarshal(updateResponse.Payload, &updated); err != nil || updated.Conversation.Name != "应用管理群" {
		t.Fatalf("group update = %#v, err = %v", updated, err)
	}

	announcementResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-group-announcement-update",
		Method: appMethodGroupConversationsUpdate,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"conversation_id": conversationID, "announcement": "  应用发布公告 🚀  ",
		}),
	})
	var announcementUpdated appGroupMutationResponse
	if err := json.Unmarshal(announcementResponse.Payload, &announcementUpdated); err != nil ||
		announcementUpdated.Conversation.Announcement != "应用发布公告 🚀" || announcementUpdated.Message == nil ||
		announcementUpdated.Message.Summary != "Group Operator 更新了群公告" {
		t.Fatalf("announcement update = %#v, err = %v", announcementUpdated, err)
	}

	nullAnnouncementResponse := sendRawAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-group-announcement-null",
		Method: appMethodGroupConversationsUpdate,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"conversation_id": conversationID, "announcement": nil,
		}),
	})
	requireAppErrorResponse(t, nullAnnouncementResponse, "invalid_request")

	sendResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-group-message",
		Method: appMethodMessageSend,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"target":  map[string]any{"type": "conversation", "conversation_id": conversationID},
			"message": map[string]any{"type": "text", "content": "应用群消息"},
		}),
	})
	var sent appSendMessageResponse
	if err := json.Unmarshal(sendResponse.Payload, &sent); err != nil || sent.Conversation.ID != conversationID || sent.Message.Summary != "应用群消息" {
		t.Fatalf("message.send = %#v, err = %v", sent, err)
	}

	removeResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-group-member-remove",
		Method: appMethodGroupMembersRemove,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"conversation_id": conversationID, "member_type": "user", "member_id": member.ID,
		}),
	})
	var removed appGroupMutationResponse
	if err := json.Unmarshal(removeResponse.Payload, &removed); err != nil || removed.Conversation.MemberCount != 3 {
		t.Fatalf("members.remove = %#v, err = %v", removed, err)
	}

	getResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-group-get",
		Method:  appMethodGroupConversationsGet,
		Payload: mustMarshalPayloadForTest(t, map[string]any{"conversation_id": conversationID}),
	})
	var got appGetGroupResponse
	if err := json.Unmarshal(getResponse.Payload, &got); err != nil || got.Conversation.Name != "应用管理群" ||
		got.Conversation.Announcement != "应用发布公告 🚀" {
		t.Fatalf("group get = %#v, err = %v", got, err)
	}

	dissolveResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-group-dissolve",
		Method:  appMethodGroupConversationsDissolve,
		Payload: mustMarshalPayloadForTest(t, map[string]any{"conversation_id": conversationID}),
	})
	var dissolved appDissolveGroupResponse
	if err := json.Unmarshal(dissolveResponse.Payload, &dissolved); err != nil || dissolved.ConversationID != conversationID {
		t.Fatalf("group dissolve = %#v, err = %v", dissolved, err)
	}
}

func TestThirdPartyApplicationCannotCreateGroupWithInvisibleUser(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Date(2026, 7, 20, 9, 0, 0, 0, time.UTC)
	owner := insertTestUser(t, db, "private-app-owner@example.com", "Owner", store.UserStatusActive, now)
	other := insertTestUser(t, db, "private-app-other@example.com", "Other", store.UserStatusActive, now)
	ownerID := owner.ID
	app := insertTestApp(t, db, store.App{
		Name: "Private App", CreatorUserID: &ownerID, Enabled: true,
		Visibility: store.AppVisibilityCreator, ConnectionSecret: "private-app-secret",
		CreatedAt: now, UpdatedAt: now,
	})
	conn := dialAppWebSocket(t, server, app.ID, app.ConnectionSecret)
	response := sendRawAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest,
		ID: "private-app-create-group-" + uuid.NewString(), Method: appMethodGroupConversationsCreate,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"name": "越权群", "member_ids": []string{other.ID},
		}),
	})
	requireAppErrorResponse(t, response, "forbidden")
}

func TestThirdPartyApplicationCanRemoveDisabledUserButNotLastActiveUser(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC)
	active := insertTestUser(t, db, "app-group-active@example.com", "Active", store.UserStatusActive, now)
	disabled := insertTestUser(t, db, "app-group-disabled@example.com", "Disabled", store.UserStatusActive, now)
	app := insertTestApp(t, db, store.App{
		Name: "Group Operator", Enabled: true, Visibility: store.AppVisibilityPublic,
		ConnectionSecret: "group-user-removal-secret", CreatedAt: now, UpdatedAt: now,
	})
	conn := dialAppWebSocket(t, server, app.ID, app.ConnectionSecret)

	createResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-group-user-removal-create",
		Method: appMethodGroupConversationsCreate,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"name": "成员状态测试群", "member_ids": []string{active.ID, disabled.ID},
		}),
	})
	var created appGroupMutationResponse
	if err := json.Unmarshal(createResponse.Payload, &created); err != nil || created.Conversation.ID == "" {
		t.Fatalf("create group = %#v, err = %v", created, err)
	}
	if err := db.Model(&store.User{}).Where("id = ?", disabled.ID).
		Update("status", store.UserStatusDisabled).Error; err != nil {
		t.Fatalf("disable user: %v", err)
	}

	removeDisabledResponse := sendAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-group-remove-disabled-user",
		Method: appMethodGroupMembersRemove,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"conversation_id": created.Conversation.ID,
			"member_type":     "user",
			"member_id":       disabled.ID,
		}),
	})
	var removed appGroupMutationResponse
	if err := json.Unmarshal(removeDisabledResponse.Payload, &removed); err != nil || removed.Conversation.MemberCount != 3 {
		t.Fatalf("remove disabled user = %#v, err = %v", removed, err)
	}

	removeLastActiveResponse := sendRawAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "app-group-remove-last-active-user",
		Method: appMethodGroupMembersRemove,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"conversation_id": created.Conversation.ID,
			"member_type":     "user",
			"member_id":       active.ID,
		}),
	})
	requireAppErrorResponse(t, removeLastActiveResponse, "conflict")
}
