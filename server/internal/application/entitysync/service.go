package entitysync

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	contactapp "app/internal/application/contact"
	conversationapp "app/internal/application/conversation"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Entity struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

func (e Entity) Key() string { return e.Type + ":" + e.ID }

type Snapshot struct {
	Users         []contactapp.User
	Apps          []contactapp.App
	Groups        []contactapp.Group
	Conversations []conversationapp.Item
	Versions      map[string]int64
	Removed       []Entity
}

type Service struct {
	db            *gorm.DB
	contacts      *contactapp.Service
	conversations *conversationapp.Service
}

func NewService(db *gorm.DB) *Service {
	return &Service{
		db:            db,
		contacts:      contactapp.NewService(contactapp.Dependencies{DB: db}),
		conversations: conversationapp.NewService(conversationapp.Dependencies{DB: db}),
	}
}

func (s *Service) Resolve(ctx context.Context, accountID string, entities []Entity) (Snapshot, error) {
	var result Snapshot
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		reader := NewService(tx)
		var err error
		result, err = reader.resolve(ctx, accountID, entities)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

func (s *Service) resolve(ctx context.Context, accountID string, entities []Entity) (Snapshot, error) {
	if len(entities) > 100 {
		return Snapshot{}, fmt.Errorf("每次最多同步 100 个实体")
	}
	ids := map[string][]string{"user": {}, "app": {}, "group": {}}
	unique := make(map[string]Entity, len(entities))
	for _, entity := range entities {
		if _, supported := ids[entity.Type]; !supported {
			return Snapshot{}, fmt.Errorf("不支持的实体类型")
		}
		parsed, err := uuid.Parse(entity.ID)
		if err != nil {
			return Snapshot{}, fmt.Errorf("实体 ID 格式错误")
		}
		entity.ID = parsed.String()
		if _, exists := unique[entity.Key()]; exists {
			continue
		}
		unique[entity.Key()] = entity
		ids[entity.Type] = append(ids[entity.Type], entity.ID)
	}

	// Read revisions BEFORE materializing data. A racing write may make the
	// snapshot newer, never label an older snapshot with a newer revision.
	var changes []store.ClientEntityChange
	allIDs := append(append(append([]string{}, ids["user"]...), ids["app"]...), ids["group"]...)
	if len(allIDs) > 0 {
		if err := s.db.WithContext(ctx).Where("entity_id IN ? AND recipient_id = ''", allIDs).Find(&changes).Error; err != nil {
			return Snapshot{}, err
		}
	}
	versions := make(map[string]int64, len(changes))
	for _, change := range changes {
		versions[change.Type+":"+change.EntityID] = change.Revision
	}
	users, err := s.contacts.ResolveUsers(ctx, contactapp.ResolveUsersCommand{UserIDs: ids["user"]})
	if err != nil {
		return Snapshot{}, err
	}
	directory, err := s.contacts.ResolveDirectory(ctx, accountID, ids["app"], ids["group"])
	if err != nil {
		return Snapshot{}, err
	}
	conversations, err := s.conversations.ResolveGroups(ctx, accountID, ids["group"])
	if err != nil {
		return Snapshot{}, err
	}
	result := Snapshot{Users: users.Users, Apps: directory.Apps, Groups: directory.Groups, Conversations: conversations, Versions: map[string]int64{}, Removed: []Entity{}}
	visible := make(map[string]bool)
	for _, user := range result.Users {
		visible["user:"+user.ID] = true
	}
	for _, app := range result.Apps {
		visible["app:"+app.ID] = true
	}
	for _, group := range result.Groups {
		visible["group:"+group.ID] = true
	}
	for key, entity := range unique {
		if visible[key] {
			result.Versions[key] = versions[key]
		} else {
			result.Removed = append(result.Removed, entity)
		}
	}
	return result, nil
}

func (s *Service) Pending(ctx context.Context) ([]store.ClientEntityChange, error) {
	var changes []store.ClientEntityChange
	err := s.db.WithContext(ctx).Where("revision > published_revision").Order("updated_at ASC").Limit(100).Find(&changes).Error
	return changes, err
}

func (s *Service) Acknowledge(ctx context.Context, change store.ClientEntityChange) error {
	return s.db.WithContext(ctx).Model(&store.ClientEntityChange{}).
		Where("type = ? AND entity_id = ? AND recipient_id = ? AND revision = ?", change.Type, change.EntityID, change.RecipientID, change.Revision).
		Updates(map[string]interface{}{"published_revision": change.Revision, "public": false}).Error
}

func (s *Service) Recipients(ctx context.Context, change store.ClientEntityChange, onlineIDs []string) ([]string, error) {
	if change.Type == store.ClientDirectoryUsers {
		return s.userDirectoryRecipients(ctx, change.EntityID, onlineIDs)
	}
	if change.Type == store.ClientDirectoryApps && change.RecipientID != "" {
		return []string{change.RecipientID}, nil
	}
	if change.Type == "user" || change.Public {
		return onlineIDs, nil
	}
	db := s.db.WithContext(ctx)
	if change.Type == "group.access" {
		var active int64
		if err := db.Model(&store.ConversationMember{}).Where("conversation_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL", change.EntityID, store.ConversationMemberTypeUser, change.RecipientID).Count(&active).Error; err != nil {
			return nil, err
		}
		if active == 0 {
			return []string{change.RecipientID}, nil
		}
		return nil, nil
	}
	if change.Type == "group" {
		var recipients []string
		err := db.Model(&store.ConversationMember{}).
			Where("conversation_id = ? AND member_type = ? AND left_at IS NULL", change.EntityID, store.ConversationMemberTypeUser).
			Pluck("member_id", &recipients).Error
		return recipients, err
	}
	var recipients []string
	for _, userID := range onlineIDs {
		var count int64
		// Disabled/deleted applications must still invalidate the profiles held
		// by their former authorized viewers. The resolver enforces current access.
		query := db.Unscoped().Model(&store.App{}).Where("apps.id = ?", change.EntityID)
		if change.Type == store.ClientDirectoryApps {
			// Grants may have become invisible after restricted -> creator.
			query = query.Where("creator_user_id = ? OR EXISTS (SELECT 1 FROM app_user_grants aug WHERE aug.app_id = apps.id AND aug.user_id = ?)", userID, userID)
		} else {
			query = query.Where("creator_user_id = ? OR (visibility = ? AND EXISTS (SELECT 1 FROM app_user_grants aug WHERE aug.app_id = apps.id AND aug.user_id = ?))", userID, store.AppVisibilityRestricted, userID)
		}
		if err := query.Count(&count).Error; err != nil {
			return nil, err
		}
		if count > 0 {
			recipients = append(recipients, userID)
		}
	}
	return recipients, nil
}

func (s *Service) userDirectoryRecipients(ctx context.Context, userID string, onlineIDs []string) ([]string, error) {
	db := s.db.WithContext(ctx)
	var settings store.AppSettings
	err := db.Select("contact_directory_mode").Take(&settings, "id = ?", store.AppSettingsID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if settings.ContactDirectoryMode != store.ContactDirectoryModeFriends {
		return onlineIDs, nil
	}
	var friendships []store.UserFriendship
	if err := db.Where("user_id_low = ? OR user_id_high = ?", userID, userID).Find(&friendships).Error; err != nil {
		return nil, err
	}
	users := []string{userID}
	for _, friendship := range friendships {
		if friendship.UserIDLow == userID {
			users = append(users, friendship.UserIDHigh)
		} else {
			users = append(users, friendship.UserIDLow)
		}
	}
	return users, nil
}
