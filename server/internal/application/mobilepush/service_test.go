package mobilepush

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"app/internal/store"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type MessageDelivery struct {
	UserID         string
	ActorUserID    string
	ConversationID string
	MessageID      string
	SenderType     string
	SenderID       string
	Muted          bool
}

type gatewayCall struct {
	GrantID        string
	SendToken      string
	IdempotencyKey string
	Notification   NotificationRequest
}

type fakeGateway struct {
	mu    sync.Mutex
	calls []gatewayCall
	err   error
}

func (g *fakeGateway) Send(_ context.Context, grantID, sendToken, idempotencyKey string, notification NotificationRequest) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.calls = append(g.calls, gatewayCall{
		GrantID: grantID, SendToken: sendToken,
		IdempotencyKey: idempotencyKey, Notification: notification,
	})
	return g.err
}

func TestGrantRegistrationTransfersInstallationAndEncryptsCapability(t *testing.T) {
	service, db, _, now := newPushTestService(t)
	alice := insertPushUser(t, db, "alice@example.com")
	bob := insertPushUser(t, db, "bob@example.com")
	installationID := uuid.NewString()
	firstGrantID := uuid.NewString()
	first, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: alice.ID, InstallationID: installationID, GatewayGrantID: firstGrantID,
		SendToken: "first-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
		ExpiresAt: now.Add(24 * time.Hour),
	})
	if err != nil || first.GatewayGrantID != firstGrantID {
		t.Fatalf("first registration = %#v, err = %v", first, err)
	}
	secondGrantID := uuid.NewString()
	_, err = registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: bob.ID, InstallationID: installationID, GatewayGrantID: secondGrantID,
		SendToken: "second-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "android",
		ExpiresAt: now.Add(48 * time.Hour),
	})
	if err != nil {
		t.Fatalf("second registration: %v", err)
	}
	var stored store.UserPushGrant
	if err := db.First(&stored, "installation_id = ?", installationID).Error; err != nil {
		t.Fatalf("load grant: %v", err)
	}
	if stored.UserID != bob.ID || stored.GatewayGrantID != secondGrantID || string(stored.SendTokenCiphertext) == "second-send-token-abcdefghijklmnopqrstuvwxyz" {
		t.Fatalf("stored grant = %#v", stored)
	}
	decrypted, err := service.cipher.Decrypt(stored.SendTokenCiphertext, []byte(stored.ID))
	if err != nil || decrypted != "second-send-token-abcdefghijklmnopqrstuvwxyz" {
		t.Fatalf("decrypted send token = %q, %v", decrypted, err)
	}
}

func TestGrantRegistrationRequiresLiveSessionWhenProvided(t *testing.T) {
	service, db, gateway, now := newPushTestService(t)
	user := insertPushUser(t, db, "session-bound-grant@example.com")
	session := store.UserSession{
		ID: uuid.NewString(), TokenHash: uuid.NewString(), UserID: user.ID,
		ExpiresAt: now.Add(time.Hour), CreatedAt: now, LastSeenAt: now,
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatalf("create session: %v", err)
	}
	command := RegisterGrantCommand{
		UserID: user.ID, SessionID: session.ID,
		InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
		SendToken: "session-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
		ExpiresAt: now.Add(24 * time.Hour),
	}
	grant, err := registerPushTestGrant(t, service, db, command)
	if err != nil {
		t.Fatalf("register with live session: %v", err)
	}
	if !grant.ExpiresAt.Equal(session.ExpiresAt) {
		t.Fatalf("grant expiry = %v, want session expiry %v", grant.ExpiresAt, session.ExpiresAt)
	}
	var stored store.UserPushGrant
	if err := db.First(&stored, "gateway_grant_id = ?", command.GatewayGrantID).Error; err != nil || stored.SessionID != session.ID {
		t.Fatalf("stored session-bound grant = %#v, err = %v", stored, err)
	}
	other := insertPushUser(t, db, "session-bound-sender@example.com")
	conversation := insertPushConversation(t, db, user, other, now)
	if err := enqueueTestMessage(service, MessageDelivery{
		UserID: user.ID, ConversationID: conversation.ID, MessageID: uuid.NewString(),
		SenderType: store.MessageSenderTypeUser, SenderID: other.ID,
	}); err != nil {
		t.Fatalf("enqueue session-bound message: %v", err)
	}
	if err := db.Delete(&session).Error; err != nil {
		t.Fatalf("delete session: %v", err)
	}
	if _, err := service.DispatchBatch(t.Context(), 1); err != nil || len(gateway.calls) != 0 {
		t.Fatalf("dispatch after session deletion: calls=%#v err=%v", gateway.calls, err)
	}
	command.InstallationID = uuid.NewString()
	command.GatewayGrantID = uuid.NewString()
	if _, err := registerPushTestGrant(t, service, db, command); failureCode(err) != "unauthorized" {
		t.Fatalf("register after logout error = %v", err)
	}
}

