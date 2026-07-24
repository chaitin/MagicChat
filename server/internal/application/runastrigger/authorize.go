package runastrigger

import (
	"errors"
	"strings"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrUnauthorized = errors.New("run-as trigger is unauthorized")

type Command struct {
	ActorID                     string
	ActorType                   string
	AuthorizationConversationID string
	TriggerMessageID            string
}

type Result struct {
	ConversationID string
}

// Authorize verifies the database-backed facts that make a message a valid
// run-as trigger. Callers remain responsible for checking that their app can
// access the authorization conversation and that the actor can perform the
// requested operation.
func Authorize(db *gorm.DB, cmd Command) (Result, error) {
	actorID := strings.TrimSpace(cmd.ActorID)
	actorType := strings.ToLower(strings.TrimSpace(cmd.ActorType))
	triggerMessageID := strings.TrimSpace(cmd.TriggerMessageID)
	authorizationConversationID := strings.TrimSpace(cmd.AuthorizationConversationID)
	if db == nil || actorID == "" || triggerMessageID == "" ||
		(actorType != store.MessageSenderTypeUser && actorType != store.MessageSenderTypeApp) {
		return Result{}, ErrUnauthorized
	}

	if actorType == store.MessageSenderTypeUser {
		var actor store.User
		err := db.Clauses(clause.Locking{Strength: "SHARE"}).Select("id").First(
			&actor, "id = ? AND status = ?", actorID, store.UserStatusActive,
		).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return Result{}, ErrUnauthorized
		}
		if err != nil {
			return Result{}, err
		}
	}

	conversationID, err := findConversationID(db, actorType, actorID, triggerMessageID)
	if errors.Is(err, gorm.ErrRecordNotFound) && actorType == store.MessageSenderTypeUser {
		var response store.MessageChoiceResponse
		err = db.Clauses(clause.Locking{Strength: "SHARE"}).Select("conversation_id").First(
			&response, "id = ? AND user_id = ?", triggerMessageID, actorID,
		).Error
		conversationID = response.ConversationID
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Result{}, ErrUnauthorized
	}
	if err != nil {
		return Result{}, err
	}
	if authorizationConversationID != "" && conversationID != authorizationConversationID {
		return Result{}, ErrUnauthorized
	}
	return Result{ConversationID: conversationID}, nil
}

func findConversationID(db *gorm.DB, actorType, actorID, triggerMessageID string) (string, error) {
	now := time.Now().UTC()
	if store.MessagePartitioningEnabled(db) {
		var registry store.MessageRegistry
		err := db.Clauses(clause.Locking{Strength: "SHARE"}).Where(
			"partition_year >= ? AND partition_year <= ?",
			store.MessageMinimumOnlineYear(now), store.MessageMaximumOnlineYear(now),
		).Select("conversation_id").First(
			&registry,
			"id = ? AND sender_type = ? AND sender_id = ? AND deleted_at IS NULL AND revoked_at IS NULL",
			triggerMessageID, actorType, actorID,
		).Error
		return registry.ConversationID, err
	}

	var trigger store.Message
	err := db.Clauses(clause.Locking{Strength: "SHARE"}).Where(
		"created_at >= ? AND created_at < ?", store.MessageOnlineCutoff(now), store.MessageOnlineEnd(now),
	).Select("conversation_id").First(
		&trigger,
		"id = ? AND sender_type = ? AND sender_id = ? AND deleted_at IS NULL AND revoked_at IS NULL",
		triggerMessageID, actorType, actorID,
	).Error
	return trigger.ConversationID, err
}
