package conversation

import (
	"context"
	"errors"
	"strings"

	appapp "app/internal/application/app"
	"app/internal/appregistry"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func (s *Service) CreateApp(ctx context.Context, cmd CreateAppCommand) (OpenResult, error) {
	current := actorUser(cmd.Actor)
	appID, err := normalizeUUID(cmd.AppID, "应用 ID 格式错误")
	if err != nil {
		return OpenResult{}, invalidRequest(err.Error(), err)
	}
	if appregistry.IsAIAssistantAppID(appID) {
		if _, err := appregistry.EnsureAIAssistantApp(s.db.WithContext(ctx), s.apps); err != nil {
			return OpenResult{}, internalError(err)
		}
	}
	conversation, app, created, err := s.getOrCreateAccessibleAppConversation(s.db.WithContext(ctx), current, appID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return OpenResult{}, notFound("应用不存在", err)
		}
		return OpenResult{}, internalError(err)
	}
	item := newItem(
		conversation, current.ID,
		[]store.ConversationMember{
			{ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser, MemberID: current.ID},
			{ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeApp, MemberID: app.ID},
		},
		map[string]store.User{current.ID: current}, map[string]store.App{app.ID: app},
	)
	return OpenResult{Conversation: item, Created: created}, nil
}

func (s *Service) OpenAppForUser(ctx context.Context, current Identity, appID string) (Reference, bool, error) {
	conversation, _, created, err := s.getOrCreateAccessibleAppConversation(
		s.db.WithContext(ctx), actorUser(current), strings.TrimSpace(appID),
	)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return Reference{}, false, forbidden("应用无权联系该用户", err)
		}
		return Reference{}, false, err
	}
	return newReference(conversation), created, nil
}

func (s *Service) getOrCreateAccessibleAppConversation(db *gorm.DB, current store.User, appID string) (store.Conversation, store.App, bool, error) {
	now := s.now().UTC()
	var app store.App
	var conversation store.Conversation
	created := false
	err := db.Transaction(func(tx *gorm.DB) error {
		locked, err := appapp.LockUserAccessibleApp(tx, appID, current.ID)
		if err != nil {
			return err
		}
		app = locked
		existing, err := findAppByUser(tx, app.ID, current.ID)
		if err == nil {
			conversation, created = existing, false
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		conversation = store.Conversation{ID: uuid.NewString(), Kind: store.ConversationKindApp, Name: app.Name, Avatar: app.Avatar, CreatedByUserID: current.ID, Status: store.ConversationStatusActive, PostingPolicy: store.ConversationPostingPolicyOpen, Visibility: store.ConversationVisibilityPrivate, CreatedAt: now, UpdatedAt: now}
		if err := tx.Create(&conversation).Error; err != nil {
			return err
		}
		members := []store.ConversationMember{
			{ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser, MemberID: current.ID, Role: store.ConversationMemberRoleOwner, JoinedAt: now, HistoryVisibleFromSeq: 1},
			{ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeApp, MemberID: app.ID, Role: store.ConversationMemberRoleMember, JoinedAt: now, HistoryVisibleFromSeq: 1},
		}
		if err := tx.Create(&members).Error; err != nil {
			return err
		}
		if err := tx.Create(&store.AppConversation{AppID: app.ID, UserID: current.ID, ConversationID: conversation.ID, CreatedAt: now}).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		if isUniqueConstraintError(err) {
			if existing, findErr := findAppByUser(db, app.ID, current.ID); findErr == nil {
				return existing, app, false, nil
			}
		}
		return store.Conversation{}, store.App{}, false, err
	}
	return conversation, app, created, nil
}

func findAppByUser(db *gorm.DB, appID, userID string) (store.Conversation, error) {
	var relation store.AppConversation
	if err := db.First(&relation, "app_id = ? AND user_id = ?", appID, userID).Error; err != nil {
		return store.Conversation{}, err
	}
	var conversation store.Conversation
	if err := db.First(&conversation, "id = ?", relation.ConversationID).Error; err != nil {
		return store.Conversation{}, err
	}
	return conversation, nil
}