func TestNativePushGrantSurvivesShortAccessExpiry(t *testing.T) {
	service, db, _, now := newPushTestService(t)
	user := insertPushUser(t, db, "native-push@example.com")
	hash := uuid.NewString()
	refreshExpiry := now.Add(30 * 24 * time.Hour)
	absoluteExpiry := now.Add(365 * 24 * time.Hour)
	session := store.UserSession{
		ID: uuid.NewString(), TokenHash: uuid.NewString(), UserID: user.ID,
		ExpiresAt: now.Add(time.Hour), RefreshTokenHash: &hash,
		RefreshExpiresAt: &refreshExpiry, RefreshAbsoluteExpiresAt: &absoluteExpiry,
		CreatedAt: now, LastSeenAt: now,
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	grant, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, SessionID: session.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
		SendToken: "native-push-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios", ExpiresAt: now.Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !grant.ExpiresAt.Equal(now.Add(24 * time.Hour)) {
		t.Fatalf("native grant expired with access token: %v", grant.ExpiresAt)
	}
	other := insertPushUser(t, db, "native-sender@example.com")
	conversation := insertPushConversation(t, db, user, other, now)
	laterGateway := &fakeGateway{}
	laterService, err := NewService(Dependencies{DB: db, Cipher: service.cipher, Gateway: laterGateway, Enabled: true, Now: func() time.Time { return now.Add(2 * time.Hour) }})
	if err != nil {
		t.Fatal(err)
	}
	if err := enqueueTestMessage(laterService, MessageDelivery{UserID: user.ID, ConversationID: conversation.ID, MessageID: uuid.NewString(), SenderType: store.MessageSenderTypeUser, SenderID: other.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := laterService.DispatchBatch(t.Context(), 1); err != nil || len(laterGateway.calls) != 1 {
		t.Fatalf("push after access expiry: %v calls=%d", err, len(laterGateway.calls))
	}
}

func TestStaleGrantRevocationCannotDeleteReplacement(t *testing.T) {
	service, db, _, now := newPushTestService(t)
	user := insertPushUser(t, db, "generation-safe-revoke@example.com")
	installationID := uuid.NewString()
	oldGrantID := uuid.NewString()
	if _, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, InstallationID: installationID, GatewayGrantID: oldGrantID,
		SendToken: "old-generation-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
		ExpiresAt: now.Add(time.Hour),
	}); err != nil {
		t.Fatalf("register old grant: %v", err)
	}
	newGrantID := uuid.NewString()
	if _, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, InstallationID: installationID, GatewayGrantID: newGrantID,
		SendToken: "new-generation-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
		ExpiresAt: now.Add(time.Hour),
	}); err != nil {
		t.Fatalf("register replacement grant: %v", err)
	}
	if err := service.RevokeGrant(t.Context(), user.ID, installationID, oldGrantID); err != nil {
		t.Fatalf("revoke stale grant: %v", err)
	}
	var stored store.UserPushGrant
	if err := db.First(&stored, "installation_id = ?", installationID).Error; err != nil {
		t.Fatalf("load replacement grant: %v", err)
	}
	if stored.GatewayGrantID != newGrantID {
		t.Fatalf("remaining grant = %#v", stored)
	}
}

func TestGrantRegistrationLimitsDevicesPerUser(t *testing.T) {
	service, db, _, now := newPushTestService(t)
	user := insertPushUser(t, db, "device-limit@example.com")
	for index := 0; index < maxGrantsPerUser; index++ {
		if _, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
			UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
			SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
			ExpiresAt: now.Add(time.Hour),
		}); err != nil {
			t.Fatalf("register grant %d: %v", index, err)
		}
	}
	if _, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
		SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
		ExpiresAt: now.Add(time.Hour),
	}); failureCode(err) != "grant_limit_reached" {
		t.Fatalf("grant beyond limit error = %v", err)
	}
}

