package groupautoname

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"app/internal/appregistry"
	"app/internal/config"
	"app/internal/store"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	EventRequested           = "group.auto_name.requested"
	reconfigureBatchSize     = 100
	requestedSummaryMaxRunes = 300
)

var errReconfigureSuperseded = errors.New("automatic group naming reconfiguration superseded")

type Event struct {
	AppID   string
	Cursor  int64
	Event   string
	Payload json.RawMessage
}

type EventPort interface {
	DeliverGroupAutoNameEvents(context.Context, []Event)
}

type EventLocker interface {
	sync.Locker
}

type Service struct {
	db     *gorm.DB
	events EventPort
	locker EventLocker
	apps   config.AppsConfig
	now    func() time.Time
}

type Dependencies struct {
	DB          *gorm.DB
	Events      EventPort
	EventLocker EventLocker
	Apps        config.AppsConfig
	Now         func() time.Time
}

type RequestedMessage struct {
	Sender  string `json:"sender"`
	Summary string `json:"summary"`
}

type RequestedPayload struct {
	ConversationID string             `json:"conversation_id"`
	MessageLimit   int                `json:"message_limit"`
	Messages       []RequestedMessage `json:"messages"`
	TaskVersion    int                `json:"task_version"`
}

func NewService(deps Dependencies) *Service {
	now := deps.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{db: deps.DB, events: deps.Events, locker: deps.EventLocker, apps: deps.Apps, now: now}
}

func (s *Service) CreateTask(tx *gorm.DB, conversationID string, now time.Time) error {
	settings, err := loadSettings(tx, now)
	if err != nil {
		return err
	}
	if !settings.AssistantAutoGroupNamingEnabled {
		return nil
	}
	return tx.Create(&store.ConversationAutoNameTask{
		ConversationID: conversationID,
		Status:         store.ConversationAutoNameStatusPending,
		MessageLimit:   settings.AssistantAutoGroupNamingMessageCount,
		Version:        1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}).Error
}

func (s *Service) SkipTask(tx *gorm.DB, conversationID string, now time.Time) error {
	return tx.Model(&store.ConversationAutoNameTask{}).
		Where("conversation_id = ? AND status = ?", conversationID, store.ConversationAutoNameStatusPending).
		Updates(map[string]any{"status": store.ConversationAutoNameStatusSkipped, "updated_at": now}).Error
}

func (s *Service) RecordMessage(tx *gorm.DB, conversation store.Conversation, now time.Time) (*Event, error) {
	return s.RecordMessages(tx, conversation, 1, now)
}

func (s *Service) RecordMessages(tx *gorm.DB, conversation store.Conversation, count int, now time.Time) (*Event, error) {
	if conversation.Kind != store.ConversationKindGroup {
		return nil, nil
	}
	if count <= 0 {
		return nil, nil
	}
	var task store.ConversationAutoNameTask
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&task, "conversation_id = ?", conversation.ID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	if task.Status != store.ConversationAutoNameStatusPending {
		return nil, nil
	}
	settings, err := loadSettings(tx, now)
	if err != nil {
		return nil, err
	}
	if !settings.AssistantAutoGroupNamingEnabled {
		return nil, tx.Model(&store.ConversationAutoNameTask{}).Where("conversation_id = ?", conversation.ID).
			Updates(map[string]any{"status": store.ConversationAutoNameStatusSkipped, "updated_at": now}).Error
	}
	updates := map[string]any{"updated_at": now}
	if task.MessageLimit != settings.AssistantAutoGroupNamingMessageCount {
		task.MessageLimit = settings.AssistantAutoGroupNamingMessageCount
		task.Version++
		updates["message_limit"] = task.MessageLimit
		updates["version"] = task.Version
	}
	task.MessageCount += count
	updates["message_count"] = task.MessageCount
	if task.MessageCount < task.MessageLimit || task.TriggeredVersion == task.Version {
		return nil, tx.Model(&store.ConversationAutoNameTask{}).Where("conversation_id = ?", conversation.ID).Updates(updates).Error
	}
	return s.createRequestedEvent(tx, conversation, &task, updates, now)
}

