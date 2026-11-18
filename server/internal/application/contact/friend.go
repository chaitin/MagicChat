package contact

import (
	"context"
	"errors"
	"strings"

	"app/internal/store"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *Service) ListFriendRequests(ctx context.Context, cmd ListFriendRequestsCommand) (ListFriendRequestsResult, error) {
	if cmd.Direction != FriendRequestDirectionIncoming && cmd.Direction != FriendRequestDirectionOutgoing {
		return ListFriendRequestsResult{}, invalidError("好友申请方向不支持", nil)
	}
	query := s.db.WithContext(ctx).Where("status = ?", store.FriendRequestStatusPending)
	if cmd.Direction == FriendRequestDirectionIncoming {
		query = query.Where("addressee_user_id = ?", cmd.AccountID)
	} else {
		query = query.Where("requester_user_id = ?", cmd.AccountID)
	}
	var values []store.UserFriendRequest
	if err := query.Order("created_at DESC").Order("id DESC").Find(&values).Error; err != nil {
		return ListFriendRequestsResult{}, internalError(err)
	}
	return ListFriendRequestsResult{Requests: newFriendRequests(values)}, nil
}

func (s *Service) CreateFriendRequest(ctx context.Context, cmd CreateFriendRequestCommand) (FriendRequest, error) {
	parsedUserID, err := uuid.Parse(strings.TrimSpace(cmd.UserID))
	if err != nil {
		return FriendRequest{}, invalidError("好友用户 ID 不正确", err)
	}
	userID := parsedUserID.String()
	if userID == cmd.AccountID {
		return FriendRequest{}, invalidError("不能添加自己为好友", nil)
	}
	recordFriendshipMessage, err := s.shouldRecordFriendshipMessage(ctx)
	if err != nil {
		return FriendRequest{}, err
	}
	now := s.now().UTC()
	var result store.UserFriendRequest
	var messageNotification FriendshipMessageNotification
	createdFriendship := false
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var target store.User
		if err := tx.Select("id").Where("id = ? AND status = ?", userID, store.UserStatusActive).First(&target).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return notFoundError("用户不存在")
			}
			return err
		}
		low, high := friendPair(cmd.AccountID, userID)
		var friendship store.UserFriendship
		if err := tx.Where("user_id_low = ? AND user_id_high = ?", low, high).First(&friendship).Error; err == nil {
			return conflictError("已经是好友")
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var pending store.UserFriendRequest
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("status = ? AND ((requester_user_id = ? AND addressee_user_id = ?) OR (requester_user_id = ? AND addressee_user_id = ?))",
				store.FriendRequestStatusPending, cmd.AccountID, userID, userID, cmd.AccountID).
			First(&pending).Error
		if err == nil {
			if pending.RequesterUserID == cmd.AccountID {
				return conflictError("好友申请已发送")
			}
			pending.Status = store.FriendRequestStatusAccepted
			pending.UpdatedAt = now
			pending.HandledAt = &now
			if err := tx.Save(&pending).Error; err != nil {
				return err
			}
			if err := tx.Create(&store.UserFriendship{UserIDLow: low, UserIDHigh: high, CreatedAt: now}).Error; err != nil {
				return err
			}
			if recordFriendshipMessage {
				messageNotification, err = s.friendshipMessages.RecordFriendshipCreated(ctx, tx, FriendshipMessageCommand{
					ActorUserID: cmd.AccountID, AddresseeUserID: pending.AddresseeUserID,
					CreatedAt: now, RequesterUserID: pending.RequesterUserID,
				})
				if err != nil {
					return err
				}
			}
			result = pending
			createdFriendship = true
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		result = store.UserFriendRequest{
			ID: uuid.NewString(), RequesterUserID: cmd.AccountID, AddresseeUserID: userID,
			Status: store.FriendRequestStatusPending, CreatedAt: now, UpdatedAt: now,
		}
		return tx.Create(&result).Error
	})
	if err != nil {
		return FriendRequest{}, mapFriendError(err)
	}
	eventType := "friend.request.created"
	if createdFriendship {
		eventType = "friendship.created"
	}
	s.publishFriendEvent(ctx, FriendEvent{RequestID: result.ID, Type: eventType, UserIDs: []string{cmd.AccountID, userID}})
	if messageNotification != nil {
		messageNotification(ctx)
	}
	return newFriendRequest(result), nil
}