func TestGrantRegistrationIgnoresDisabledDevicesAtLimit(t *testing.T) {
	service, db, _, now := newPushTestService(t)
	user := insertPushUser(t, db, "device-replacement@example.com")
	for index := 0; index < maxGrantsPerUser; index++ {
		if _, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
			UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
			SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
			ExpiresAt: now.Add(time.Hour),
		}); err != nil {
			t.Fatalf("register grant %d: %v", index, err)
		}
	}
	var disabled store.UserPushGrant
	if err := db.Where("user_id = ?", user.ID).First(&disabled).Error; err != nil {
		t.Fatalf("load grant to disable: %v", err)
	}
	if err := db.Model(&disabled).Updates(map[string]any{
		"status": GrantStatusDisabled, "updated_at": now,
	}).Error; err != nil {
		t.Fatalf("disable grant: %v", err)
	}
	if _, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
		SendToken: "replacement-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
		ExpiresAt: now.Add(time.Hour),
	}); err != nil {
		t.Fatalf("register replacement grant: %v", err)
	}
}

func TestGrantRegistrationCannotReactivateDisabledDeviceBeyondLimit(t *testing.T) {
	service, db, _, now := newPushTestService(t)
	user := insertPushUser(t, db, "reactivation-limit@example.com")
	for index := 0; index < maxGrantsPerUser; index++ {
		if _, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
			UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
			SendToken: "active-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
			ExpiresAt: now.Add(time.Hour),
		}); err != nil {
			t.Fatalf("register active grant %d: %v", index, err)
		}
	}
	disabled := store.UserPushGrant{
		ID: uuid.NewString(), UserID: user.ID, InstallationID: uuid.NewString(),
		GatewayGrantID: uuid.NewString(), SendTokenCiphertext: []byte("disabled"),
		Platform: "ios", ExpiresAt: now.Add(time.Hour), Status: GrantStatusDisabled,
		LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&disabled).Error; err != nil {
		t.Fatalf("create disabled grant: %v", err)
	}
	_, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, InstallationID: disabled.InstallationID, GatewayGrantID: uuid.NewString(),
		SendToken: "reactivated-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
		ExpiresAt: now.Add(time.Hour),
	})
	if failureCode(err) != "grant_limit_reached" {
		t.Fatalf("reactivate disabled grant error = %v", err)
	}
}

func TestGrantRegistrationDropsQueuedJobsWhenInstallationChangesOwner(t *testing.T) {
	service, db, _, now := newPushTestService(t)
	alice := insertPushUser(t, db, "queued-alice@example.com")
	bob := insertPushUser(t, db, "queued-bob@example.com")
	conversation := insertPushConversation(t, db, alice, bob, now)
	installationID := uuid.NewString()
	first, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: alice.ID, InstallationID: installationID, GatewayGrantID: uuid.NewString(),
		SendToken: "first-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
		ExpiresAt: now.Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("register first grant: %v", err)
	}
	if err := enqueueTestMessage(service, MessageDelivery{
		UserID: alice.ID, ConversationID: conversation.ID, MessageID: uuid.NewString(),
		SenderType: store.MessageSenderTypeUser, SenderID: bob.ID,
	}); err != nil {
		t.Fatalf("enqueue old-account message: %v", err)
	}
	second, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: bob.ID, InstallationID: installationID, GatewayGrantID: uuid.NewString(),
		SendToken: "second-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
		ExpiresAt: now.Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("register transferred grant: %v", err)
	}
	if second.GatewayGrantID == first.GatewayGrantID {
		t.Fatal("transferred installation kept the old gateway grant")
	}
	var jobs int64
	if err := db.Model(&store.MobilePushJob{}).Count(&jobs).Error; err != nil {
		t.Fatalf("count queued jobs: %v", err)
	}
	if jobs != 0 {
		t.Fatalf("queued jobs after installation transfer = %d, want 0", jobs)
	}
}

