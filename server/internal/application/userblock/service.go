package userblock

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Dependencies struct {
	DB  *gorm.DB
	Now func() time.Time
}

type Service struct {
	db  *gorm.DB
	now func() time.Time
}

func NewService(deps Dependencies) *Service {
	now := deps.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{db: deps.DB, now: now}
}

func (s *Service) Block(ctx context.Context, command Command) (Status, error) {
	accountID, userID, err := normalizeCommand(command)
	if err != nil {
		return Status{}, err
	}
	value := store.UserBlock{}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := requireUser(tx, userID); err != nil {
			return err
		}
		if err := lockDirectConversation(tx, accountID, userID); err != nil {
			return err
		}
		candidate := store.UserBlock{
			BlockerUserID: accountID,
			BlockedUserID: userID,
			CreatedAt:     s.now().UTC(),
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate).Error; err != nil {
			return err
		}
		return tx.First(&value, "blocker_user_id = ? AND blocked_user_id = ?", accountID, userID).Error
	})
	if err != nil {
		return Status{}, mapError(err)
	}
	blockedAt := value.CreatedAt
	return Status{Blocked: true, BlockedAt: &blockedAt, UserID: userID}, nil
}

func (s *Service) GetStatus(ctx context.Context, command Command) (Status, error) {
	accountID, userID, err := normalizeCommand(command)
	if err != nil {
		return Status{}, err
	}
	db := s.db.WithContext(ctx)
	if err := requireUser(db, userID); err != nil {
		return Status{}, mapError(err)
	}
	var value store.UserBlock
	err = db.First(&value, "blocker_user_id = ? AND blocked_user_id = ?", accountID, userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Status{UserID: userID}, nil
	}
	if err != nil {
		return Status{}, internalError(err)
	}
	blockedAt := value.CreatedAt
	return Status{Blocked: true, BlockedAt: &blockedAt, UserID: userID}, nil
}

func (s *Service) Unblock(ctx context.Context, command Command) error {
	accountID, userID, err := normalizeCommand(command)
	if err != nil {
		return err
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockDirectConversation(tx, accountID, userID); err != nil {
			return err
		}
		return tx.Where("blocker_user_id = ? AND blocked_user_id = ?", accountID, userID).
			Delete(&store.UserBlock{}).Error
	})
	if err != nil {
		return internalError(err)
	}
	return nil
}

func normalizeCommand(command Command) (string, string, error) {
	accountID := strings.ToLower(strings.TrimSpace(command.AccountID))
	userID := strings.ToLower(strings.TrimSpace(command.UserID))
	if _, err := uuid.Parse(accountID); err != nil {
		return "", "", invalidError("当前用户无效", err)
	}
	if _, err := uuid.Parse(userID); err != nil {
		return "", "", invalidError("用户 ID 无效", err)
	}
	if accountID == userID {
		return "", "", invalidError("不能将自己加入黑名单", nil)
	}
	return accountID, userID, nil
}

func requireUser(db *gorm.DB, userID string) error {
	var count int64
	if err := db.Model(&store.User{}).Where("id = ?", userID).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func lockDirectConversation(db *gorm.DB, firstUserID string, secondUserID string) error {
	ids := []string{firstUserID, secondUserID}
	sort.Strings(ids)
	var direct store.DirectConversation
	err := db.Where("user_low_id = ? AND user_high_id = ?", ids[0], ids[1]).First(&direct).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	var conversation store.Conversation
	return db.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id").First(&conversation, "id = ?", direct.ConversationID).Error
}

func mapError(err error) error {
	var blockErr *Error
	if errors.As(err, &blockErr) {
		return err
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return notFoundError()
	}
	return internalError(err)
}

var _ ClientService = (*Service)(nil)
