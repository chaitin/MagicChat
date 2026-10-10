package mobilepush

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"app/internal/application/conversationaccess"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *Service) fanoutEvent(ctx context.Context, event store.MobilePushEvent) error {
	now := s.now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var owned store.MobilePushEvent
		result := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"id = ? AND status = ? AND lock_token = ?", event.ID, EventStatusExpanding, event.LockToken,
		).Limit(1).Find(&owned)
		if result.Error != nil || result.RowsAffected == 0 {
			return result.Error
		}
		if !owned.ExpiresAt.After(now) {
			return expireOwnedEvent(tx, owned, now, "ttl_expired")
		}
		message, found, err := loadPushEventMessage(ctx, tx, owned)
		if err != nil {
			return err
		}
		if !found || message.DeletedAt != nil || message.RevokedAt != nil {
			return deleteOwnedEvent(tx, owned)
		}
		access, err := conversationaccess.Load(tx, owned.ConversationID, false)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return deleteOwnedEvent(tx, owned)
		}
		if err != nil {
			return err
		}
		if access.Conversation.Status != store.ConversationStatusActive ||
			(access.ParentConversation != nil && access.ParentConversation.Status != store.ConversationStatusActive) {
			return deleteOwnedEvent(tx, owned)
		}
		userIDs, err := conversationaccess.ActiveUserIDs(tx, access)
		if err != nil {
			return err
		}
		userIDs, err = filterVisiblePushUserIDs(tx, access, userIDs, message.Seq)
		if err != nil {
			return err
		}
		if len(userIDs) == 0 {
			return deleteOwnedEvent(tx, owned)
		}
		muted, err := loadMutedPushUsers(tx, owned.ConversationID, userIDs)
		if err != nil {
			return err
		}
		actorUserID := pushMessageActorUserID(message)
		eligibleUserIDs := make([]string, 0, len(userIDs))
		for _, userID := range userIDs {
			if userID == actorUserID || muted[userID] {
				continue
			}
			eligibleUserIDs = append(eligibleUserIDs, userID)
		}
		if len(eligibleUserIDs) == 0 {
			return deleteOwnedEvent(tx, owned)
		}
		var grants []store.UserPushGrant
		if err := tx.Where(
			"user_id IN ? AND status = ? AND expires_at > ?", eligibleUserIDs, GrantStatusActive, now,
		).Find(&grants).Error; err != nil {
			return err
		}
		for _, grant := range grants {
			if err := s.createPushJob(tx, grant, message, owned.ExpiresAt, now); err != nil {
				return err
			}
		}
		return deleteOwnedEvent(tx, owned)
	})
}

func (s *Service) pushJobStillEligible(
	ctx context.Context,
	job store.MobilePushJob,
	now time.Time,
) (bool, error) {
	db := s.db.WithContext(ctx)
	var sessionCount int64
	if err := db.Model(&store.UserSession{}).
		Joins("JOIN users ON users.id = user_sessions.user_id").
		Where(
			"user_sessions.id = ? AND user_sessions.user_id = ? AND users.status = ? AND (user_sessions.expires_at > ? OR (user_sessions.refresh_token_hash IS NOT NULL AND user_sessions.refresh_expires_at > ? AND user_sessions.refresh_absolute_expires_at > ?))",
			job.Grant.SessionID, job.UserID, store.UserStatusActive, now, now, now,
		).Count(&sessionCount).Error; err != nil {
		return false, err
	}
	if sessionCount == 0 {
		return false, nil
	}

	var registry store.MessageRegistry
	result := db.Where(
		"id = ? AND conversation_id = ? AND deleted_at IS NULL AND revoked_at IS NULL",
		job.MessageID, job.ConversationID,
	).Limit(1).Find(&registry)
	if result.Error != nil || result.RowsAffected == 0 {
		return false, result.Error
	}
	actorUserID := ""
	if registry.SenderType == store.MessageSenderTypeUser && registry.SenderID != nil {
		actorUserID = *registry.SenderID
	} else {
		message, found, err := loadRegisteredPushMessage(ctx, db, registry)
		if err != nil || !found || message.DeletedAt != nil || message.RevokedAt != nil {
			return false, err
		}
		actorUserID = pushMessageActorUserID(message)
	}
	access, err := conversationaccess.Load(db, job.ConversationID, false)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if access.Conversation.Status != store.ConversationStatusActive ||
		(access.ParentConversation != nil && access.ParentConversation.Status != store.ConversationStatusActive) {
		return false, nil
	}
	activeUserIDs, err := conversationaccess.ActiveUserIDs(db, access)
	if err != nil {
		return false, err
	}
	active := false
	for _, userID := range activeUserIDs {
		if userID == job.UserID {
			active = true
			break
		}
	}
	if !active {
		return false, nil
	}
	visibleUserIDs, err := filterVisiblePushUserIDs(db, access, []string{job.UserID}, registry.Seq)
	if err != nil || len(visibleUserIDs) == 0 {
		return false, err
	}
	muted, err := loadMutedPushUsers(db, job.ConversationID, []string{job.UserID})
	if err != nil {
		return false, err
	}
	return actorUserID != job.UserID && !muted[job.UserID], nil
}

