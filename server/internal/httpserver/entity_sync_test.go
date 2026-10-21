package httpserver

import (
	"context"
	"net/http"
	"testing"
	"time"

	"app/internal/application/entitysync"
	"app/internal/appregistry"
	"app/internal/realtime"
	"app/internal/store"
)

func TestEntitySyncResolvesLiveUserAndAppPresence(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Now().UTC()
	viewer := insertTestUser(t, db, "viewer@entity-presence.test", "Viewer", store.UserStatusActive, now)
	peer := insertTestUser(t, db, "peer@entity-presence.test", "Peer", store.UserStatusActive, now)
	viewerCookie := loginAsUser(t, server, viewer.Email)
	peerCookie := loginAsUser(t, server, peer.Email)

	findOnline := func(body map[string]any, field, id string) bool {
		t.Helper()
		for _, raw := range body["data"].(map[string]any)[field].([]any) {
			row := raw.(map[string]any)
			if row["id"] == id {
				online, ok := row["online"].(bool)
				if !ok {
					t.Fatalf("missing online flag: %v", row)
				}
				return online
			}
		}
		t.Fatalf("missing %s %s: %v", field, id, body)
		return false
	}
	ordinaryPresence := func() (bool, bool) {
		t.Helper()
		response, users := postJSON(t, server, "/api/client/users/resolve", map[string]any{"user_ids": []string{peer.ID}}, viewerCookie)
		if response.StatusCode != http.StatusOK {
			t.Fatalf("resolve users status=%d body=%v", response.StatusCode, users)
		}
		response, contacts := getJSON(t, server, "/api/client/contacts", viewerCookie)
		if response.StatusCode != http.StatusOK {
			t.Fatalf("contacts status=%d body=%v", response.StatusCode, contacts)
		}
		return findOnline(users, "users", peer.ID), findOnline(contacts, "apps", appregistry.AIAssistantAppID)
	}
	waitForPresence := func(want bool) {
		t.Helper()
		deadline := time.Now().Add(2 * time.Second)
		for {
			userOnline, appOnline := ordinaryPresence()
			if userOnline == want && appOnline == want {
				return
			}
			if time.Now().After(deadline) {
				t.Fatalf("ordinary presence: user=%v app=%v, want %v", userOnline, appOnline, want)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	assertEntityPresence := func(want bool) {
		t.Helper()
		response, body := postJSON(t, server, "/api/client/entities/resolve", map[string]any{
			"entities": []map[string]string{{"type": "user", "id": peer.ID}, {"type": "app", "id": appregistry.AIAssistantAppID}},
		}, viewerCookie)
		if response.StatusCode != http.StatusOK {
			t.Fatalf("resolve entities status=%d body=%v", response.StatusCode, body)
		}
		userOnline := findOnline(body, "users", peer.ID)
		appOnline := findOnline(body, "apps", appregistry.AIAssistantAppID)
		if userOnline != want || appOnline != want {
			t.Fatalf("entity presence: user=%v app=%v, want %v", userOnline, appOnline, want)
		}
	}

	waitForPresence(false)
	assertEntityPresence(false)
	peerSocket := dialClientWebSocket(t, server, peerCookie)
	defer peerSocket.Close()
	appSocket := dialAppWebSocket(t, server, appregistry.AIAssistantAppID, "test-ai-assistant-secret")
	defer appSocket.Close()
	waitForPresence(true)
	assertEntityPresence(true)
	waitForPresence(true)

	_ = peerSocket.Close()
	_ = appSocket.Close()
	waitForPresence(false)
	assertEntityPresence(false)
}

func TestEntitySyncResolvesAuthoritativeRoleWithoutLeakingPrivateGroup(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Now().UTC()
	owner := insertTestUser(t, db, "owner@entity.test", "Owner", store.UserStatusActive, now)
	member := insertTestUser(t, db, "member@entity.test", "Member", store.UserStatusActive, now)
	outsider := insertTestUser(t, db, "outsider@entity.test", "Outsider", store.UserStatusActive, now)
	group := insertTestConversation(t, db, testConversationInput{createdByUserID: owner.ID, kind: store.ConversationKindGroup, memberIDs: []string{owner.ID, member.ID}, name: "Private", now: now})
	if err := db.Model(&store.ConversationMember{}).Where("conversation_id = ? AND member_id = ?", group.ID, member.ID).Update("role", store.ConversationMemberRoleAdmin).Error; err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"entities": []map[string]string{{"type": "group", "id": group.ID}}}
	response, envelope := postJSON(t, server, "/api/client/entities/resolve", body, loginAsUser(t, server, member.Email))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("resolve status=%d body=%v", response.StatusCode, envelope)
	}
	data := envelope["data"].(map[string]any)
	conversations := data["conversations"].([]any)
	if len(conversations) != 1 || data["versions"].(map[string]any)["group:"+group.ID].(float64) < 3 {
		t.Fatalf("missing versioned conversation: %v", data)
	}
	foundAdmin := false
	for _, raw := range conversations[0].(map[string]any)["members"].([]any) {
		value := raw.(map[string]any)
		if value["id"] == member.ID && value["role"] == "admin" {
			foundAdmin = true
		}
	}
	if !foundAdmin {
		t.Fatal("authoritative administrator role missing")
	}
	_, envelope = postJSON(t, server, "/api/client/entities/resolve", body, loginAsUser(t, server, outsider.Email))
	data = envelope["data"].(map[string]any)
	if len(data["groups"].([]any)) != 0 || len(data["conversations"].([]any)) != 0 || len(data["versions"].(map[string]any)) != 0 || len(data["removed"].([]any)) != 1 {
		t.Fatalf("private group leaked to outsider: %v", data)
	}
	if err := db.Model(&store.Conversation{}).Where("id = ?", group.ID).Update("visibility", store.ConversationVisibilityPublic).Error; err != nil {
		t.Fatal(err)
	}
	_, envelope = postJSON(t, server, "/api/client/entities/resolve", body, loginAsUser(t, server, outsider.Email))
	data = envelope["data"].(map[string]any)
	if len(data["groups"].([]any)) != 1 || len(data["conversations"].([]any)) != 0 {
		t.Fatalf("public nonmember should receive directory metadata only: %v", data)
	}
}

func TestEntityChangesReachAllMemberDevicesAndRetainConcurrentRevision(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Now().UTC()
	owner := insertTestUser(t, db, "owner@delivery.test", "Owner", store.UserStatusActive, now)
	member := insertTestUser(t, db, "member@delivery.test", "Member", store.UserStatusActive, now)
	group := insertTestConversation(t, db, testConversationInput{createdByUserID: owner.ID, kind: store.ConversationKindGroup, memberIDs: []string{owner.ID, member.ID}, name: "Private", now: now})
	pool := realtime.NewConnectionPool(realtime.Options{})
	first := realtime.NewConnection("first", member.ID, 10, nil)
	second := realtime.NewConnection("second", member.ID, 10, nil)
	stranger := realtime.NewConnection("stranger", "00000000-0000-0000-0000-000000000099", 10, nil)
	pool.Register(first)
	pool.Register(second)
	pool.Register(stranger)
	sync := entitysync.NewService(entitysync.Dependencies{DB: db})
	s := &Server{db: db, realtime: pool, entitySync: sync}
	seedChanges, err := sync.Pending(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range seedChanges {
		if change.Event == store.ClientDirectoryUpdatedEvent {
			if err := sync.Acknowledge(context.Background(), change); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := s.dispatchEntityChanges(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, conn := range []*realtime.Connection{first, second} {
		select {
		case event := <-conn.Outgoing():
			if event.Event != "conversation.members.updated" {
				t.Fatalf("unexpected event: %s", event.Event)
			}
		default:
			t.Fatal("member device did not receive change")
		}
	}
	select {
	case <-stranger.Outgoing():
		t.Fatal("private group event leaked")
	default:
	}
	if err := db.Model(&store.Conversation{}).Where("id = ?", group.ID).Update("avatar", "first.webp").Error; err != nil {
		t.Fatal(err)
	}
	pending, err := sync.Pending(context.Background())
	if err != nil || len(pending) != 1 {
		t.Fatalf("pending=%v err=%v", pending, err)
	}
	if err := db.Model(&store.Conversation{}).Where("id = ?", group.ID).Update("avatar", "second.webp").Error; err != nil {
		t.Fatal(err)
	}
	if err := sync.Acknowledge(context.Background(), pending[0]); err != nil {
		t.Fatal(err)
	}
	latest, err := sync.Pending(context.Background())
	if err != nil || len(latest) != 1 || latest[0].Revision <= pending[0].Revision {
		t.Fatalf("acknowledgment consumed newer change: %+v err=%v", latest, err)
	}
	if err := db.Model(&store.ConversationMember{}).Where("conversation_id = ? AND member_id = ?", group.ID, member.ID).Update("left_at", now).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.dispatchEntityChanges(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, conn := range []*realtime.Connection{first, second} {
		select {
		case event := <-conn.Outgoing():
			if event.Event != "conversation.removed" {
				t.Fatalf("removed user received non-removal event: %s", event.Event)
			}
		default:
			t.Fatal("departed user's other device was not notified")
		}
	}
}

func TestPrivateAppAvatarRefreshesContainingGroupWithoutExposingAppDirectory(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Now().UTC()
	owner := insertTestUser(t, db, "owner@app-avatar.test", "Owner", store.UserStatusActive, now)
	member := insertTestUser(t, db, "member@app-avatar.test", "Member", store.UserStatusActive, now)
	app := insertTestApp(t, db, store.App{CreatorUserID: &owner.ID, Enabled: true, Name: "Private app", Visibility: store.AppVisibilityCreator, CreatedAt: now, UpdatedAt: now})
	group := insertTestConversation(t, db, testConversationInput{createdByUserID: owner.ID, kind: store.ConversationKindGroup, memberIDs: []string{owner.ID, member.ID}, name: "Group", now: now})
	if err := db.Create(&store.ConversationMember{ConversationID: group.ID, MemberType: store.ConversationMemberTypeApp, MemberID: app.ID, Role: store.ConversationMemberRoleMember, JoinedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	sync := entitysync.NewService(entitysync.Dependencies{DB: db})
	pending, err := sync.Pending(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range pending {
		if err := sync.Acknowledge(context.Background(), change); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(&store.App{}).Where("id = ?", app.ID).Update("avatar", "/avatars/private-new.webp").Error; err != nil {
		t.Fatal(err)
	}
	pending, err = sync.Pending(context.Background())
	if err != nil || len(pending) != 2 {
		t.Fatalf("app update must also refresh containing group: %+v err=%v", pending, err)
	}
	for _, change := range pending {
		recipients, err := sync.Recipients(context.Background(), change, []string{owner.ID, member.ID})
		if err != nil {
			t.Fatal(err)
		}
		if change.Type == "app" && (len(recipients) != 1 || recipients[0] != owner.ID) {
			t.Fatalf("private app event leaked: %v", recipients)
		}
		if change.Type == "group" && len(recipients) != 2 {
			t.Fatalf("group app avatar change missed members: %v", recipients)
		}
	}
	_, envelope := postJSON(t, server, "/api/client/entities/resolve", map[string]any{
		"entities": []map[string]string{{"type": "app", "id": app.ID}, {"type": "group", "id": group.ID}},
	}, loginAsUser(t, server, member.Email))
	data := envelope["data"].(map[string]any)
	if len(data["apps"].([]any)) != 0 {
		t.Fatal("private app was added to member's directory")
	}
	conversation := data["conversations"].([]any)[0].(map[string]any)
	var avatar string
	for _, value := range conversation["members"].([]any) {
		entry := value.(map[string]any)
		if entry["id"] == app.ID {
			avatar, _ = entry["avatar"].(string)
		}
	}
	if avatar != "/avatars/private-new.webp" {
		t.Fatalf("authorized group snapshot has stale app avatar: %q", avatar)
	}
}
