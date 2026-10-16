package store

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func entityChangeTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "entities.sqlite")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&User{}, &App{}, &AppUserGrant{}, &Conversation{}, &ConversationMember{}, &ClientEntityChange{}); err != nil {
		t.Fatal(err)
	}
	if err := InstallClientEntityChanges(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestClientEntityChangesTrackProfilesNotActivity(t *testing.T) {
	db := entityChangeTestDB(t)
	user := User{ID: "00000000-0000-0000-0000-000000000001", Email: "a@test.invalid", Name: "Alice", PasswordHash: "hash", Status: UserStatusActive}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&User{}).Where("id = ?", user.ID).Update("last_online_at", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&ClientEntityChange{}).Where("type = ?", "user").Count(&count)
	if count != 0 {
		t.Fatalf("presence generated %d profile changes", count)
	}
	if err := db.Model(&User{}).Where("id = ?", user.ID).Update("avatar", "/avatar/new.webp").Error; err != nil {
		t.Fatal(err)
	}
	var change ClientEntityChange
	if err := db.Take(&change, "type = ? AND entity_id = ?", "user", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if change.Revision != 1 || change.PublishedRevision != 0 || change.Event != "user.profile.updated" {
		t.Fatalf("unexpected change: %+v", change)
	}
	user.Avatar = "/avatar/newest.webp"
	if err := db.Save(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Take(&change, "type = ? AND entity_id = ?", "user", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if change.Revision != 2 {
		t.Fatalf("Save did not advance revision: %+v", change)
	}
	if err := db.Model(&User{ID: user.ID}).Update("avatar", user.Avatar).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Take(&change, "type = ? AND entity_id = ?", "user", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if change.Revision != 2 {
		t.Fatal("no-op update generated a change")
	}
}

func TestClientEntityChangesRollBackWithMutation(t *testing.T) {
	db := entityChangeTestDB(t)
	user := User{ID: "00000000-0000-0000-0000-000000000001", Email: "a@test.invalid", Name: "Alice", PasswordHash: "hash", Status: UserStatusActive}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	rolledBack := errors.New("rollback")
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&User{}).Where("id = ?", user.ID).Update("avatar", "new").Error; err != nil {
			return err
		}
		var count int64
		tx.Model(&ClientEntityChange{}).Where("type = ?", "user").Count(&count)
		if count != 1 {
			t.Fatal("outbox was not written inside transaction")
		}
		return rolledBack
	})
	if !errors.Is(err, rolledBack) {
		t.Fatal(err)
	}
	var count int64
	db.Model(&ClientEntityChange{}).Where("type = ?", "user").Count(&count)
	if count != 0 {
		t.Fatal("rolled-back update leaked an event")
	}
}

func TestClientEntityChangesCaptureRolesAndDepartingUser(t *testing.T) {
	db := entityChangeTestDB(t)
	groupID := "00000000-0000-0000-0000-000000000002"
	group := Conversation{ID: groupID, Kind: ConversationKindGroup, Name: "Group", Status: ConversationStatusActive, Visibility: ConversationVisibilityPrivate}
	if err := db.Create(&group).Error; err != nil {
		t.Fatal(err)
	}
	member := ConversationMember{ConversationID: groupID, MemberType: ConversationMemberTypeUser, MemberID: "00000000-0000-0000-0000-000000000001", Role: ConversationMemberRoleMember}
	if err := db.Create(&member).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&ConversationMember{}).Where("conversation_id = ? AND member_id = ?", groupID, member.MemberID).Update("role", ConversationMemberRoleAdmin).Error; err != nil {
		t.Fatal(err)
	}
	var change ClientEntityChange
	if err := db.Take(&change, "type = ? AND entity_id = ?", "group", groupID).Error; err != nil {
		t.Fatal(err)
	}
	if change.Revision != 3 || change.Event != "conversation.members.updated" {
		t.Fatalf("role event = %+v", change)
	}
	if err := db.Model(&ConversationMember{}).Where("conversation_id = ?", groupID).Update("left_at", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	var removed ClientEntityChange
	if err := db.Take(&removed, "type = ? AND entity_id = ? AND recipient_id = ?", "group.access", groupID, member.MemberID).Error; err != nil {
		t.Fatal(err)
	}
	if removed.Event != "conversation.removed" {
		t.Fatalf("departing user has no durable removal: %+v", removed)
	}
}