func loadRegisteredPushMessage(
	ctx context.Context,
	db *gorm.DB,
	registry store.MessageRegistry,
) (store.Message, bool, error) {
	if store.MessagePartitioningEnabled(db) {
		message, err := store.LoadMessageByRegistry(ctx, db, registry)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return store.Message{}, false, nil
		}
		return message, err == nil, err
	}
	var message store.Message
	result := db.Where(
		"id = ? AND conversation_id = ? AND seq = ?", registry.ID, registry.ConversationID, registry.Seq,
	).Limit(1).Find(&message)
	return message, result.RowsAffected > 0, result.Error
}

func loadPushEventMessage(
	ctx context.Context,
	db *gorm.DB,
	event store.MobilePushEvent,
) (store.Message, bool, error) {
	if !store.MessagePartitioningEnabled(db) {
		var message store.Message
		result := db.Where(
			"id = ? AND conversation_id = ? AND seq = ?", event.MessageID, event.ConversationID, event.MessageSeq,
		).Limit(1).Find(&message)
		return message, result.RowsAffected > 0, result.Error
	}
	var registry store.MessageRegistry
	result := db.Where(
		"id = ? AND conversation_id = ? AND seq = ?", event.MessageID, event.ConversationID, event.MessageSeq,
	).Limit(1).Find(&registry)
	if result.Error != nil || result.RowsAffected == 0 {
		return store.Message{}, false, result.Error
	}
	return loadRegisteredPushMessage(ctx, db, registry)
}

func filterVisiblePushUserIDs(
	db *gorm.DB,
	access conversationaccess.Context,
	userIDs []string,
	messageSeq int64,
) ([]string, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	var members []store.ConversationMember
	if err := db.Where(
		"conversation_id = ? AND member_type = ? AND member_id IN ? AND left_at IS NULL",
		access.MembershipConversationID, store.ConversationMemberTypeUser, userIDs,
	).Find(&members).Error; err != nil {
		return nil, err
	}
	membersByID := make(map[string]store.ConversationMember, len(members))
	for _, member := range members {
		membersByID[member.MemberID] = member
	}
	participantsByID := make(map[string]store.ConversationTopicParticipant)
	if access.IsTopic() {
		var participants []store.ConversationTopicParticipant
		if err := db.Where(
			"conversation_id = ? AND participant_type = ? AND participant_id IN ?",
			access.Conversation.ID, store.ConversationMemberTypeUser, userIDs,
		).Find(&participants).Error; err != nil {
			return nil, err
		}
		for _, participant := range participants {
			participantsByID[participant.ParticipantID] = participant
		}
	}
	result := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		member, ok := membersByID[userID]
		if !ok || !conversationaccess.TopicSourceVisibleToMember(access, member) {
			continue
		}
		visibleFromSeq := member.HistoryVisibleFromSeq
		if access.IsTopic() {
			participant, participantOK := participantsByID[userID]
			if !participantOK {
				continue
			}
			visibleFromSeq = participant.HistoryVisibleFromSeq
		}
		if visibleFromSeq < 1 {
			visibleFromSeq = 1
		}
		if messageSeq >= visibleFromSeq {
			result = append(result, userID)
		}
	}
	return result, nil
}

