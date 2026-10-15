package mobilepush

import (
	"encoding/json"
	"testing"
	"time"

	"app/internal/store"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type policyFixture struct {
	service      *Service
	db           *gorm.DB
	gateway      *fakeGateway
	now          time.Time
	user         store.User
	sender       store.User
	conversation store.Conversation
	grant        store.UserPushGrant
	message      store.MessageRegistry
}

func newPolicyFixture(t *testing.T) policyFixture {
	t.Helper()
	service, db, gateway, now := newPushTestService(t)
	user := insertPushUser(t, db, "policy-recipient@example.com")
	sender := insertPushUser(t, db, "policy-sender@example.com")
	conversation := insertPushConversation(t, db, user, sender, now)
	value, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(), SendToken: "policy-capability-abcdefghijklmnopqrstuvwxyz", Platform: "ios", ExpiresAt: now.Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	var grant store.UserPushGrant
	if err := db.First(&grant, "installation_id = ?", value.InstallationID).Error; err != nil {
		t.Fatal(err)
	}
	message := store.MessageRegistry{ID: uuid.NewString(), ConversationID: conversation.ID, Seq: 1, SenderType: store.MessageSenderTypeUser, SenderID: &sender.ID, CreatedAt: now, PartitionYear: int16(now.Year())}
	if err := db.Create(&message).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.createPushJob(db, grant, store.Message{ID: message.ID, ConversationID: conversation.ID}, now.Add(pushJobTTL), now); err != nil {
		t.Fatal(err)
	}
	return policyFixture{service, db, gateway, now, user, sender, conversation, grant, message}
}

func (f policyFixture) advance(duration time.Duration) {
	f.service.now = func() time.Time { return f.now.Add(duration) }
}
func (f policyFixture) dispatch(t *testing.T) {
	t.Helper()
	if _, err := f.service.DispatchBatch(t.Context(), 20); err != nil {
		t.Fatal(err)
	}
}
func (f policyFixture) assertSuppressed(t *testing.T, reason string) {
	t.Helper()
	f.dispatch(t)
	if len(f.gateway.calls) != 0 {
		t.Fatalf("suppressed job reached gateway: %#v", f.gateway.calls)
	}
	var job store.MobilePushJob
	if err := f.db.First(&job, "grant_id = ?", f.grant.ID).Error; err != nil {
		t.Fatal(err)
	}
	if job.Status != JobStatusSuppressed || job.LastErrorCode != reason {
		t.Fatalf("status=%s reason=%s", job.Status, job.LastErrorCode)
	}
}

func TestPushWaitsFiveSecondsAndDoesNotMergeMessages(t *testing.T) {
	f := newPolicyFixture(t)
	f.advance(4 * time.Second)
	f.dispatch(t)
	if len(f.gateway.calls) != 0 {
		t.Fatal("push sent before five seconds")
	}
	second := f.message
	second.ID, second.Seq = uuid.NewString(), 2
	second.CreatedAt = f.now.Add(4 * time.Second)
	if err := f.db.Create(&second).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.service.createPushJob(f.db, f.grant, store.Message{ID: second.ID, ConversationID: second.ConversationID}, second.CreatedAt.Add(pushJobTTL), second.CreatedAt); err != nil {
		t.Fatal(err)
	}
	f.advance(5*time.Second - time.Nanosecond)
	f.dispatch(t)
	if len(f.gateway.calls) != 0 {
		t.Fatal("first notification sent before its delay")
	}
	f.advance(5 * time.Second)
	f.dispatch(t)
	if len(f.gateway.calls) != 1 {
		t.Fatal("later message delayed or replaced the first notification")
	}
	f.advance(9*time.Second - time.Nanosecond)
	f.dispatch(t)
	if len(f.gateway.calls) != 1 {
		t.Fatal("later notification did not wait its own five seconds")
	}
	f.advance(9 * time.Second)
	f.dispatch(t)
	if len(f.gateway.calls) != 2 {
		t.Fatalf("independent notifications = %d, want 2", len(f.gateway.calls))
	}
	if f.gateway.calls[0].IdempotencyKey == f.gateway.calls[1].IdempotencyKey {
		t.Fatal("different messages shared an idempotency key")
	}
}

func TestPushSkipsMessageReadDuringFiveSecondWait(t *testing.T) {
	f := newPolicyFixture(t)
	if err := f.db.Model(&store.ConversationMember{}).Where("conversation_id = ? AND member_id = ?", f.conversation.ID, f.user.ID).Update("last_read_seq", f.message.Seq).Error; err != nil {
		t.Fatal(err)
	}
	f.advance(5 * time.Second)
	f.assertSuppressed(t, "already_read")
	status, err := f.service.GetStatus(t.Context(), f.user.ID, f.grant.SessionID)
	if err != nil || status.LastJob == nil || status.LastJob.Reason != "already_read" || status.DelaySeconds != 5 {
		t.Fatalf("diagnostic=%#v err=%v", status, err)
	}
}

func TestPushForegroundAppliesOnlyToTheSameDevice(t *testing.T) {
	f := newPolicyFixture(t)
	session := store.UserSession{ID: uuid.NewString(), UserID: f.user.ID, TokenHash: uuid.NewString(), ExpiresAt: f.now.Add(time.Hour), CreatedAt: f.now, LastSeenAt: f.now}
	if err := f.db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	grant, err := f.service.RegisterGrant(t.Context(), RegisterGrantCommand{UserID: f.user.ID, SessionID: session.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(), SendToken: "second-device-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios", ExpiresAt: f.now.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	var second store.UserPushGrant
	if err := f.db.First(&second, "installation_id = ?", grant.InstallationID).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.service.createPushJob(f.db, second, store.Message{ID: f.message.ID, ConversationID: f.conversation.ID}, f.now.Add(pushJobTTL), f.now); err != nil {
		t.Fatal(err)
	}
	if err := f.service.ReportPresence(t.Context(), PresenceCommand{UserID: f.user.ID, SessionID: f.grant.SessionID, Platform: "ios", Foreground: true}); err != nil {
		t.Fatal(err)
	}
	f.advance(5 * time.Second)
	f.dispatch(t)
	if len(f.gateway.calls) != 1 || f.gateway.calls[0].GrantID != second.GatewayGrantID {
		t.Fatalf("unexpected foreground suppression: %#v", f.gateway.calls)
	}
}

func TestPushForegroundAndDesktopPresenceExpireOrClear(t *testing.T) {
	for _, scenario := range []string{"mobile_background", "mobile_expired", "desktop_default", "desktop_enabled", "desktop_expired", "desktop_logout", "desktop_background"} {
		t.Run(scenario, func(t *testing.T) {
			f := newPolicyFixture(t)
			platform, sessionID := "ios", f.grant.SessionID
			if scenario != "mobile_background" && scenario != "mobile_expired" {
				platform = "desktop"
				session := store.UserSession{ID: uuid.NewString(), UserID: f.user.ID, TokenHash: uuid.NewString(), ExpiresAt: f.now.Add(time.Hour), CreatedAt: f.now, LastSeenAt: f.now}
				if err := f.db.Create(&session).Error; err != nil {
					t.Fatal(err)
				}
				sessionID = session.ID
				if scenario != "desktop_default" {
					if _, err := f.service.SetPreferences(t.Context(), f.user.ID, PushPreferences{PauseWhenDesktopActive: true}); err != nil {
						t.Fatal(err)
					}
				}
			}
			cmd := PresenceCommand{UserID: f.user.ID, SessionID: sessionID, Platform: platform, Foreground: true}
			if err := f.service.ReportPresence(t.Context(), cmd); err != nil {
				t.Fatal(err)
			}
			if scenario == "mobile_background" || scenario == "desktop_background" {
				cmd.Foreground = false
				if err := f.service.ReportPresence(t.Context(), cmd); err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "desktop_logout" {
				if err := f.db.Delete(&store.UserSession{}, "id = ?", sessionID).Error; err != nil {
					t.Fatal(err)
				}
			}
			f.advance(5 * time.Second)
			if scenario == "mobile_expired" || scenario == "desktop_expired" {
				f.advance(pushPresenceTTL)
			}
			if scenario == "desktop_enabled" {
				f.assertSuppressed(t, "desktop_active")
				return
			}
			f.dispatch(t)
			if len(f.gateway.calls) != 1 {
				t.Fatalf("scenario %s unexpectedly suppressed push", scenario)
			}
		})
	}
}

func TestTopicPushUsesTopicReadCursorNotParentReadCursor(t *testing.T) {
	for _, readTopic := range []bool{false, true} {
		t.Run(map[bool]string{false: "parent_only", true: "topic_read"}[readTopic], func(t *testing.T) {
			f := newPolicyFixture(t)
			if err := f.db.Where("grant_id = ?", f.grant.ID).Delete(&store.MobilePushJob{}).Error; err != nil {
				t.Fatal(err)
			}
			if err := f.db.Model(&store.ConversationMember{}).Where("conversation_id = ? AND member_id = ?", f.conversation.ID, f.user.ID).Update("last_read_seq", 100).Error; err != nil {
				t.Fatal(err)
			}
			topic := f.conversation
			topic.ID, topic.Kind = uuid.NewString(), store.ConversationKindTopic
			if err := f.db.Create(&topic).Error; err != nil {
				t.Fatal(err)
			}
			if err := f.db.Create(&store.ConversationTopic{ConversationID: topic.ID, ParentConversationID: f.conversation.ID, SourceMessageID: f.message.ID, SourceMessageSeq: 1, SourceMessageBody: json.RawMessage(`{"type":"text","content":"source"}`), SourceSenderType: store.MessageSenderTypeUser, SourceSenderID: &f.sender.ID, CreatedByUserID: f.sender.ID, SourceMessageCreatedAt: f.now, CreatedAt: f.now, UpdatedAt: f.now}).Error; err != nil {
				t.Fatal(err)
			}
			participant := store.ConversationTopicParticipant{ConversationID: topic.ID, ParticipantType: store.ConversationMemberTypeUser, ParticipantID: f.user.ID, HistoryVisibleFromSeq: 1, JoinedAt: f.now, CreatedAt: f.now, UpdatedAt: f.now}
			if readTopic {
				participant.LastReadSeq = 2
			}
			if err := f.db.Create(&participant).Error; err != nil {
				t.Fatal(err)
			}
			message := f.message
			message.ID, message.ConversationID, message.Seq = uuid.NewString(), topic.ID, 2
			if err := f.db.Create(&message).Error; err != nil {
				t.Fatal(err)
			}
			if err := f.service.createPushJob(f.db, f.grant, store.Message{ID: message.ID, ConversationID: topic.ID}, f.now.Add(pushJobTTL), f.now); err != nil {
				t.Fatal(err)
			}
			f.advance(5 * time.Second)
			if readTopic {
				f.assertSuppressed(t, "already_read")
				return
			}
			f.dispatch(t)
			if len(f.gateway.calls) != 1 {
				t.Fatal("parent read cursor incorrectly suppressed unread topic")
			}
		})
	}
}

func TestPushStatusCannotReadAnotherPhonesJobs(t *testing.T) {
	f := newPolicyFixture(t)
	session := store.UserSession{ID: uuid.NewString(), UserID: f.user.ID, TokenHash: uuid.NewString(), ExpiresAt: f.now.Add(time.Hour), CreatedAt: f.now, LastSeenAt: f.now}
	if err := f.db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	status, err := f.service.GetStatus(t.Context(), f.user.ID, session.ID)
	if err != nil || status.Registered || status.LastJob != nil {
		t.Fatalf("another phone leaked into status: %#v %v", status, err)
	}
}

func TestPushPresenceCannotUseAnotherUsersSession(t *testing.T) {
	f := newPolicyFixture(t)
	if err := f.service.ReportPresence(t.Context(), PresenceCommand{UserID: f.sender.ID, SessionID: f.grant.SessionID, Platform: "ios", Foreground: true}); failureCode(err) != "unauthorized" {
		t.Fatalf("cross-user presence accepted: %v", err)
	}
	if err := f.service.ReportPresence(t.Context(), PresenceCommand{UserID: f.user.ID, SessionID: f.grant.SessionID, Platform: "browser", Foreground: true}); failureCode(err) != "invalid_request" {
		t.Fatalf("invalid platform: %v", err)
	}
	preference, err := f.service.GetPreferences(t.Context(), f.user.ID)
	if err != nil || preference.PauseWhenDesktopActive {
		t.Fatalf("default preference: %#v %v", preference, err)
	}
}
