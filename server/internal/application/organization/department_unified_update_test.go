package organization

import (
	"app/internal/store"
	"context"
	"errors"
	"testing"
)

func TestDepartmentUnifiedUpdateIsAtomic(t *testing.T) {
	db := testOrganizationDB(t)
	s := NewService(db)
	ctx := context.Background()
	d, err := s.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: store.RootOrganizationUnitID, ParentID: store.RootDepartmentID, Name: "Before"})
	if err != nil {
		t.Fatal(err)
	}
	user := testOrganizationUser(t, db, "Leader")
	bad := []Leader{{UserID: user, IsPrimary: false}}
	input := DepartmentInput{UnitID: d.UnitID, ParentID: store.RootDepartmentID, Name: "After", Leaders: &bad}
	if err := s.UpdateDepartment(ctx, "admin", d.ID, input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected rejection: %v", err)
	}
	var stored store.OrganizationDepartment
	if err := db.First(&stored, "id = ?", d.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Name != "Before" {
		t.Fatal("partial save")
	}
	good := []Leader{{UserID: user, IsPrimary: true}}
	input.Leaders = &good
	if err := s.UpdateDepartment(ctx, "admin", d.ID, input); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&store.OrganizationDepartmentLeader{}).Where("department_id = ?", d.ID).Count(&count)
	if count != 1 {
		t.Fatal("leader not saved")
	}
	db.First(&stored, "id = ?", d.ID)
	if stored.Name != "After" {
		t.Fatal("name not saved")
	}
	empty := []Leader{}
	input.Leaders = &empty
	if err := s.UpdateDepartment(ctx, "admin", d.ID, input); err != nil {
		t.Fatal(err)
	}
	db.Model(&store.OrganizationDepartmentLeader{}).Where("department_id = ?", d.ID).Count(&count)
	if count != 0 {
		t.Fatal("leader not cleared")
	}
}