func TestMessageTransactionDurablyCreatesAndExpandsPushEvent(t *testing.T) {
	service, db, _, now := newPushTestService(t)
	user := insertPushUser(t, db, "event-recipient@example.com")
	sender := insertPushUser(t, db, "event-sender@example.com")
	conversation := insertPushConversation(t, db, user, sender, now)
	_, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
		SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
		ExpiresAt: now.Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("register grant: %v", err)
	}
	message := store.Message{
		ID: uuid.NewString(), ConversationID: conversation.ID, Seq: 1,
		SenderType: store.MessageSenderTypeUser, SenderID: &sender.ID,
		Body: json.RawMessage(`{"type":"text","content":"hello"}`), Summary: "hello",
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return tx.Create(&message).Error
	}); err != nil {
		t.Fatalf("create message transaction: %v", err)
	}
	var eventCount, jobCount int64
	_ = db.Model(&store.MobilePushEvent{}).Count(&eventCount).Error
	_ = db.Model(&store.MobilePushJob{}).Count(&jobCount).Error
	if eventCount != 1 || jobCount != 0 {
		t.Fatalf("before expansion events=%d jobs=%d", eventCount, jobCount)
	}
	processed, err := service.ExpandEventBatch(t.Context(), 10)
	if err != nil || processed != 1 {
		t.Fatalf("expand events = %d, %v", processed, err)
	}
	_ = db.Model(&store.MobilePushEvent{}).Count(&eventCount).Error
	_ = db.Model(&store.MobilePushJob{}).Count(&jobCount).Error
	if eventCount != 0 || jobCount != 1 {
		t.Fatalf("after expansion events=%d jobs=%d", eventCount, jobCount)
	}
}

func TestPushEventFanoutRechecksCurrentAccessAndMuteState(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*testing.T, *gorm.DB, store.User, store.Conversation, store.Message, time.Time)
	}{
		{
			name: "muted",
			change: func(t *testing.T, db *gorm.DB, user store.User, conversation store.Conversation, _ store.Message, now time.Time) {
				t.Helper()
				if err := db.Create(&store.ConversationUserPreference{
					UserID: user.ID, ConversationID: conversation.ID, NotificationMuted: true,
					CreatedAt: now, UpdatedAt: now,
				}).Error; err != nil {
					t.Fatalf("mute conversation: %v", err)
				}
			},
		},
		{
			name: "left conversation",
			change: func(t *testing.T, db *gorm.DB, user store.User, conversation store.Conversation, _ store.Message, now time.Time) {
				t.Helper()
				if err := db.Model(&store.ConversationMember{}).Where(
					"conversation_id = ? AND member_id = ?", conversation.ID, user.ID,
				).Update("left_at", now).Error; err != nil {
					t.Fatalf("leave conversation: %v", err)
				}
			},
		},
		{
			name: "deleted message",
			change: func(t *testing.T, db *gorm.DB, _ store.User, _ store.Conversation, message store.Message, now time.Time) {
				t.Helper()
				if err := db.Model(&store.Message{}).Where("id = ?", message.ID).
					Update("deleted_at", now).Error; err != nil {
					t.Fatalf("delete message: %v", err)
				}
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			service, db, _, now := newPushTestService(t)
			recipient := insertPushUser(t, db, "fanout-"+strings.ReplaceAll(test.name, " ", "-")+"@example.com")
			sender := insertPushUser(t, db, "fanout-sender-"+strings.ReplaceAll(test.name, " ", "-")+"@example.com")
			conversation := insertPushConversation(t, db, recipient, sender, now)
			_, _ = registerPushTestGrant(t, service, db, RegisterGrantCommand{
				UserID: recipient.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
				SendToken: "fanout-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
				ExpiresAt: now.Add(time.Hour),
			})
			message := store.Message{
				ID: uuid.NewString(), ConversationID: conversation.ID, Seq: 1,
				SenderType: store.MessageSenderTypeUser, SenderID: &sender.ID,
				Body: json.RawMessage(`{"type":"text","content":"hello"}`), Summary: "hello",
				CreatedAt: now, UpdatedAt: now,
			}
			if err := db.Create(&message).Error; err != nil {
				t.Fatalf("create message: %v", err)
			}
			test.change(t, db, recipient, conversation, message, now)
			if _, err := service.ExpandEventBatch(t.Context(), 10); err != nil {
				t.Fatalf("expand event: %v", err)
			}
			var jobs int64
			if err := db.Model(&store.MobilePushJob{}).Count(&jobs).Error; err != nil {
				t.Fatalf("count jobs: %v", err)
			}
			if jobs != 0 {
				t.Fatalf("jobs after %s = %d, want 0", test.name, jobs)
			}
		})
	}
}