func (s *Service) AcceptFriendRequest(ctx context.Context, cmd UpdateFriendRequestCommand) (FriendRequest, error) {
	return s.finishFriendRequest(ctx, cmd, store.FriendRequestStatusAccepted)
}

func (s *Service) RejectFriendRequest(ctx context.Context, cmd UpdateFriendRequestCommand) (FriendRequest, error) {
	return s.finishFriendRequest(ctx, cmd, store.FriendRequestStatusRejected)
}

func (s *Service) CancelFriendRequest(ctx context.Context, cmd UpdateFriendRequestCommand) (FriendRequest, error) {
	requestID, err := parseRequestID(cmd.RequestID)
	if err != nil {
		return FriendRequest{}, err
	}
	now := s.now().UTC()
	var value store.UserFriendRequest
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND requester_user_id = ? AND status = ?", requestID, cmd.AccountID, store.FriendRequestStatusPending).
			First(&value).Error; err != nil {
			return err
		}
		value.Status = store.FriendRequestStatusCanceled
		value.UpdatedAt = now
		value.HandledAt = &now
		return tx.Save(&value).Error
	})
	if err != nil {
		return FriendRequest{}, mapFriendError(err)
	}
	s.publishFriendEvent(ctx, FriendEvent{RequestID: value.ID, Type: "friend.request.updated", UserIDs: []string{value.RequesterUserID, value.AddresseeUserID}})
	return newFriendRequest(value), nil
}

func (s *Service) DeleteFriend(ctx context.Context, cmd DeleteFriendCommand) error {
	parsedUserID, err := uuid.Parse(strings.TrimSpace(cmd.UserID))
	if err != nil {
		return invalidError("好友用户 ID 不正确", err)
	}
	userID := parsedUserID.String()
	if userID == cmd.AccountID {
		return invalidError("好友用户 ID 不正确", nil)
	}
	low, high := friendPair(cmd.AccountID, userID)
	result := s.db.WithContext(ctx).Where("user_id_low = ? AND user_id_high = ?", low, high).Delete(&store.UserFriendship{})
	if result.Error != nil {
		return internalError(result.Error)
	}
	if result.RowsAffected == 0 {
		return notFoundError("好友关系不存在")
	}
	s.publishFriendEvent(ctx, FriendEvent{Type: "friendship.deleted", UserIDs: []string{cmd.AccountID, userID}})
	return nil
}

func (s *Service) SearchUsers(ctx context.Context, cmd SearchUsersCommand) (SearchUsersResult, error) {
	query := strings.TrimSpace(cmd.Query)
	if query == "" || len(query) > 320 {
		return SearchUsersResult{}, invalidError("请输入完整邮箱、手机号或用户 ID", nil)
	}
	var values []store.User
	db := s.db.WithContext(ctx).Select("id").Where("status = ? AND id <> ?", store.UserStatusActive, cmd.AccountID)
	if parsed, err := uuid.Parse(query); err == nil {
		db = db.Where("id = ?", parsed.String())
	} else if strings.Contains(query, "@") {
		db = db.Where("LOWER(email) = ?", strings.ToLower(query))
	} else {
		db = db.Where("phone = ?", query)
	}
	if s.organization != nil && s.settings != nil {
		mode, err := s.settings.ContactDirectoryMode(ctx)
		if err != nil {
			return SearchUsersResult{}, internalError(err)
		}
		if mode == DirectoryModeOrganization {
			ids, err := s.organization.VisibleUserIDs(ctx, cmd.AccountID)
			if err != nil {
				return SearchUsersResult{}, internalError(err)
			}
			if ids != nil {
				db = db.Where("id IN ?", ids)
			}
		}
	}
	if err := db.Limit(10).Find(&values).Error; err != nil {
		return SearchUsersResult{}, internalError(err)
	}
	ids := make([]string, 0, len(values))
	for _, value := range values {
		ids = append(ids, value.ID)
	}
	return SearchUsersResult{UserIDs: ids}, nil
}

