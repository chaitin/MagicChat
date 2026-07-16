package httpserver

import (
	"testing"
	"time"

	"app/internal/realtime"
	"app/internal/store"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

func TestThirdPartyAppWebSocketAllowsOnlyPublicRPCMethods(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC)
	app := insertTestApp(t, db, store.App{
		Name: "Third Party", Enabled: true, Visibility: store.AppVisibilityPublic,
		ConnectionSecret: "third-party-secret", CreatedAt: now, UpdatedAt: now,
	})
	conn := dialAppWebSocket(t, server, app.ID, app.ConnectionSecret)

	for _, method := range []string{
		appMethodMessageSend,
		appMethodConversationMessagesList,
		appMethodTemporaryFilesReadURLs,
		appMethodEventsAck,
	} {
		t.Run("allowed_"+method, func(t *testing.T) {
			response := sendRawAppRequest(t, conn, realtime.Envelope{
				V: realtime.ProtocolVersion, Kind: realtime.KindRequest,
				ID: "allowed-" + uuid.NewString(), Method: method,
				Payload: mustMarshalPayloadForTest(t, map[string]any{}),
			})
			if response.Error == nil || response.Error.Code == "forbidden" {
				t.Fatalf("response = %#v, want method to reach its own validation", response)
			}
		})
	}

	for _, method := range []string{
		appMethodMessageSendAsUser,
		appMethodContactsUsersList,
		appMethodContactsAppsList,
		appMethodContactsGroupsList,
		appMethodConversationsList,
		appMethodConversationHistoryRead,
		appMethodGroupConversationsList,
		appMethodGroupConversationsCreate,
		appMethodGroupMembersAdd,
		appMethodProjectsList,
		appMethodProjectsCreate,
		appMethodProjectGroupsGrant,
		appMethodProjectTasksList,
		appMethodProjectTasksCreate,
		appMethodProjectTasksUpdate,
		"unknown.third_party.method",
	} {
		t.Run("forbidden_"+method, func(t *testing.T) {
			response := sendRawAppRequest(t, conn, realtime.Envelope{
				V: realtime.ProtocolVersion, Kind: realtime.KindRequest,
				ID: "forbidden-" + uuid.NewString(), Method: method,
				Payload: mustMarshalPayloadForTest(t, map[string]any{}),
			})
			requireAppErrorResponse(t, response, "forbidden")
		})
	}

	user := insertTestUser(t, db, "third-party-runas@example.com", "RunAs", store.UserStatusActive, now)
	conversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: user.ID, kind: store.ConversationKindApp,
		memberIDs: []string{user.ID}, name: app.Name, now: now,
	})
	insertTestAppConversationMember(t, db, app.ID, conversation.ID, now)
	runAsResponse := sendRawAppRequest(t, conn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest,
		ID: "third-party-runas", Method: appMethodConversationMessagesList,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"conversation_id": conversation.ID, "before_or_equal_seq": 1,
			"runas": map[string]any{
				"type": "user", "id": user.ID, "trigger_message_id": uuid.NewString(),
				"authorization_conversation_id": conversation.ID,
			},
		}),
	})
	requireAppErrorResponse(t, runAsResponse, "forbidden")
}

func TestThirdPartyAppMessageSendEnforcesUserVisibility(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Date(2026, 7, 16, 12, 30, 0, 0, time.UTC)
	owner := insertTestUser(t, db, "app-owner@example.com", "Owner", store.UserStatusActive, now)
	granted := insertTestUser(t, db, "app-granted@example.com", "Granted", store.UserStatusActive, now)
	other := insertTestUser(t, db, "app-other@example.com", "Other", store.UserStatusActive, now)
	ownerID := owner.ID

	creatorApp := insertTestApp(t, db, store.App{
		Name: "Creator App", CreatorUserID: &ownerID, Enabled: true,
		Visibility: store.AppVisibilityCreator, ConnectionSecret: "creator-secret",
		CreatedAt: now, UpdatedAt: now,
	})
	restrictedApp := insertTestApp(t, db, store.App{
		Name: "Restricted App", CreatorUserID: &ownerID, Enabled: true,
		Visibility: store.AppVisibilityRestricted, ConnectionSecret: "restricted-secret",
		CreatedAt: now, UpdatedAt: now,
	})
	if err := db.Create(&store.AppUserGrant{
		AppID: restrictedApp.ID, UserID: granted.ID, GrantedByUserID: &ownerID, CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("create app grant: %v", err)
	}
	publicApp := insertTestApp(t, db, store.App{
		Name: "Public App", CreatorUserID: &ownerID, Enabled: true,
		Visibility: store.AppVisibilityPublic, ConnectionSecret: "public-secret",
		CreatedAt: now, UpdatedAt: now,
	})

	creatorConn := dialAppWebSocket(t, server, creatorApp.ID, creatorApp.ConnectionSecret)
	restrictedConn := dialAppWebSocket(t, server, restrictedApp.ID, restrictedApp.ConnectionSecret)
	publicConn := dialAppWebSocket(t, server, publicApp.ID, publicApp.ConnectionSecret)
	send := func(conn *websocket.Conn, requestID string, userID string) realtime.Envelope {
		return sendRawAppRequest(t, conn, realtime.Envelope{
			V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: requestID,
			Method: appMethodMessageSend,
			Payload: mustMarshalPayloadForTest(t, map[string]any{
				"target":  map[string]any{"type": "user", "user_id": userID},
				"message": map[string]any{"type": "text", "content": "hello"},
			}),
		})
	}

	for _, test := range []struct {
		name   string
		conn   *websocket.Conn
		userID string
	}{
		{name: "creator can contact owner", conn: creatorConn, userID: owner.ID},
		{name: "restricted can contact owner", conn: restrictedConn, userID: owner.ID},
		{name: "restricted can contact grant", conn: restrictedConn, userID: granted.ID},
		{name: "public can contact any user", conn: publicConn, userID: other.ID},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := send(test.conn, "send-"+uuid.NewString(), test.userID)
			if response.OK == nil || !*response.OK {
				t.Fatalf("response = %#v, want success", response)
			}
		})
	}

	for _, test := range []struct {
		name string
		conn *websocket.Conn
	}{
		{name: "creator cannot contact other", conn: creatorConn},
		{name: "restricted cannot contact ungranted", conn: restrictedConn},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := send(test.conn, "deny-"+uuid.NewString(), other.ID)
			requireAppErrorResponse(t, response, "forbidden")
		})
	}

	forbiddenCard := sendRawAppRequest(t, publicConn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: "forbidden-card",
		Method: appMethodMessageSend,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"target":  map[string]any{"type": "user", "user_id": other.ID},
			"message": map[string]any{"type": "entity_card", "entity_type": "user", "entity_id": other.ID},
		}),
	})
	requireAppErrorResponse(t, forbiddenCard, "forbidden")
}
