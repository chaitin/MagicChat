package store

import (
	"errors"
	"testing"

	"gorm.io/gorm"
)

func TestDirectoryUserDiscoveryTracksActiveMembershipNotProfileEdits(t *testing.T) {
	db := entityChangeTestDB(t)
	user := User{ID: "00000000-0000-0000-0000-000000000001", Email: "new@directory.test", Name: "New", PasswordHash: "hash", Status: UserStatusDisabled}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&ClientEntityChange{}).Where("type = ?", ClientDirectoryUsers).Count(&count)
	if count != 0 {
		t.Fatal("inactive registration changed the visible directory")
	}
	if err := db.Model(&user).Update("status", UserStatusActive).Error; err != nil {
		t.Fatal(err)
	}
	var change ClientEntityChange
	if err := db.Where("type = ? AND entity_id = ?", ClientDirectoryUsers, user.ID).Take(&change).Error; err != nil {
		t.Fatal(err)
	}
	if change.Event != ClientDirectoryUpdatedEvent || change.Revision != 1 {
		t.Fatalf("activation event = %+v", change)
	}
	if err := db.Model(&user).Update("avatar", "new.webp").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("type = ? AND entity_id = ?", ClientDirectoryUsers, user.ID).Take(&change).Error; err != nil {
		t.Fatal(err)
	}
	if change.Revision != 1 {
		t.Fatal("avatar edit unnecessarily invalidated the whole directory")
	}
	if err := db.Model(&user).Update("status", UserStatusDisabled).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("type = ? AND entity_id = ?", ClientDirectoryUsers, user.ID).Take(&change).Error; err != nil {
		t.Fatal(err)
	}
	if change.Revision != 2 {
		t.Fatal("deactivation did not invalidate the directory")
	}
}

func TestDirectoryActiveRegistrationIsTransactional(t *testing.T) {
	db := entityChangeTestDB(t)
	user := User{ID: "00000000-0000-0000-0000-000000000001", Email: "new@directory.test", Name: "New", PasswordHash: "hash", Status: UserStatusActive}
	rollback := errors.New("rollback")
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		var count int64
		tx.Model(&ClientEntityChange{}).Where("type = ?", ClientDirectoryUsers).Count(&count)
		if count != 1 {
			t.Fatal("registration notification was not in the same transaction")
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatal(err)
	}
	var count int64
	db.Model(&ClientEntityChange{}).Count(&count)
	if count != 0 {
		t.Fatal("rolled-back registration leaked a directory notification")
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	db.Model(&ClientEntityChange{}).Where("type = ?", ClientDirectoryUsers).Count(&count)
	if count != 1 {
		t.Fatal("active registration has no directory notification")
	}
}

func TestDirectoryAppGrantRevocationKeepsTargetedOutbox(t *testing.T) {
	db := entityChangeTestDB(t)
	app := App{ID: "00000000-0000-0000-0000-000000000002", Name: "Restricted", Visibility: AppVisibilityRestricted, Enabled: true, ConnectionSecret: "secret"}
	if err := db.Create(&app).Error; err != nil {
		t.Fatal(err)
	}
	grant := AppUserGrant{AppID: app.ID, UserID: "00000000-0000-0000-0000-000000000003"}
	if err := db.Create(&grant).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&grant).Error; err != nil {
		t.Fatal(err)
	}
	var change ClientEntityChange
	if err := db.Where("type = ? AND entity_id = ? AND recipient_id = ?", ClientDirectoryApps, app.ID, grant.UserID).Take(&change).Error; err != nil {
		t.Fatal(err)
	}
	if change.Revision != 2 || change.Public || change.Event != ClientDirectoryUpdatedEvent {
		t.Fatalf("revoked viewer lost their invalidation: %+v", change)
	}
	if err := db.Model(&app).Update("visibility", AppVisibilityPublic).Error; err != nil {
		t.Fatal(err)
	}
	var public ClientEntityChange
	if err := db.Where("type = ? AND entity_id = ? AND recipient_id = ''", ClientDirectoryApps, app.ID).Take(&public).Error; err != nil {
		t.Fatal(err)
	}
	if !public.Public || public.Revision != 2 {
		t.Fatalf("app visibility did not change discovery: %+v", public)
	}
}