func (s *Service) Reconfigure(ctx context.Context, enabled bool, messageLimit int) error {
	for {
		conversationIDs, err := s.loadReconfigureBatch(ctx, enabled, messageLimit)
		if err != nil {
			return err
		}
		if len(conversationIDs) == 0 {
			return nil
		}
		for _, conversationID := range conversationIDs {
			if err := s.reconfigureTask(ctx, conversationID, enabled, messageLimit); err != nil {
				if errors.Is(err, errReconfigureSuperseded) {
					return nil
				}
				return err
			}
		}
	}
}

func (s *Service) loadReconfigureBatch(ctx context.Context, enabled bool, messageLimit int) ([]string, error) {
	query := s.db.WithContext(ctx).Model(&store.ConversationAutoNameTask{}).
		Where("status = ?", store.ConversationAutoNameStatusPending)
	if enabled {
		query = query.Where("message_limit <> ?", messageLimit)
	}
	var conversationIDs []string
	err := query.Order("conversation_id ASC").Limit(reconfigureBatchSize).Pluck("conversation_id", &conversationIDs).Error
	return conversationIDs, err
}

func (s *Service) reconfigureTask(ctx context.Context, conversationID string, enabled bool, messageLimit int) error {
	var event *Event
	lockHeld := false
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var conversation store.Conversation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&conversation, "id = ?", conversationID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		var task store.ConversationAutoNameTask
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&task, "conversation_id = ?", conversationID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if task.Status != store.ConversationAutoNameStatusPending {
			return nil
		}
		if conversation.Kind != store.ConversationKindGroup || conversation.Status != store.ConversationStatusActive {
			return tx.Model(&store.ConversationAutoNameTask{}).Where("conversation_id = ?", conversationID).
				Updates(map[string]any{"status": store.ConversationAutoNameStatusSkipped, "updated_at": s.now().UTC()}).Error
		}
		settings, err := loadSettings(tx, s.now().UTC())
		if err != nil {
			return err
		}
		if settings.AssistantAutoGroupNamingEnabled != enabled ||
			settings.AssistantAutoGroupNamingMessageCount != messageLimit {
			return errReconfigureSuperseded
		}
		now := s.now().UTC()
		if !enabled {
			return tx.Model(&store.ConversationAutoNameTask{}).Where("conversation_id = ?", conversationID).
				Updates(map[string]any{"status": store.ConversationAutoNameStatusSkipped, "updated_at": now}).Error
		}
		if task.MessageLimit == messageLimit {
			return nil
		}
		task.MessageLimit = messageLimit
		task.Version++
		updates := map[string]any{"message_limit": messageLimit, "version": task.Version, "updated_at": now}
		if task.MessageCount < messageLimit {
			return tx.Model(&store.ConversationAutoNameTask{}).Where("conversation_id = ?", conversationID).Updates(updates).Error
		}
		if s.locker != nil {
			s.locker.Lock()
			lockHeld = true
		}
		event, err = s.createRequestedEvent(tx, conversation, &task, updates, now)
		return err
	})
	if err != nil {
		if lockHeld {
			s.locker.Unlock()
		}
		return err
	}
	s.Deliver(ctx, event)
	if lockHeld {
		s.locker.Unlock()
	}
	return nil
}

func (s *Service) DeliverEvents(ctx context.Context, events []Event) {
	if len(events) > 0 && s.events != nil {
		s.events.DeliverGroupAutoNameEvents(ctx, events)
	}
}

func (s *Service) MarkFailed(ctx context.Context, conversationID string, version int) error {
	return s.db.WithContext(ctx).Model(&store.ConversationAutoNameTask{}).
		Where("conversation_id = ? AND status = ? AND version = ?", conversationID, store.ConversationAutoNameStatusPending, version).
		Updates(map[string]any{"status": store.ConversationAutoNameStatusFailed, "updated_at": s.now().UTC()}).Error
}

func (s *Service) Deliver(ctx context.Context, event *Event) {
	if event != nil && s.events != nil {
		s.events.DeliverGroupAutoNameEvents(ctx, []Event{*event})
	}
}

