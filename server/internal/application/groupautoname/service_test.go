package groupautoname

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"app/internal/appregistry"
	"app/internal/config"
	"app/internal/store"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type eventRecorder struct {
	events   []Event
	locker   *sync.Mutex
	lockHeld bool
}

func (r *eventRecorder) DeliverGroupAutoNameEvents(_ context.Context, events []Event) {
	r.events = append(r.events, events...)
	if r.locker != nil {
		if r.locker.TryLock() {
			r.locker.Unlock()
		} else {
			r.lockHeld = true
		}
	}
}

func TestAutoNameTaskCountsOrdinaryMessagesAndTriggersAtLimit(t *testing.T) {
	db := openTestDB(t)
	now := time.Date(2026, 7, 23, 9, 0, 0, 0, time.UTC)
	seedSettingsAndAssistant(t, db, 2, now)
	user := store.User{ID: uuid.NewString(), Email: "member@example.com", Name: "成员", Status: store.UserStatusActive, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	conversation := store.Conversation{ID: uuid.NewString(), Kind: store.ConversationKindGroup, Name: "新群聊", Status: store.ConversationStatusActive, PostingPolicy: store.ConversationPostingPolicyOpen, CreatedByUserID: user.ID, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	if err := service.CreateTask(db, conversation.ID, now); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&store.Message{ID: uuid.NewString(), ConversationID: conversation.ID, Seq: 1, SenderType: store.MessageSenderTypeSystem, Body: json.RawMessage(`{"type":"system_event"}`), Summary: "系统消息", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	for index, summary := range []string{"讨论移动端发布", "确认周五上线"} {
		seq := int64(index + 2)
		if err := db.Create(&store.Message{ID: uuid.NewString(), ConversationID: conversation.ID, Seq: seq, SenderType: store.MessageSenderTypeUser, SenderID: &user.ID, Body: json.RawMessage(`{"type":"text"}`), Summary: summary, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
			t.Fatal(err)
		}
		event, err := service.RecordMessage(db, conversation, now)
		if err != nil {
			t.Fatal(err)
		}
		if index == 0 && event != nil {
			t.Fatal("event triggered before message limit")
		}
		if index == 1 {
			if event == nil {
				t.Fatal("event was not triggered at message limit")
			}
			var payload RequestedPayload
			if err := json.Unmarshal(event.Payload, &payload); err != nil {
				t.Fatal(err)
			}
			if len(payload.Messages) != 2 || payload.Messages[0].Sender != "成员1" || payload.Messages[1].Sender != "成员1" {
				t.Fatalf("messages = %#v, want only ordinary messages", payload.Messages)
			}
		}
	}
	var task store.ConversationAutoNameTask
	if err := db.First(&task, "conversation_id = ?", conversation.ID).Error; err != nil {
		t.Fatal(err)
	}
	if task.MessageCount != 2 || task.TriggeredVersion != 1 || task.TriggerMessageSeq == nil || *task.TriggerMessageSeq != 3 {
		t.Fatalf("task = %#v", task)
	}
}

func TestAutoNamePayloadExcludesRevokedContentAndPersonalIdentifiers(t *testing.T) {
	db := openTestDB(t)
	now := time.Date(2026, 7, 23, 9, 30, 0, 0, time.UTC)
	seedSettingsAndAssistant(t, db, 2, now)
	alice := store.User{ID: uuid.NewString(), Email: "alice@example.com", Name: "Alice Real Name", Nickname: "Alice Nickname", Status: store.UserStatusActive, CreatedAt: now, UpdatedAt: now}
	bob := store.User{ID: uuid.NewString(), Email: "bob@example.com", Name: "Bob Real Name", Status: store.UserStatusActive, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&[]store.User{alice, bob}).Error; err != nil {
		t.Fatal(err)
	}
	conversation := store.Conversation{ID: uuid.NewString(), Kind: store.ConversationKindGroup, Name: "Sensitive Project Name", Status: store.ConversationStatusActive, PostingPolicy: store.ConversationPostingPolicyOpen, CreatedByUserID: alice.ID, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	if err := service.CreateTask(db, conversation.ID, now); err != nil {
		t.Fatal(err)
	}
	revokedAt := now.Add(time.Minute)
	longSummary := strings.Repeat("密", requestedSummaryMaxRunes+20)
	messages := []store.Message{
		{ID: uuid.NewString(), ConversationID: conversation.ID, Seq: 1, SenderType: store.MessageSenderTypeUser, SenderID: &alice.ID, Summary: "撤回的密码", RevokedAt: &revokedAt, CreatedAt: now, UpdatedAt: now},
		{ID: uuid.NewString(), ConversationID: conversation.ID, Seq: 2, SenderType: store.MessageSenderTypeUser, SenderID: &alice.ID, Summary: longSummary, CreatedAt: now, UpdatedAt: now},
		{ID: uuid.NewString(), ConversationID: conversation.ID, Seq: 3, SenderType: store.MessageSenderTypeUser, SenderID: &bob.ID, Summary: "确认上线", CreatedAt: now, UpdatedAt: now},
	}
	if err := db.Create(&messages).Error; err != nil {
		t.Fatal(err)
	}
	event, err := service.RecordMessages(db, conversation, len(messages), now)
	if err != nil {
		t.Fatal(err)
	}
	if event == nil {
		t.Fatal("event was not triggered")
	}
	var payload RequestedPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Messages) != 2 || payload.Messages[0].Sender != "成员1" || payload.Messages[1].Sender != "成员2" {
		t.Fatalf("messages = %#v", payload.Messages)
	}
	if len([]rune(payload.Messages[0].Summary)) != requestedSummaryMaxRunes || payload.Messages[1].Summary != "确认上线" {
		t.Fatalf("summaries = %#v", payload.Messages)
	}
	raw := string(event.Payload)
	for _, forbiddenValue := range []string{"撤回的密码", "Alice", "Bob", "Sensitive Project Name", `"seq"`, "conversation_name"} {
		if strings.Contains(raw, forbiddenValue) {
			t.Fatalf("payload leaked %q: %s", forbiddenValue, raw)
		}
	}
	var task store.ConversationAutoNameTask
	if err := db.First(&task, "conversation_id = ?", conversation.ID).Error; err != nil {
		t.Fatal(err)
	}
	if task.TriggerMessageSeq == nil || *task.TriggerMessageSeq != 3 {
		t.Fatalf("trigger seq = %#v, want 3", task.TriggerMessageSeq)
	}
}

func TestReconfigureImmediatelyTriggersPendingTaskWithNewVersion(t *testing.T) {
	db := openTestDB(t)
	now := time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC)
	seedSettingsAndAssistant(t, db, 5, now)
	user := store.User{ID: uuid.NewString(), Email: "owner@example.com", Name: "群主", Status: store.UserStatusActive, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	conversation := store.Conversation{ID: uuid.NewString(), Kind: store.ConversationKindGroup, Name: "新群聊", Status: store.ConversationStatusActive, PostingPolicy: store.ConversationPostingPolicyOpen, CreatedByUserID: user.ID, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	locker := &sync.Mutex{}
	recorder := &eventRecorder{locker: locker}
	service := NewService(Dependencies{DB: db, Events: recorder, EventLocker: locker, Now: func() time.Time { return now }})
	if err := service.CreateTask(db, conversation.ID, now); err != nil {
		t.Fatal(err)
	}
	for seq := int64(1); seq <= 2; seq++ {
		if err := db.Create(&store.Message{ID: uuid.NewString(), ConversationID: conversation.ID, Seq: seq, SenderType: store.MessageSenderTypeUser, SenderID: &user.ID, Body: json.RawMessage(`{"type":"text"}`), Summary: "发布讨论", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
			t.Fatal(err)
		}
		if event, err := service.RecordMessage(db, conversation, now); err != nil || event != nil {
			t.Fatalf("RecordMessage() event=%#v err=%v", event, err)
		}
	}
	if err := db.Model(&store.AppSettings{}).Where("id = ?", store.AppSettingsID).
		Update("assistant_auto_group_naming_message_count", 2).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.Reconfigure(context.Background(), true, 2); err != nil {
		t.Fatal(err)
	}
	if len(recorder.events) != 1 {
		t.Fatalf("delivered events = %d, want 1", len(recorder.events))
	}
	if !recorder.lockHeld {
		t.Fatal("reconfigured event was delivered without the reliable event lock")
	}
	var payload RequestedPayload
	if err := json.Unmarshal(recorder.events[0].Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.TaskVersion != 2 || payload.MessageLimit != 2 {
		t.Fatalf("payload = %#v", payload)
	}
	if err := service.SkipTask(db, conversation.ID, now); err != nil {
		t.Fatal(err)
	}
	var task store.ConversationAutoNameTask
	if err := db.First(&task, "conversation_id = ?", conversation.ID).Error; err != nil {
		t.Fatal(err)
	}
	if task.Status != store.ConversationAutoNameStatusSkipped {
		t.Fatalf("status = %q, want skipped", task.Status)
	}
}

func TestAutoNameEventEnsuresBuiltinAssistantExistsWhenOffline(t *testing.T) {
	db := openTestDB(t)
	now := time.Date(2026, 7, 23, 10, 30, 0, 0, time.UTC)
	if err := db.Create(&store.AppSettings{ID: store.AppSettingsID, AppName: "即应", OrganizationName: "测试", AssistantAutoGroupNamingEnabled: true, AssistantAutoGroupNamingMessageCount: 1, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	user := store.User{ID: uuid.NewString(), Email: "offline@example.com", Name: "成员", Status: store.UserStatusActive, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	conversation := store.Conversation{ID: uuid.NewString(), Kind: store.ConversationKindGroup, Name: "新群聊", Status: store.ConversationStatusActive, PostingPolicy: store.ConversationPostingPolicyOpen, CreatedByUserID: user.ID, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService(Dependencies{DB: db, Apps: config.AppsConfig{AIAssistantSecret: "offline-secret"}})
	if err := service.CreateTask(db, conversation.ID, now); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&store.Message{ID: uuid.NewString(), ConversationID: conversation.ID, Seq: 1, SenderType: store.MessageSenderTypeUser, SenderID: &user.ID, Body: json.RawMessage(`{"type":"text"}`), Summary: "讨论发布", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if event, err := service.RecordMessage(db, conversation, now); err != nil || event == nil {
		t.Fatalf("RecordMessage() event=%#v err=%v", event, err)
	}
	var assistant store.App
	if err := db.First(&assistant, "id = ?", appregistry.AIAssistantAppID).Error; err != nil {
		t.Fatal(err)
	}
	if assistant.ConnectionSecret != "offline-secret" {
		t.Fatalf("assistant secret = %q", assistant.ConnectionSecret)
	}
}

func TestReconfigureProcessesMoreThanOneBatchAndIsIdempotent(t *testing.T) {
	db := openTestDB(t)
	now := time.Date(2026, 7, 23, 11, 0, 0, 0, time.UTC)
	seedSettingsAndAssistant(t, db, 5, now)
	user := store.User{ID: uuid.NewString(), Email: "batch@example.com", Name: "群主", Status: store.UserStatusActive, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	for index := 0; index < reconfigureBatchSize*2+5; index++ {
		conversation := store.Conversation{ID: uuid.NewString(), Kind: store.ConversationKindGroup, Name: "新群聊", Status: store.ConversationStatusActive, PostingPolicy: store.ConversationPostingPolicyOpen, CreatedByUserID: user.ID, CreatedAt: now, UpdatedAt: now}
		if err := db.Create(&conversation).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&store.ConversationAutoNameTask{ConversationID: conversation.ID, Status: store.ConversationAutoNameStatusPending, MessageLimit: 5, Version: 1, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	if err := db.Model(&store.AppSettings{}).Where("id = ?", store.AppSettingsID).
		Update("assistant_auto_group_naming_message_count", 7).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.Reconfigure(context.Background(), true, 7); err != nil {
		t.Fatal(err)
	}
	var mismatched int64
	if err := db.Model(&store.ConversationAutoNameTask{}).Where("message_limit <> ? OR version <> ?", 7, 2).Count(&mismatched).Error; err != nil {
		t.Fatal(err)
	}
	if mismatched != 0 {
		t.Fatalf("mismatched tasks = %d", mismatched)
	}
	if err := service.Reconfigure(context.Background(), true, 7); err != nil {
		t.Fatal(err)
	}
	var changedAgain int64
	if err := db.Model(&store.ConversationAutoNameTask{}).Where("version <> ?", 2).Count(&changedAgain).Error; err != nil {
		t.Fatal(err)
	}
	if changedAgain != 0 {
		t.Fatalf("tasks changed on idempotent reconfigure = %d", changedAgain)
	}
	if err := db.Model(&store.AppSettings{}).Where("id = ?", store.AppSettingsID).
		Update("assistant_auto_group_naming_enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.Reconfigure(context.Background(), false, 7); err != nil {
		t.Fatal(err)
	}
	var pending int64
	if err := db.Model(&store.ConversationAutoNameTask{}).Where("status = ?", store.ConversationAutoNameStatusPending).Count(&pending).Error; err != nil {
		t.Fatal(err)
	}
	if pending != 0 {
		t.Fatalf("pending tasks after disable = %d", pending)
	}
}

func TestSupersededReconfigureDoesNotOverwriteNewerSettings(t *testing.T) {
	db := openTestDB(t)
	now := time.Date(2026, 7, 23, 11, 30, 0, 0, time.UTC)
	seedSettingsAndAssistant(t, db, 5, now)
	user := store.User{ID: uuid.NewString(), Email: "latest@example.com", Name: "群主", Status: store.UserStatusActive, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	conversation := store.Conversation{ID: uuid.NewString(), Kind: store.ConversationKindGroup, Name: "新群聊", Status: store.ConversationStatusActive, PostingPolicy: store.ConversationPostingPolicyOpen, CreatedByUserID: user.ID, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&store.ConversationAutoNameTask{ConversationID: conversation.ID, Status: store.ConversationAutoNameStatusPending, MessageLimit: 5, Version: 1, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&store.AppSettings{}).Where("id = ?", store.AppSettingsID).
		Update("assistant_auto_group_naming_message_count", 3).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	if err := service.Reconfigure(context.Background(), true, 2); err != nil {
		t.Fatal(err)
	}
	if err := service.Reconfigure(context.Background(), true, 3); err != nil {
		t.Fatal(err)
	}
	var task store.ConversationAutoNameTask
	if err := db.First(&task, "conversation_id = ?", conversation.ID).Error; err != nil {
		t.Fatal(err)
	}
	if task.MessageLimit != 3 || task.Version != 2 {
		t.Fatalf("task = %#v", task)
	}
}

func TestReconfigureSkipsDissolvedGroupsWithoutCreatingEvents(t *testing.T) {
	db := openTestDB(t)
	now := time.Date(2026, 7, 23, 11, 45, 0, 0, time.UTC)
	seedSettingsAndAssistant(t, db, 5, now)
	user := store.User{ID: uuid.NewString(), Email: "dissolved@example.com", Name: "群主", Status: store.UserStatusActive, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	conversation := store.Conversation{ID: uuid.NewString(), Kind: store.ConversationKindGroup, Name: "已解散", Status: store.ConversationStatusDissolved, PostingPolicy: store.ConversationPostingPolicyMuted, CreatedByUserID: user.ID, DissolvedAt: &now, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&store.ConversationAutoNameTask{ConversationID: conversation.ID, Status: store.ConversationAutoNameStatusPending, MessageCount: 5, MessageLimit: 5, Version: 1, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&store.AppSettings{}).Where("id = ?", store.AppSettingsID).
		Update("assistant_auto_group_naming_message_count", 2).Error; err != nil {
		t.Fatal(err)
	}
	recorder := &eventRecorder{}
	service := NewService(Dependencies{DB: db, Events: recorder, Now: func() time.Time { return now }})
	if err := service.Reconfigure(context.Background(), true, 2); err != nil {
		t.Fatal(err)
	}
	var task store.ConversationAutoNameTask
	if err := db.First(&task, "conversation_id = ?", conversation.ID).Error; err != nil {
		t.Fatal(err)
	}
	if task.Status != store.ConversationAutoNameStatusSkipped || len(recorder.events) != 0 {
		t.Fatalf("task = %#v, events = %#v", task, recorder.events)
	}
}

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&store.User{}, &store.App{}, &store.Conversation{}, &store.Message{}, &store.AppSettings{}, &store.ConversationAutoNameTask{}, &store.AppEventOutbox{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func seedSettingsAndAssistant(t *testing.T, db *gorm.DB, limit int, now time.Time) {
	t.Helper()
	if err := db.Create(&store.AppSettings{ID: store.AppSettingsID, AppName: "即应", OrganizationName: "测试", AssistantAutoGroupNamingEnabled: true, AssistantAutoGroupNamingMessageCount: limit, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&store.App{ID: appregistry.AIAssistantAppID, Name: "茉莉", Enabled: true, Visibility: store.AppVisibilityPublic, ConnectionSecret: "secret", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
}