func TestMessageTransactionRollsBackWhenPushEventCannotBeWritten(t *testing.T) {
	_, db, _, now := newPushTestService(t)
	user := insertPushUser(t, db, "event-rollback@example.com")
	other := insertPushUser(t, db, "event-rollback-other@example.com")
	conversation := insertPushConversation(t, db, user, other, now)
	if err := db.Migrator().DropTable(&store.MobilePushEvent{}); err != nil {
		t.Fatalf("drop push events table: %v", err)
	}
	message := store.Message{
		ID: uuid.NewString(), ConversationID: conversation.ID, Seq: 1,
		SenderType: store.MessageSenderTypeUser, SenderID: &user.ID,
		Body: json.RawMessage(`{"type":"text","content":"hello"}`), Summary: "hello",
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return tx.Create(&message).Error
	}); err == nil {
		t.Fatal("message transaction unexpectedly succeeded without push event table")
	}
	var messageCount int64
	if err := db.Model(&store.Message{}).Count(&messageCount).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if messageCount != 0 {
		t.Fatalf("messages after failed event write = %d, want 0", messageCount)
	}
}

func TestMessageDeliveryCreatesRouteAndDispatches(t *testing.T) {
	service, db, gateway, now := newPushTestService(t)
	user := insertPushUser(t, db, "recipient@example.com")
	sender := insertPushUser(t, db, "sender@example.com")
	conversation := insertPushConversation(t, db, user, sender, now)
	messageID := uuid.NewString()
	if err := db.Create(&store.MessageRegistry{
		ID: messageID, ConversationID: conversation.ID, Seq: 1,
		SenderType: store.MessageSenderTypeUser, SenderID: &sender.ID,
		CreatedAt: now, PartitionYear: int16(now.Year()), Summary: "hello",
	}).Error; err != nil {
		t.Fatalf("create registry: %v", err)
	}
	grantID := uuid.NewString()
	_, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: grantID,
		SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
		ExpiresAt: now.Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("register grant: %v", err)
	}
	if err := enqueueTestMessage(service, MessageDelivery{
		UserID: user.ID, ConversationID: conversation.ID, MessageID: messageID,
		SenderType: store.MessageSenderTypeUser, SenderID: sender.ID,
	}); err != nil {
		t.Fatalf("enqueue message: %v", err)
	}
	var job store.MobilePushJob
	if err := db.Preload("Grant").First(&job).Error; err != nil {
		t.Fatalf("load job: %v", err)
	}
	routeToken, err := service.cipher.Decrypt(job.RouteTokenCiphertext, []byte(job.ID))
	if err != nil {
		t.Fatalf("decrypt route token: %v", err)
	}
	route, err := service.ResolveRoute(t.Context(), user.ID, routeToken)
	if err != nil || route.ConversationID != conversation.ID || route.MessageID != messageID {
		t.Fatalf("resolve route = %#v, %v", route, err)
	}
	processed, err := service.DispatchBatch(t.Context(), 10)
	if err != nil || processed != 1 {
		t.Fatalf("dispatch = %d, %v", processed, err)
	}
	if len(gateway.calls) != 1 || gateway.calls[0].GrantID != grantID || gateway.calls[0].SendToken != "gateway-send-token-abcdefghijklmnopqrstuvwxyz" || gateway.calls[0].Notification.RouteToken != routeToken {
		t.Fatalf("gateway calls = %#v", gateway.calls)
	}
	if gateway.calls[0].Notification.Event != "message.created" || gateway.calls[0].Notification.TTLSeconds != 300 {
		t.Fatalf("notification = %#v", gateway.calls[0].Notification)
	}
	leftAt := now.Add(time.Minute)
	if err := db.Model(&store.ConversationMember{}).
		Where("conversation_id = ? AND member_id = ?", conversation.ID, user.ID).
		Update("left_at", leftAt).Error; err != nil {
		t.Fatalf("leave conversation: %v", err)
	}
	if _, err := service.ResolveRoute(t.Context(), user.ID, routeToken); failureCode(err) != "route_not_found" {
		t.Fatalf("route after access revocation error = %v", err)
	}
}

