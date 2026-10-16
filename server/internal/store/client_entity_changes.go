package store

import (
	"fmt"
	"reflect"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ClientEntityChange is a coalescing transactional outbox. Revisions survive
// delivery; acknowledging revision N must never consume a concurrent N+1.
type ClientEntityChange struct {
	Type              string    `gorm:"size:32;primaryKey"`
	EntityID          string    `gorm:"type:uuid;primaryKey"`
	RecipientID       string    `gorm:"size:36;primaryKey;default:''"`
	Revision          int64     `gorm:"not null"`
	PublishedRevision int64     `gorm:"not null;default:0"`
	Event             string    `gorm:"size:64;not null"`
	Public            bool      `gorm:"not null;default:false"`
	UpdatedAt         time.Time `gorm:"not null"`
}

const entityBeforeImage = "client_entity_changes:before"

type trackedEntityTable struct {
	keys, columns []string
}

func trackedEntity(table string) trackedEntityTable {
	switch table {
	case "users":
		return trackedEntityTable{[]string{"id"}, []string{"id", "avatar", "name", "nickname", "email", "phone", "status"}}
	case "apps":
		return trackedEntityTable{[]string{"id"}, []string{"id", "avatar", "name", "description", "visibility", "enabled", "deleted_at", "creator_user_id"}}
	case "app_user_grants":
		return trackedEntityTable{[]string{"app_id", "user_id"}, []string{"app_id", "user_id"}}
	case "conversations":
		return trackedEntityTable{[]string{"id"}, []string{"id", "kind", "avatar", "name", "announcement", "visibility", "status", "posting_policy"}}
	case "conversation_members":
		return trackedEntityTable{[]string{"conversation_id", "member_type", "member_id"}, []string{"conversation_id", "member_type", "member_id", "role", "left_at", "joined_at"}}
	}
	return trackedEntityTable{}
}

// Capture at the persistence boundary so admin and application API writes obey
// the same transaction semantics as client writes. Read cursors, presence and
// ordinary messages deliberately do not generate entity changes.
func InstallClientEntityChanges(db *gorm.DB) error {
	if db.Callback().Update().Get(entityBeforeImage) != nil {
		return nil
	}
	if err := db.Callback().Update().Before("gorm:update").Register(entityBeforeImage, captureEntityBeforeImage); err != nil {
		return err
	}
	if err := db.Callback().Update().After("gorm:after_update").Before("gorm:commit_or_rollback_transaction").Register("client_entity_changes:update", recordEntityUpdate); err != nil {
		return err
	}
	if err := db.Callback().Create().After("gorm:after_create").Before("gorm:commit_or_rollback_transaction").Register("client_entity_changes:create", recordEntityCreate); err != nil {
		return err
	}
	if err := db.Callback().Delete().Before("gorm:delete").Register(entityBeforeImage, captureEntityBeforeImage); err != nil {
		return err
	}
	return db.Callback().Delete().After("gorm:after_delete").Before("gorm:commit_or_rollback_transaction").Register("client_entity_changes:delete", recordEntityDelete)
}

func entityDB(tx *gorm.DB) *gorm.DB {
	return tx.Session(&gorm.Session{NewDB: true})
}

func entityUpdateRelevant(tx *gorm.DB, table trackedEntityTable) bool {
	if updates, ok := tx.Statement.Dest.(map[string]interface{}); ok {
		for name := range updates {
			field := tx.Statement.Schema.LookUpField(name)
			if field == nil {
				continue
			}
			for _, column := range table.columns {
				if field.DBName == column {
					return true
				}
			}
		}
		return false
	}
	return true
}

func captureEntityBeforeImage(tx *gorm.DB) {
	table := trackedEntity(tx.Statement.Table)
	if tx.Error != nil || len(table.keys) == 0 || !entityUpdateRelevant(tx, table) {
		return
	}
	// Serialize before-image capture with the write: a concurrent update that
	// restores the previous value must still advance the entity revision.
	query := entityDB(tx).Table(tx.Statement.Table).Select(table.columns).Clauses(clause.Locking{Strength: "UPDATE"})
	if where, exists := tx.Statement.Clauses["WHERE"]; exists {
		query = query.Where(where.Expression)
	}
	// Model(&User{ID: ...}).Updates(...) adds its primary key during gorm:update.
	if tx.Statement.ReflectValue.Kind() == reflect.Struct {
		for _, key := range table.keys {
			field := tx.Statement.Schema.LookUpField(key)
			if value, zero := field.ValueOf(tx.Statement.Context, tx.Statement.ReflectValue); !zero {
				query = query.Where(clause.Eq{Column: key, Value: value})
			}
		}
	}
	var before []map[string]interface{}
	if err := query.Find(&before).Error; err != nil {
		tx.AddError(err)
		return
	}
	normalizeEntityRows(before)
	tx.InstanceSet(entityBeforeImage, before)
}

func entityKey(row map[string]interface{}, keys []string) string {
	values := make([]string, len(keys))
	for i, key := range keys {
		values[i] = fmt.Sprint(row[key])
	}
	return strings.Join(values, ":")
}

func readEntityRows(tx *gorm.DB, keys []map[string]interface{}) ([]map[string]interface{}, error) {
	if len(keys) > 100 {
		var rows []map[string]interface{}
		for offset := 0; offset < len(keys); offset += 100 {
			batch, err := readEntityRows(tx, keys[offset:min(offset+100, len(keys))])
			if err != nil {
				return nil, err
			}
			rows = append(rows, batch...)
		}
		return rows, nil
	}
	table := trackedEntity(tx.Statement.Table)
	conditions := make([]clause.Expression, 0, len(keys))
	for _, row := range keys {
		parts := make([]clause.Expression, 0, len(table.keys))
		for _, key := range table.keys {
			parts = append(parts, clause.Eq{Column: key, Value: row[key]})
		}
		conditions = append(conditions, clause.And(parts...))
	}
	var rows []map[string]interface{}
	if len(conditions) == 0 {
		return rows, nil
	}
	err := entityDB(tx).Table(tx.Statement.Table).Select(table.columns).Where(clause.Or(conditions...)).Find(&rows).Error
	normalizeEntityRows(rows)
	return rows, err
}

func normalizeEntityRows(rows []map[string]interface{}) {
	for _, row := range rows {
		for name, value := range row {
			if bytes, ok := value.([]byte); ok {
				row[name] = string(bytes)
			}
		}
	}
}

func recordEntityUpdate(tx *gorm.DB) {
	value, exists := tx.InstanceGet(entityBeforeImage)
	if tx.Error != nil || !exists || tx.RowsAffected == 0 {
		return
	}
	before := value.([]map[string]interface{})
	normalizeEntityRows(before)
	after, err := readEntityRows(tx, before)
	if err != nil {
		tx.AddError(err)
		return
	}
	old := make(map[string]map[string]interface{}, len(before))
	beginEntityRecords(tx)
	for _, row := range before {
		old[entityKey(row, trackedEntity(tx.Statement.Table).keys)] = row
	}
	for _, row := range after {
		previous := old[entityKey(row, trackedEntity(tx.Statement.Table).keys)]
		if !reflect.DeepEqual(previous, row) {
			tx.AddError(recordEntityRow(tx, row, previous))
		}
	}
}

func recordEntityCreate(tx *gorm.DB) {
	table := trackedEntity(tx.Statement.Table)
	if tx.Error != nil || len(table.keys) == 0 || tx.RowsAffected == 0 {
		return
	}
	var keys []map[string]interface{}
	appendKeys := func(value reflect.Value) {
		row := make(map[string]interface{}, len(table.keys))
		for _, key := range table.keys {
			field := tx.Statement.Schema.LookUpField(key)
			data, zero := field.ValueOf(tx.Statement.Context, value)
			if zero {
				return
			}
			row[key] = data
		}
		keys = append(keys, row)
	}
	value := tx.Statement.ReflectValue
	if value.Kind() == reflect.Slice || value.Kind() == reflect.Array {
		for i := 0; i < value.Len(); i++ {
			appendKeys(reflect.Indirect(value.Index(i)))
		}
	} else if value.Kind() == reflect.Struct {
		appendKeys(value)
	}
	rows, err := readEntityRows(tx, keys)
	if err != nil {
		tx.AddError(err)
		return
	}
	beginEntityRecords(tx)
	for _, row := range rows {
		tx.AddError(recordEntityRow(tx, row, nil))
	}
}

func recordEntityDelete(tx *gorm.DB) {
	value, exists := tx.InstanceGet(entityBeforeImage)
	if tx.Error != nil || !exists || tx.RowsAffected == 0 {
		return
	}
	beginEntityRecords(tx)
	for _, row := range value.([]map[string]interface{}) {
		tx.AddError(recordEntityRow(tx, nil, row))
	}
}

func recordEntityRow(tx *gorm.DB, current, previous map[string]interface{}) error {
	row := current
	if row == nil {
		row = previous
	}
	id, _ := row["id"].(string)
	change := ClientEntityChange{EntityID: id}
	switch tx.Statement.Table {
	case "users":
		if err := recordUserDirectoryChange(tx, id, current, previous); err != nil {
			return err
		}
		if previous == nil {
			return nil
		}
		change.Type, change.Event = "user", "user.profile.updated"
	case "apps":
		change.Type, change.Event = "app", "app.profile.updated"
		change.Public = row["visibility"] == AppVisibilityPublic || previous["visibility"] == AppVisibilityPublic
		if entityColumnsChanged(current, previous, "visibility", "enabled", "deleted_at", "creator_user_id") {
			if err := queueDirectoryChange(tx, ClientDirectoryApps, id, "", change.Public); err != nil {
				return err
			}
			if oldCreator, ok := previous["creator_user_id"].(string); ok && oldCreator != current["creator_user_id"] {
				if err := queueDirectoryChange(tx, ClientDirectoryApps, id, oldCreator, false); err != nil {
					return err
				}
			}
		}
		// A private app may be visible as a group member without being in the
		// viewer's application directory. Refresh that authorized group snapshot
		// rather than leaking private app profiles through app discovery.
		var groups []Conversation
		if err := entityDB(tx).Model(&Conversation{}).
			Joins("JOIN conversation_members cm ON cm.conversation_id = conversations.id").
			Where("cm.member_type = ? AND cm.member_id = ? AND cm.left_at IS NULL", ConversationMemberTypeApp, id).
			Where("conversations.kind = ? AND conversations.status = ?", ConversationKindGroup, ConversationStatusActive).
			Find(&groups).Error; err != nil {
			return err
		}
		for _, group := range groups {
			if err := queueEntityChange(tx, ClientEntityChange{Type: "group", EntityID: group.ID, Event: "conversation.members.updated", Public: group.Visibility == ConversationVisibilityPublic}); err != nil {
				return err
			}
		}
	case "app_user_grants":
		return queueDirectoryChange(tx, ClientDirectoryApps, fmt.Sprint(row["app_id"]), fmt.Sprint(row["user_id"]), false)
	case "conversations":
		if row["kind"] != ConversationKindGroup {
			return nil
		}
		change.Type, change.Event = "group", "conversation.updated"
		change.Public = row["visibility"] == ConversationVisibilityPublic || previous["visibility"] == ConversationVisibilityPublic
	case "conversation_members":
		id, _ = row["conversation_id"].(string)
		cache, _ := tx.InstanceGet("client_entity_changes:groups")
		groups := cache.(map[string]Conversation)
		group, exists := groups[id]
		if !exists {
			if err := entityDB(tx).Select("id", "kind", "visibility").Take(&group, "id = ?", id).Error; err != nil {
				return err
			}
			groups[id] = group
		}
		if group.Kind != ConversationKindGroup {
			return nil
		}
		change.Type, change.EntityID, change.Event = "group", id, "conversation.members.updated"
		change.Public = group.Visibility == ConversationVisibilityPublic
		if previous != nil && previous["left_at"] == nil && (current == nil || current["left_at"] != nil) && row["member_type"] == ConversationMemberTypeUser {
			removed := ClientEntityChange{Type: "group.access", EntityID: id, RecipientID: fmt.Sprint(row["member_id"]), Event: "conversation.removed"}
			if err := queueEntityChange(tx, removed); err != nil {
				return err
			}
		}
	default:
		return nil
	}
	return queueEntityChange(tx, change)
}

func beginEntityRecords(tx *gorm.DB) {
	tx.InstanceSet("client_entity_changes:queued", map[string]bool{})
	tx.InstanceSet("client_entity_changes:groups", map[string]Conversation{})
}

func queueEntityChange(tx *gorm.DB, change ClientEntityChange) error {
	value, _ := tx.InstanceGet("client_entity_changes:queued")
	queued := value.(map[string]bool)
	key := change.Type + ":" + change.EntityID + ":" + change.RecipientID
	if queued[key] {
		return nil
	}
	queued[key] = true
	change.Revision, change.UpdatedAt = 1, time.Now().UTC()
	return entityDB(tx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "type"}, {Name: "entity_id"}, {Name: "recipient_id"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"revision":   gorm.Expr("client_entity_changes.revision + 1"),
			"event":      change.Event,
			"public":     gorm.Expr("client_entity_changes.public OR ?", change.Public),
			"updated_at": change.UpdatedAt,
		}),
	}).Create(&change).Error
}
