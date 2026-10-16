package store

import (
	"reflect"

	"gorm.io/gorm"
)

const (
	ClientDirectoryUpdatedEvent = "contact.directory.updated"
	ClientDirectoryUsers        = "directory.user"
	ClientDirectoryApps         = "directory.app"
)

func queueDirectoryChange(tx *gorm.DB, kind, id, recipient string, public bool) error {
	return queueEntityChange(tx, ClientEntityChange{
		Type: kind, EntityID: id, RecipientID: recipient,
		Event: ClientDirectoryUpdatedEvent, Public: public,
	})
}

func entityColumnsChanged(current, previous map[string]interface{}, columns ...string) bool {
	if current == nil || previous == nil {
		return true
	}
	for _, column := range columns {
		if !reflect.DeepEqual(current[column], previous[column]) {
			return true
		}
	}
	return false
}

func recordUserDirectoryChange(tx *gorm.DB, id string, current, previous map[string]interface{}) error {
	if !entityColumnsChanged(current, previous, "status") ||
		(current["status"] != UserStatusActive && previous["status"] != UserStatusActive) {
		return nil
	}
	if err := queueDirectoryChange(tx, ClientDirectoryUsers, id, "", false); err != nil {
		return err
	}
	// The creator's status also controls whether their applications are usable.
	if previous != nil {
		var apps []App
		if err := entityDB(tx).Where("creator_user_id = ?", id).Find(&apps).Error; err != nil {
			return err
		}
		for _, app := range apps {
			if err := queueDirectoryChange(tx, ClientDirectoryApps, app.ID, "", app.Visibility == AppVisibilityPublic); err != nil {
				return err
			}
		}
	}
	return nil
}
