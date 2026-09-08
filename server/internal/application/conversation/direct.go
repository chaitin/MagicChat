package conversation

import (
	"context"
	"errors"
	"sort"
	"strings"

	"app/internal/application/directmessagepolicy"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *Service) CreateDirect(ctx context.Context, cmd CreateDirectCommand) (OpenResult, error) {
	current := actorUser(cmd.Actor)
	targetID, err := normalizeDirectUserID(cmd.UserID, current.ID)
	if err != nil {
		return OpenResult{}, invalidRequest(err.Error(), err)
	}
	db := s.db.WithContext(ctx)
	var target store.User
	err = db.First(&target, "id = ? AND status = ?", targetID, store.UserStatusActive).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return OpenResult{}, invalidRequest("用户不存在或已禁用", err)
	}
	if err != nil {
		return OpenResult{}, internalError(err)
	}
	if s.directMessaging != nil {
		if err := s.directMessaging.Require(db, current.ID, target.ID); err != nil {
			if errors.Is(err, directmessagepolicy.ErrRecipientUnavailable) {
				return OpenResult{}, &Error{Code: CodeDirectMessageUnavailable, Message: "当前无法向该用户发送消息", Cause: err}
			}
			if errors.Is(err, directmessagepolicy.ErrFriendshipRequired) {
				return OpenResult{}, &Error{Code: CodeDirectFriendshipRequired, Message: "仅好友之间可以发送私聊消息", Cause: err}
			}
			return OpenResult{}, internalError(err)
		}
	}
	conversation, created, err := s.getOrCreateDirect(db, current, target)
	if err != nil {
		return OpenResult{}, internalError(err)
	}
	conversation, restored, err := s.restoreConversationPreference(db, current.ID, conversation.ID)
	if err != nil {
		return OpenResult{}, internalError(err)
	}
	item := newItem(
		conversation, current.ID,
		[]store.ConversationMember{
			{ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser, MemberID: current.ID},
			{ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser, MemberID: target.ID},
		},
		map[string]store.User{current.ID: current, target.ID: target}, nil,
	)
	lastMessageSenders, err := loadLastMessageSenders(db, []store.Conversation{conversation})
	if err != nil {
		return OpenResult{}, internalError(err)
	}
	item.LastMessageSender = lastMessageSenders[conversation.ID]
	if err := s.loadItemPreferenceState(db, &item, current.ID); err != nil {
		return OpenResult{}, internalError(err)
	}
	s.publishConversationRestored(ctx, current.ID, conversation.ID, restored)
	return OpenResult{Conversation: item, Created: created}, nil
}

func (s *Service) OpenDirectForUsers(ctx context.Context, current, target Identity) (Reference, bool, error) {
	conversation, created, err := s.getOrCreateDirect(s.db, actorUser(current), actorUser(target))
	if err != nil {
		return Reference{}, false, err
	}
	return newReference(conversation), created, nil
}

