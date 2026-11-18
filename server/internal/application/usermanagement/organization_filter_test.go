package usermanagement

import (
	"context"
	"testing"

	"app/internal/store"
	"github.com/google/uuid"
)

func TestListDepartmentScopeCombinesSearchPaginationAndDisabledMembers(t *testing.T) {
	db := openUserManagementTestDB(t)
	if err := db.AutoMigrate(&store.OrganizationAssignment{}); err != nil {
		t.Fatal(err)
	}
	deptA, deptB, outside := uuid.NewString(), uuid.NewString(), uuid.NewString()
	alice := store.User{ID: uuid.NewString(), Email: "alice@example.com", Name: "Match Alice", Status: store.UserStatusActive, PasswordHash: "hash"}
	bob := store.User{ID: uuid.NewString(), Email: "bob@example.com", Name: "Match Bob", Status: store.UserStatusDisabled, PasswordHash: "hash"}
	charlie := store.User{ID: uuid.NewString(), Email: "charlie@example.com", Name: "Match Charlie", Status: store.UserStatusActive, PasswordHash: "hash"}
	for _, user := range []store.User{alice, bob, charlie} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, assignment := range []store.OrganizationAssignment{
		{ID: uuid.NewString(), UserID: alice.ID, DepartmentID: deptA},
		{ID: uuid.NewString(), UserID: alice.ID, DepartmentID: deptB},
		{ID: uuid.NewString(), UserID: bob.ID, DepartmentID: deptB},
		{ID: uuid.NewString(), UserID: charlie.ID, DepartmentID: outside},
	} {
		if err := db.Create(&assignment).Error; err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(Dependencies{DB: db, Presence: &fakeUserPresence{online: map[string]bool{alice.ID: true}}})
	result, err := service.List(context.Background(), ListCommand{
		DepartmentIDs: deptA + "," + deptB, Keyword: "match", Page: "2", PageSize: "1", Sort: "email", Order: "asc",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 2 || len(result.Users) != 1 || result.Users[0].ID != bob.ID || result.Users[0].Status != StatusDisabled {
		t.Fatalf("scoped page must deduplicate memberships and retain disabled members: %#v", result)
	}
	result, err = service.List(context.Background(), ListCommand{DepartmentIDs: deptA, Keyword: "charlie"})
	if err != nil || result.Total != 0 {
		t.Fatalf("search escaped department scope: %#v, %v", result, err)
	}
	result, err = service.List(context.Background(), ListCommand{DepartmentIDs: deptA + "," + deptB, Online: "true"})
	if err != nil || result.Total != 1 || result.Users[0].ID != alice.ID {
		t.Fatalf("online filter: %#v, %v", result, err)
	}
	result, err = service.List(context.Background(), ListCommand{DepartmentIDs: uuid.NewString()})
	if err != nil || result.Total != 0 {
		t.Fatalf("empty department must not return all members: %#v, %v", result, err)
	}
	_, err = service.List(context.Background(), ListCommand{DepartmentIDs: "invalid"})
	if err == nil {
		t.Fatal("expected invalid department ID to be rejected")
	}
}