func TestDispatchRevalidatesMuteAndMessageRevocation(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		change func(*testing.T, *gorm.DB, store.Conversation, string, store.User, time.Time)
	}{
		{
			name: "muted after fanout",
			change: func(t *testing.T, db *gorm.DB, conversation store.Conversation, _ string, user store.User, now time.Time) {
				preference := store.ConversationUserPreference{
					UserID: user.ID, ConversationID: conversation.ID, NotificationMuted: true,
					CreatedAt: now, UpdatedAt: now,
				}
				if err := db.Create(&preference).Error; err != nil {
					t.Fatalf("mute conversation: %v", err)
				}
			},
		},
		{
			name: "message revoked after fanout",
			change: func(t *testing.T, db *gorm.DB, _ store.Conversation, messageID string, _ store.User, now time.Time) {
				if err := db.Model(&store.MessageRegistry{}).Where("id = ?", messageID).Update("revoked_at", now).Error; err != nil {
					t.Fatalf("revoke registry: %v", err)
				}
			},
		},
	} {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			service, db, gateway, now := newPushTestService(t)
			user := insertPushUser(t, db, "policy-user-"+uuid.NewString()+"@example.com")
			sender := insertPushUser(t, db, "policy-sender-"+uuid.NewString()+"@example.com")
			conversation := insertPushConversation(t, db, user, sender, now)
			_, _ = registerPushTestGrant(t, service, db, RegisterGrantCommand{
				UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
				SendToken: "policy-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios", ExpiresAt: now.Add(time.Hour),
			})
			messageID := uuid.NewString()
			if err := enqueueTestMessage(service, MessageDelivery{
				UserID: user.ID, ConversationID: conversation.ID, MessageID: messageID,
				SenderType: store.MessageSenderTypeUser, SenderID: sender.ID,
			}); err != nil {
				t.Fatalf("enqueue: %v", err)
			}
			var job store.MobilePushJob
			if err := db.First(&job).Error; err != nil {
				t.Fatalf("load job: %v", err)
			}
			routeToken, err := service.cipher.Decrypt(job.RouteTokenCiphertext, []byte(job.ID))
			if err != nil {
				t.Fatalf("decrypt route: %v", err)
			}
			testCase.change(t, db, conversation, messageID, user, now)
			if _, err := service.DispatchBatch(t.Context(), 1); err != nil {
				t.Fatalf("dispatch: %v", err)
			}
			if len(gateway.calls) != 0 {
				t.Fatalf("gateway calls = %#v", gateway.calls)
			}
			if testCase.name == "message revoked after fanout" {
				if _, err := service.ResolveRoute(t.Context(), user.ID, routeToken); failureCode(err) != "route_not_found" {
					t.Fatalf("revoked route error = %v", err)
				}
			}
		})
	}
}

func TestDispatchUsesRemainingLocalTTL(t *testing.T) {
	service, db, gateway, now := newPushTestService(t)
	user := insertPushUser(t, db, "ttl@example.com")
	sender := insertPushUser(t, db, "ttl-sender@example.com")
	conversation := insertPushConversation(t, db, user, sender, now)
	_, _ = registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
		SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios", ExpiresAt: now.Add(time.Hour),
	})
	if err := enqueueTestMessage(service, MessageDelivery{
		UserID: user.ID, ConversationID: conversation.ID, MessageID: uuid.NewString(),
		SenderType: store.MessageSenderTypeUser, SenderID: sender.ID,
	}); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	service.now = func() time.Time { return now.Add(4*time.Minute + 500*time.Millisecond) }
	if _, err := service.DispatchBatch(t.Context(), 1); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if len(gateway.calls) != 1 || gateway.calls[0].Notification.TTLSeconds != 60 {
		t.Fatalf("gateway calls = %#v", gateway.calls)
	}
}

func TestMessageDeliverySkipsMutedAndSelfMessages(t *testing.T) {
	service, db, _, now := newPushTestService(t)
	user := insertPushUser(t, db, "self@example.com")
	_, _ = registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
		SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios", ExpiresAt: now.Add(time.Hour),
	})
	for _, delivery := range []MessageDelivery{
		{UserID: user.ID, ConversationID: uuid.NewString(), MessageID: uuid.NewString(), Muted: true},
		{UserID: user.ID, ConversationID: uuid.NewString(), MessageID: uuid.NewString(), SenderType: store.MessageSenderTypeUser, SenderID: user.ID},
	} {
		if err := enqueueTestMessage(service, delivery); err != nil {
			t.Fatalf("enqueue skipped delivery: %v", err)
		}
	}
	var count int64
	_ = db.Model(&store.MobilePushJob{}).Count(&count).Error
	if count != 0 {
		t.Fatalf("push job count = %d", count)
	}
}