func (s *Service) RecordFriendshipCreated(ctx context.Context, db *gorm.DB, cmd RecordFriendshipCreatedCommand) (RecordFriendshipCreatedResult, error) {
	db = db.WithContext(ctx)
	userIDs := []string{cmd.RequesterUserID, cmd.AddresseeUserID}
	var users []store.User
	if err := db.Where("id IN ? AND status = ?", userIDs, store.UserStatusActive).Find(&users).Error; err != nil {
		return RecordFriendshipCreatedResult{}, err
	}
	usersByID := make(map[string]store.User, len(users))
	for _, user := range users {
		usersByID[user.ID] = user
	}
	requester, requesterFound := usersByID[cmd.RequesterUserID]
	addressee, addresseeFound := usersByID[cmd.AddresseeUserID]
	if !requesterFound || !addresseeFound {
		return RecordFriendshipCreatedResult{}, gorm.ErrRecordNotFound
	}
	conversation, _, err := s.getOrCreateDirect(db, requester, addressee)
	if err != nil {
		return RecordFriendshipCreatedResult{}, err
	}
	if err := db.Clauses(clause.Locking{Strength: "UPDATE"}).First(&conversation, "id = ?", conversation.ID).Error; err != nil {
		return RecordFriendshipCreatedResult{}, err
	}
	storedMessage, err := createFriendshipCreatedSystemMessage(db, &conversation, cmd.CreatedAt)
	if err != nil {
		return RecordFriendshipCreatedResult{}, err
	}
	if err := advanceReadSeq(db, conversation.ID, cmd.ActorUserID, storedMessage.Seq); err != nil {
		return RecordFriendshipCreatedResult{}, err
	}
	restoredUserIDs := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		if _, restored, err := s.restoreConversationPreference(db, userID, conversation.ID); err != nil {
			return RecordFriendshipCreatedResult{}, err
		} else if restored {
			restoredUserIDs = append(restoredUserIDs, userID)
		}
	}
	return RecordFriendshipCreatedResult{
		Message: newMessage(storedMessage), RestoredUserIDs: restoredUserIDs, UserIDs: userIDs,
	}, nil
}

func (s *Service) PublishFriendshipCreated(ctx context.Context, result RecordFriendshipCreatedResult) {
	if s.notifications == nil {
		return
	}
	for _, userID := range result.RestoredUserIDs {
		s.notifications.PublishConversationRestored(ctx, []string{userID}, result.Message.ConversationID)
	}
	s.notifications.PublishConversationMessage(ctx, result.UserIDs, result.Message)
}

func (s *Service) getOrCreateDirect(db *gorm.DB, current, target store.User) (store.Conversation, bool, error) {
	lowID, highID := orderUserIDs(current.ID, target.ID)
	existing, err := findDirectByPair(db, lowID, highID)
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return store.Conversation{}, false, err
	}
	now := s.now().UTC()
	conversation := store.Conversation{ID: uuid.NewString(), Kind: store.ConversationKindDirect, CreatedByUserID: current.ID, Status: store.ConversationStatusActive, PostingPolicy: store.ConversationPostingPolicyOpen, Visibility: store.ConversationVisibilityPrivate, CreatedAt: now, UpdatedAt: now}
	created := false
	err = db.Transaction(func(tx *gorm.DB) error {
		existing, err := findDirectByPair(tx, lowID, highID)
		if err == nil {
			conversation, created = existing, false
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := tx.Create(&conversation).Error; err != nil {
			return err
		}
		members := []store.ConversationMember{
			{ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser, MemberID: current.ID, Role: store.ConversationMemberRoleOwner, JoinedAt: now, HistoryVisibleFromSeq: 1},
			{ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser, MemberID: target.ID, Role: store.ConversationMemberRoleMember, JoinedAt: now, HistoryVisibleFromSeq: 1},
		}
		if err := tx.Create(&members).Error; err != nil {
			return err
		}
		if err := tx.Create(&store.DirectConversation{ConversationID: conversation.ID, UserLowID: lowID, UserHighID: highID, CreatedAt: now}).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		if isUniqueConstraintError(err) {
			if existing, findErr := findDirectByPair(db, lowID, highID); findErr == nil {
				return existing, false, nil
			}
		}
		return store.Conversation{}, false, err
	}
	return conversation, created, nil
}

func findDirectByPair(db *gorm.DB, lowID, highID string) (store.Conversation, error) {
	var direct store.DirectConversation
	if err := db.First(&direct, "user_low_id = ? AND user_high_id = ?", lowID, highID).Error; err != nil {
		return store.Conversation{}, err
	}
	var conversation store.Conversation
	if err := db.First(&conversation, "id = ?", direct.ConversationID).Error; err != nil {
		return store.Conversation{}, err
	}
	return conversation, nil
}

func orderUserIDs(first, second string) (string, string) {
	ids := []string{strings.TrimSpace(first), strings.TrimSpace(second)}
	sort.Strings(ids)
	return ids[0], ids[1]
}