func (s *Service) createRequestedEvent(tx *gorm.DB, conversation store.Conversation, task *store.ConversationAutoNameTask, updates map[string]any, now time.Time) (*Event, error) {
	messages, triggerSeq, err := loadRequestedMessages(tx, conversation.ID, task.MessageLimit)
	if err != nil {
		return nil, err
	}
	if len(messages) < task.MessageLimit {
		return nil, tx.Model(&store.ConversationAutoNameTask{}).Where("conversation_id = ?", conversation.ID).Updates(updates).Error
	}
	payload, err := json.Marshal(RequestedPayload{
		ConversationID: conversation.ID,
		MessageLimit:   task.MessageLimit, Messages: messages, TaskVersion: task.Version,
	})
	if err != nil {
		return nil, err
	}
	var assistant store.App
	if err := tx.Select("id").First(&assistant, "id = ?", appregistry.AIAssistantAppID).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		if _, err := appregistry.EnsureAIAssistantApp(tx, s.apps); err != nil {
			return nil, err
		}
	}
	stored := store.AppEventOutbox{
		AppID: appregistry.AIAssistantAppID, Event: EventRequested,
		Payload: payload, CreatedAt: now,
	}
	if err := tx.Create(&stored).Error; err != nil {
		return nil, err
	}
	updates["triggered_version"] = task.Version
	updates["trigger_message_seq"] = triggerSeq
	if err := tx.Model(&store.ConversationAutoNameTask{}).Where("conversation_id = ?", conversation.ID).Updates(updates).Error; err != nil {
		return nil, err
	}
	return &Event{AppID: stored.AppID, Cursor: stored.ID, Event: stored.Event, Payload: stored.Payload}, nil
}

func loadRequestedMessages(tx *gorm.DB, conversationID string, limit int) ([]RequestedMessage, int64, error) {
	var messages []store.Message
	if err := tx.Where("conversation_id = ? AND sender_type IN ? AND revoked_at IS NULL AND deleted_at IS NULL", conversationID, []string{store.MessageSenderTypeUser, store.MessageSenderTypeApp}).
		Order("seq ASC").Limit(limit).Find(&messages).Error; err != nil {
		return nil, 0, err
	}
	result := make([]RequestedMessage, 0, len(messages))
	senderLabels := make(map[string]string)
	for _, message := range messages {
		senderKey := message.SenderType + ":unknown"
		if message.SenderID != nil {
			senderKey = message.SenderType + ":" + *message.SenderID
		}
		label, ok := senderLabels[senderKey]
		if !ok {
			label = fmt.Sprintf("成员%d", len(senderLabels)+1)
			senderLabels[senderKey] = label
		}
		result = append(result, RequestedMessage{
			Sender: label, Summary: truncateSummary(message.Summary),
		})
	}
	if len(messages) == 0 {
		return result, 0, nil
	}
	return result, messages[len(messages)-1].Seq, nil
}

func truncateSummary(value string) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= requestedSummaryMaxRunes {
		return value
	}
	return strings.TrimSpace(string(runes[:requestedSummaryMaxRunes]))
}

func loadSettings(tx *gorm.DB, now time.Time) (store.AppSettings, error) {
	var settings store.AppSettings
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).First(&settings, "id = ?", store.AppSettingsID).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return store.AppSettings{}, err
		}
		defaults := store.AppSettings{
			ID: store.AppSettingsID, AppName: store.DefaultAppName, OrganizationName: store.DefaultOrganizationName,
			PasswordLoginEnabled: true, SMTPPort: 465, SMTPSecurity: "tls",
			AssistantAutoGroupNamingEnabled: true, AssistantAutoGroupNamingMessageCount: store.DefaultAssistantAutoGroupNamingMessageCount,
			CreatedAt: now, UpdatedAt: now,
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&defaults).Error; err != nil {
			return store.AppSettings{}, err
		}
		if err := tx.First(&settings, "id = ?", store.AppSettingsID).Error; err != nil {
			return store.AppSettings{}, err
		}
	}
	if settings.AssistantAutoGroupNamingMessageCount < 1 || settings.AssistantAutoGroupNamingMessageCount > 30 {
		settings.AssistantAutoGroupNamingMessageCount = store.DefaultAssistantAutoGroupNamingMessageCount
	}
	return settings, nil
}