func TestReclaimedJobRejectsStaleWorker(t *testing.T) {
	service, db, gateway, now := newPushTestService(t)
	user := insertPushUser(t, db, "lease@example.com")
	other := insertPushUser(t, db, "lease-other@example.com")
	conversation := insertPushConversation(t, db, user, other, now)
	_, _ = registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
		SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios", ExpiresAt: now.Add(time.Hour),
	})
	_ = enqueueTestMessage(service, MessageDelivery{
		UserID: user.ID, ConversationID: conversation.ID, MessageID: uuid.NewString(),
		SenderType: store.MessageSenderTypeUser, SenderID: other.ID,
	})
	first, err := service.claimJobs(t.Context(), 1)
	if err != nil || len(first) != 1 {
		t.Fatalf("first claim = %#v, %v", first, err)
	}
	service.now = func() time.Time { return now.Add(workerLease + time.Second) }
	second, err := service.claimJobs(t.Context(), 1)
	if err != nil || len(second) != 1 || first[0].LockToken == second[0].LockToken {
		t.Fatalf("second claim = %#v, %v", second, err)
	}
	if err := service.dispatchJob(t.Context(), first[0]); err != nil {
		t.Fatalf("stale dispatch: %v", err)
	}
	if len(gateway.calls) != 0 {
		t.Fatal("stale worker called gateway")
	}
	if err := service.dispatchJob(t.Context(), second[0]); err != nil {
		t.Fatalf("current dispatch: %v", err)
	}
	if len(gateway.calls) != 1 {
		t.Fatalf("gateway calls = %d", len(gateway.calls))
	}
}

func TestStaleRevocationDoesNotDisableRotatedGrant(t *testing.T) {
	service, db, gateway, now := newPushTestService(t)
	user := insertPushUser(t, db, "rotated@example.com")
	other := insertPushUser(t, db, "rotated-other@example.com")
	conversation := insertPushConversation(t, db, user, other, now)
	installationID := uuid.NewString()
	oldGatewayGrantID := uuid.NewString()
	_, _ = registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, InstallationID: installationID, GatewayGrantID: oldGatewayGrantID,
		SendToken: "old-gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios", ExpiresAt: now.Add(time.Hour),
	})
	_ = enqueueTestMessage(service, MessageDelivery{
		UserID: user.ID, ConversationID: conversation.ID, MessageID: uuid.NewString(),
		SenderType: store.MessageSenderTypeUser, SenderID: other.ID,
	})
	claimed, err := service.claimJobs(t.Context(), 1)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim = %#v, %v", claimed, err)
	}
	newGatewayGrantID := uuid.NewString()
	_, err = registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, InstallationID: installationID, GatewayGrantID: newGatewayGrantID,
		SendToken: "new-gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios", ExpiresAt: now.Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("rotate grant: %v", err)
	}
	gateway.err = &GatewayError{Kind: GatewayErrorRevoked, Code: "grant_revoked", StatusCode: 410}
	if err := service.dispatchJob(t.Context(), claimed[0]); err != nil {
		t.Fatalf("dispatch stale grant: %v", err)
	}
	var stored store.UserPushGrant
	if err := db.First(&stored, "installation_id = ?", installationID).Error; err != nil {
		t.Fatalf("load rotated grant: %v", err)
	}
	if stored.Status != GrantStatusActive || stored.GatewayGrantID != newGatewayGrantID {
		t.Fatalf("rotated grant = %#v", stored)
	}
}

func TestRevokedGatewayResponseDisablesLocalGrant(t *testing.T) {
	service, db, gateway, now := newPushTestService(t)
	user := insertPushUser(t, db, "revoked@example.com")
	other := insertPushUser(t, db, "other@example.com")
	conversation := insertPushConversation(t, db, user, other, now)
	messageID := uuid.NewString()
	grant, _ := registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
		SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "android", ExpiresAt: now.Add(time.Hour),
	})
	_ = grant
	gateway.err = &GatewayError{Kind: GatewayErrorRevoked, Code: "grant_revoked", StatusCode: 410}
	if err := enqueueTestMessage(service, MessageDelivery{
		UserID: user.ID, ConversationID: conversation.ID, MessageID: messageID,
		SenderType: store.MessageSenderTypeUser, SenderID: other.ID,
	}); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if _, err := service.DispatchBatch(t.Context(), 1); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	var stored store.UserPushGrant
	if err := db.First(&stored).Error; err != nil {
		t.Fatalf("load grant: %v", err)
	}
	if stored.Status != GrantStatusDisabled {
		t.Fatalf("grant status = %q", stored.Status)
	}
	metrics, err := service.QueueMetrics(t.Context())
	if err != nil || metrics.RecentFailedJobs != 1 || metrics.RecentFailedJobCounts["grant_revoked"] != 1 {
		t.Fatalf("recent failed job metrics = %#v, err = %v", metrics, err)
	}
}