func loadMutedPushUsers(db *gorm.DB, conversationID string, userIDs []string) (map[string]bool, error) {
	var preferences []store.ConversationUserPreference
	if err := db.Select("user_id", "notification_muted").Where(
		"conversation_id = ? AND user_id IN ? AND notification_muted = ?", conversationID, userIDs, true,
	).Find(&preferences).Error; err != nil {
		return nil, err
	}
	result := make(map[string]bool, len(preferences))
	for _, preference := range preferences {
		result[preference.UserID] = true
	}
	return result, nil
}

func pushMessageActorUserID(message store.Message) string {
	if message.SenderType == store.MessageSenderTypeUser && message.SenderID != nil {
		return *message.SenderID
	}
	if message.DelegatedByType != nil && *message.DelegatedByType == store.MessageSenderTypeUser && message.DelegatedByID != nil {
		return *message.DelegatedByID
	}
	if message.SenderType != store.MessageSenderTypeSystem || len(message.Body) == 0 {
		return ""
	}
	var event struct {
		Type  string `json:"type"`
		Event string `json:"event"`
		Actor struct {
			ID string `json:"id"`
		} `json:"actor"`
		Inviter struct {
			ID string `json:"id"`
		} `json:"inviter"`
	}
	if json.Unmarshal(message.Body, &event) != nil || event.Type != "system_event" {
		return ""
	}
	if event.Event == "group_members_invited" {
		return event.Inviter.ID
	}
	return event.Actor.ID
}

func (s *Service) createPushJob(
	tx *gorm.DB,
	grant store.UserPushGrant,
	message store.Message,
	expiresAt time.Time,
	now time.Time,
) error {
	var count int64
	if err := tx.Model(&store.MobilePushJob{}).
		Where("grant_id = ? AND message_id = ?", grant.ID, message.ID).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	routeToken, err := randomToken()
	if err != nil {
		return err
	}
	jobID := uuid.NewString()
	routeCiphertext, err := s.cipher.Encrypt(routeToken, []byte(jobID))
	if err != nil {
		return err
	}
	route := store.MobilePushRoute{
		TokenHash: tokenHash(routeToken), UserID: grant.UserID,
		ConversationID: message.ConversationID, MessageID: message.ID,
		ExpiresAt: now.Add(pushRouteTTL), CreatedAt: now,
	}
	if err := tx.Create(&route).Error; err != nil {
		return err
	}
	job := store.MobilePushJob{
		ID: jobID, GrantID: grant.ID, UserID: grant.UserID,
		ConversationID: message.ConversationID, MessageID: message.ID,
		RouteTokenCiphertext: routeCiphertext, Status: JobStatusQueued,
		NextAttemptAt: now, ExpiresAt: expiresAt,
		CreatedAt: now, UpdatedAt: now,
	}
	result := tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "grant_id"}, {Name: "message_id"}}, DoNothing: true,
	}).Create(&job)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return tx.Delete(&route).Error
	}
	return nil
}

func deleteOwnedEvent(db *gorm.DB, event store.MobilePushEvent) error {
	return db.Where(
		"id = ? AND status = ? AND lock_token = ?", event.ID, EventStatusExpanding, event.LockToken,
	).Delete(&store.MobilePushEvent{}).Error
}

func expireOwnedEvent(db *gorm.DB, event store.MobilePushEvent, now time.Time, code string) error {
	return db.Model(&store.MobilePushEvent{}).Where(
		"id = ? AND status = ? AND lock_token = ?", event.ID, EventStatusExpanding, event.LockToken,
	).Updates(map[string]any{
		"status": EventStatusExpired, "locked_at": nil, "lock_token": "",
		"last_error_code": code, "updated_at": now,
	}).Error
}
