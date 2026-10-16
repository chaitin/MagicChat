package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"testing"
	"time"

	"app/internal/application/entitysync"
	"app/internal/realtime"
	"app/internal/store"
)

func TestDirectoryRegistrationNotifiesEveryOnlineDeviceWithoutProfilePayload(t *testing.T) {
	router, db := newTestRouter(t)
	defer router.Close()
	now := time.Now().UTC()
	viewer := insertTestUser(t, db, "viewer@discovery.test", "Viewer", store.UserStatusActive, now)
	sync := entitysync.NewService(db)
	seed, err := sync.Pending(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range seed {
		if err := sync.Acknowledge(context.Background(), change); err != nil {
			t.Fatal(err)
		}
	}
	pool := realtime.NewConnectionPool(realtime.Options{})
	first := realtime.NewConnection("first", viewer.ID, 10, nil)
	second := realtime.NewConnection("second", viewer.ID, 10, nil)
	pool.Register(first)
	pool.Register(second)
	newUser := insertTestUser(t, db, "new@discovery.test", "New", store.UserStatusActive, now)
	s := &Server{db: db, realtime: pool, entitySync: sync}
	if err := s.dispatchEntityChanges(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, connection := range []*realtime.Connection{first, second} {
		select {
		case event := <-connection.Outgoing():
			var payload map[string]interface{}
			if err := json.Unmarshal(event.Payload, &payload); err != nil {
				t.Fatal(err)
			}
			if event.Event != store.ClientDirectoryUpdatedEvent || payload["scope"] != "users" || payload["revision"] != float64(1) || len(payload) != 3 {
				t.Fatalf("invalid directory hint: %s %v", event.Event, payload)
			}
		default:
			t.Fatal("new registration did not invalidate every device's directory")
		}
	}
	response, body := getJSON(t, router, "/api/client/contacts", loginAsUser(t, router, viewer.Email))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("directory status=%d body=%v", response.StatusCode, body)
	}
	found := false
	for _, id := range body["data"].(map[string]interface{})["user_ids"].([]interface{}) {
		found = found || id == newUser.ID
	}
	if !found {
		t.Fatal("directory reconciliation did not discover the registered user")
	}
}

func TestDirectoryFriendsModeDoesNotBroadcastStrangerRegistrations(t *testing.T) {
	router, db := newTestRouter(t)
	defer router.Close()
	now := time.Now().UTC()
	viewer := insertTestUser(t, db, "viewer@friends-discovery.test", "Viewer", store.UserStatusActive, now)
	friend := insertTestUser(t, db, "friend@friends-discovery.test", "Friend", store.UserStatusActive, now)
	stranger := insertTestUser(t, db, "stranger@friends-discovery.test", "Stranger", store.UserStatusActive, now)
	if err := db.Save(&store.AppSettings{ID: store.AppSettingsID, AppName: "Test", OrganizationName: "Test", ContactDirectoryMode: store.ContactDirectoryModeFriends}).Error; err != nil {
		t.Fatal(err)
	}
	low, high := viewer.ID, friend.ID
	if low > high {
		low, high = high, low
	}
	if err := db.Create(&store.UserFriendship{UserIDLow: low, UserIDHigh: high, CreatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	sync := entitysync.NewService(db)
	online := []string{viewer.ID, friend.ID, stranger.ID}
	recipients, err := sync.Recipients(context.Background(), store.ClientEntityChange{Type: store.ClientDirectoryUsers, EntityID: stranger.ID}, online)
	if err != nil || slices.Contains(recipients, viewer.ID) || slices.Contains(recipients, friend.ID) {
		t.Fatalf("stranger discovery leaked to friend directory: %v, %v", recipients, err)
	}
	recipients, err = sync.Recipients(context.Background(), store.ClientEntityChange{Type: store.ClientDirectoryUsers, EntityID: friend.ID}, online)
	if err != nil || !slices.Contains(recipients, viewer.ID) || slices.Contains(recipients, stranger.ID) {
		t.Fatalf("friend activation did not refresh the right viewers: %v, %v", recipients, err)
	}
	response, body := getJSON(t, router, "/api/client/contacts", loginAsUser(t, router, viewer.Email))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("directory status=%d body=%v", response.StatusCode, body)
	}
	for _, id := range body["data"].(map[string]interface{})["user_ids"].([]interface{}) {
		if id == stranger.ID {
			t.Fatal("directory refresh inserted a stranger into friends")
		}
	}
}

func TestDirectoryAppDiscoveryAndRevocationRespectPermissions(t *testing.T) {
	router, db := newTestRouter(t)
	defer router.Close()
	now := time.Now().UTC()
	owner := insertTestUser(t, db, "owner@app-discovery.test", "Owner", store.UserStatusActive, now)
	viewer := insertTestUser(t, db, "viewer@app-discovery.test", "Viewer", store.UserStatusActive, now)
	outsider := insertTestUser(t, db, "outsider@app-discovery.test", "Outsider", store.UserStatusActive, now)
	app := insertTestApp(t, db, store.App{CreatorUserID: &owner.ID, Name: "Restricted", Visibility: store.AppVisibilityRestricted, Enabled: true, CreatedAt: now, UpdatedAt: now})
	sync := entitysync.NewService(db)
	online := []string{owner.ID, viewer.ID, outsider.ID}
	change := store.ClientEntityChange{Type: store.ClientDirectoryApps, EntityID: app.ID}
	recipients, err := sync.Recipients(context.Background(), change, online)
	if err != nil || len(recipients) != 1 || recipients[0] != owner.ID {
		t.Fatalf("private application discovery leaked: %v, %v", recipients, err)
	}
	grant := store.AppUserGrant{AppID: app.ID, UserID: viewer.ID, GrantedByUserID: &owner.ID, CreatedAt: now}
	if err := db.Create(&grant).Error; err != nil {
		t.Fatal(err)
	}
	for _, granted := range []bool{true, false} {
		if !granted {
			if err := db.Delete(&grant).Error; err != nil {
				t.Fatal(err)
			}
		}
		var targeted store.ClientEntityChange
		if err := db.Where("type = ? AND entity_id = ? AND recipient_id = ?", store.ClientDirectoryApps, app.ID, viewer.ID).Take(&targeted).Error; err != nil {
			t.Fatal(err)
		}
		recipients, err := sync.Recipients(context.Background(), targeted, online)
		if err != nil || len(recipients) != 1 || recipients[0] != viewer.ID {
			t.Fatalf("grant change missed affected viewer: %v, %v", recipients, err)
		}
		response, body := getJSON(t, router, "/api/client/contacts", loginAsUser(t, router, viewer.Email))
		if response.StatusCode != http.StatusOK {
			t.Fatalf("directory status=%d body=%v", response.StatusCode, body)
		}
		found := false
		for _, value := range body["data"].(map[string]interface{})["apps"].([]interface{}) {
			found = found || value.(map[string]interface{})["id"] == app.ID
		}
		if found != granted {
			t.Fatalf("grant=%v, app in authoritative directory=%v", granted, found)
		}
	}
	if err := db.Model(&store.App{}).Where("id = ?", app.ID).Update("visibility", store.AppVisibilityPublic).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&store.App{}).Where("id = ?", app.ID).Update("visibility", store.AppVisibilityCreator).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("type = ? AND entity_id = ? AND recipient_id = ''", store.ClientDirectoryApps, app.ID).Take(&change).Error; err != nil {
		t.Fatal(err)
	}
	recipients, err = sync.Recipients(context.Background(), change, online)
	if err != nil || !change.Public || len(recipients) != 3 {
		t.Fatalf("formerly public application was not invalidated for previous viewers: %v, %v", recipients, err)
	}
}