func enqueueTestMessage(service *Service, delivery MessageDelivery) error {
	if delivery.Muted || delivery.ActorUserID == delivery.UserID ||
		delivery.SenderType == store.MessageSenderTypeUser && delivery.SenderID == delivery.UserID {
		return nil
	}
	now := service.now().UTC()
	return service.db.Transaction(func(tx *gorm.DB) error {
		registry := store.MessageRegistry{
			ID: delivery.MessageID, ConversationID: delivery.ConversationID, Seq: 1,
			SenderType: delivery.SenderType, CreatedAt: now, PartitionYear: int16(now.Year()),
		}
		if delivery.SenderID != "" {
			registry.SenderID = &delivery.SenderID
		}
		if err := tx.Where("id = ?", delivery.MessageID).FirstOrCreate(&registry).Error; err != nil {
			return err
		}
		var grants []store.UserPushGrant
		if err := tx.Where(
			"user_id = ? AND status = ? AND expires_at > ?", delivery.UserID, GrantStatusActive, now,
		).Find(&grants).Error; err != nil {
			return err
		}
		message := store.Message{ID: delivery.MessageID, ConversationID: delivery.ConversationID}
		for _, grant := range grants {
			if err := service.createPushJob(tx, grant, message, now.Add(pushJobTTL), now); err != nil {
				return err
			}
		}
		return nil
	})
}

func newPushTestService(t *testing.T) (*Service, *gorm.DB, *fakeGateway, time.Time) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&store.User{}, &store.Conversation{}, &store.ConversationMember{},
		&store.Message{}, &store.MessageRegistry{}, &store.ConversationUserPreference{}, &store.ConversationTopic{}, &store.ConversationTopicParticipant{},
		&store.UserSession{}, &store.UserPushGrant{}, &store.MobilePushRoute{}, &store.MobilePushEvent{}, &store.MobilePushJob{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	cipher, err := NewTokenCipher(make([]byte, 32))
	if err != nil {
		t.Fatalf("create cipher: %v", err)
	}
	now := time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC)
	gateway := &fakeGateway{}
	service, err := NewService(Dependencies{
		DB: db, Cipher: cipher, Gateway: gateway, Enabled: true, Now: func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("create service: %v", err)
	}
	return service, db, gateway, now
}

func registerPushTestGrant(
	t *testing.T,
	service *Service,
	db *gorm.DB,
	command RegisterGrantCommand,
) (Grant, error) {
	t.Helper()
	if command.SessionID == "" {
		var session store.UserSession
		if err := db.Where("user_id = ?", command.UserID).Order("created_at ASC").First(&session).Error; err != nil {
			t.Fatalf("load push test session: %v", err)
		}
		command.SessionID = session.ID
	}
	return service.RegisterGrant(t.Context(), command)
}

func insertPushUser(t *testing.T, db *gorm.DB, email string) store.User {
	t.Helper()
	user := store.User{
		ID: uuid.NewString(), Email: email, Name: email,
		PasswordHash: "hash", Status: store.UserStatusActive,
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	session := store.UserSession{
		ID: uuid.NewString(), TokenHash: uuid.NewString(), UserID: user.ID,
		ExpiresAt: time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC),
		CreatedAt: user.CreatedAt, LastSeenAt: user.CreatedAt,
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatalf("create push test session: %v", err)
	}
	return user
}

func insertPushConversation(t *testing.T, db *gorm.DB, first, second store.User, now time.Time) store.Conversation {
	t.Helper()
	conversation := store.Conversation{
		ID: uuid.NewString(), Kind: store.ConversationKindDirect, Name: "Direct",
		CreatedByUserID: first.ID, Status: store.ConversationStatusActive,
		PostingPolicy: store.ConversationPostingPolicyOpen,
		Visibility:    store.ConversationVisibilityPrivate, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	for _, user := range []store.User{first, second} {
		member := store.ConversationMember{
			ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser,
			MemberID: user.ID, Role: store.ConversationMemberRoleMember,
			JoinedAt: now, HistoryVisibleFromSeq: 1,
		}
		if err := db.Create(&member).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}
	return conversation
}

func failureCode(err error) string {
	if err == nil {
		return ""
	}
	var value *Error
	if errors.As(err, &value) {
		return value.Code
	}
	return "unknown"
}