func (s *Service) finishFriendRequest(ctx context.Context, cmd UpdateFriendRequestCommand, status string) (FriendRequest, error) {
	requestID, err := parseRequestID(cmd.RequestID)
	if err != nil {
		return FriendRequest{}, err
	}
	recordFriendshipMessage := false
	if status == store.FriendRequestStatusAccepted {
		recordFriendshipMessage, err = s.shouldRecordFriendshipMessage(ctx)
		if err != nil {
			return FriendRequest{}, err
		}
	}
	now := s.now().UTC()
	var value store.UserFriendRequest
	var messageNotification FriendshipMessageNotification
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND addressee_user_id = ? AND status = ?", requestID, cmd.AccountID, store.FriendRequestStatusPending).
			First(&value).Error; err != nil {
			return err
		}
		value.Status = status
		value.UpdatedAt = now
		value.HandledAt = &now
		if err := tx.Save(&value).Error; err != nil {
			return err
		}
		if status == store.FriendRequestStatusAccepted {
			low, high := friendPair(value.RequesterUserID, value.AddresseeUserID)
			friendshipResult := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&store.UserFriendship{
				UserIDLow: low, UserIDHigh: high, CreatedAt: now,
			})
			if friendshipResult.Error != nil {
				return friendshipResult.Error
			}
			if recordFriendshipMessage && friendshipResult.RowsAffected > 0 {
				messageNotification, err = s.friendshipMessages.RecordFriendshipCreated(ctx, tx, FriendshipMessageCommand{
					ActorUserID: cmd.AccountID, AddresseeUserID: value.AddresseeUserID,
					CreatedAt: now, RequesterUserID: value.RequesterUserID,
				})
				return err
			}
		}
		return nil
	})
	if err != nil {
		return FriendRequest{}, mapFriendError(err)
	}
	eventType := "friend.request.updated"
	if status == store.FriendRequestStatusAccepted {
		eventType = "friendship.created"
	}
	s.publishFriendEvent(ctx, FriendEvent{RequestID: value.ID, Type: eventType, UserIDs: []string{value.RequesterUserID, value.AddresseeUserID}})
	if messageNotification != nil {
		messageNotification(ctx)
	}
	return newFriendRequest(value), nil
}

func friendPair(left, right string) (string, string) {
	if left < right {
		return left, right
	}
	return right, left
}

func parseRequestID(raw string) (string, error) {
	parsed, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", invalidError("好友申请 ID 不正确", err)
	}
	return parsed.String(), nil
}

func mapFriendError(err error) error {
	var contactErr *Error
	if errors.As(err, &contactErr) {
		return err
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return notFoundError("好友申请不存在或已处理")
	}
	var postgresError *pq.Error
	if errors.As(err, &postgresError) && postgresError.Code == "23505" {
		return conflictError("好友关系或申请已存在")
	}
	if strings.Contains(strings.ToLower(err.Error()), "unique constraint") {
		return conflictError("好友关系或申请已存在")
	}
	return internalError(err)
}

func newFriendRequest(value store.UserFriendRequest) FriendRequest {
	return FriendRequest{
		ID: value.ID, RequesterUserID: value.RequesterUserID, AddresseeUserID: value.AddresseeUserID,
		Status: value.Status, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt, HandledAt: value.HandledAt,
	}
}

func newFriendRequests(values []store.UserFriendRequest) []FriendRequest {
	result := make([]FriendRequest, 0, len(values))
	for _, value := range values {
		result = append(result, newFriendRequest(value))
	}
	return result
}

func (s *Service) publishFriendEvent(ctx context.Context, event FriendEvent) {
	if s.notifications != nil {
		s.notifications.PublishFriendEvent(ctx, event)
	}
}

func (s *Service) shouldRecordFriendshipMessage(ctx context.Context) (bool, error) {
	if s.friendshipMessages == nil {
		return false, nil
	}
	if s.settings == nil {
		return false, internalError(errors.New("contact directory settings are unavailable"))
	}
	mode, err := s.settings.ContactDirectoryMode(ctx)
	if err != nil {
		return false, internalError(err)
	}
	return mode == DirectoryModeFriends, nil
}
