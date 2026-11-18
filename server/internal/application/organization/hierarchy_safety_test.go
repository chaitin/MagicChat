package organization

import (
	"context"
	"errors"
	"testing"
	"time"

	"app/internal/store"
)

func TestSnapshotForViewerRejectsCyclicDepartmentAncestors(t *testing.T) {
	db := testOrganizationDB(t)
	service := NewService(db)
	ctx := context.Background()
	a, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: store.RootOrganizationUnitID, ParentID: store.RootDepartmentID, Name: "A"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: store.RootOrganizationUnitID, ParentID: store.RootDepartmentID, Name: "B"})
	if err != nil {
		t.Fatal(err)
	}
	viewer := testOrganizationUser(t, db, "viewer")
	if _, err := service.SetAssignments(ctx, "admin", viewer, []AssignmentInput{{DepartmentID: a.ID, IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetPolicy(ctx, "admin", Policy{VisibilityScope: "same_department"}); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&store.OrganizationDepartment{}).Where("id = ?", a.ID).Update("parent_id", b.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&store.OrganizationDepartment{}).Where("id = ?", b.ID).Update("parent_id", a.ID).Error; err != nil {
		t.Fatal(err)
	}
	assertSnapshotConflictReturns(t, service, viewer)
}

func TestSnapshotForViewerRejectsCyclicUnitAncestors(t *testing.T) {
	db := testOrganizationDB(t)
	service := NewService(db)
	ctx := context.Background()
	a, err := service.CreateUnit(ctx, "admin", UnitInput{Name: "A", Kind: "subsidiary"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := service.CreateUnit(ctx, "admin", UnitInput{Name: "B", Kind: "subsidiary"})
	if err != nil {
		t.Fatal(err)
	}
	var root store.OrganizationDepartment
	if err := db.Where("unit_id = ? AND is_root = ?", a.ID, true).First(&root).Error; err != nil {
		t.Fatal(err)
	}
	viewer := testOrganizationUser(t, db, "viewer")
	if _, err := service.SetAssignments(ctx, "admin", viewer, []AssignmentInput{{DepartmentID: root.ID, IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetPolicy(ctx, "admin", Policy{VisibilityScope: "same_unit"}); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&store.OrganizationUnit{}).Where("id = ?", a.ID).Update("parent_id", b.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&store.OrganizationUnit{}).Where("id = ?", b.ID).Update("parent_id", a.ID).Error; err != nil {
		t.Fatal(err)
	}
	assertSnapshotConflictReturns(t, service, viewer)
}

func assertSnapshotConflictReturns(t *testing.T, service *Service, viewer string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := service.SnapshotForViewer(ctx, viewer)
		result <- err
	}()
	select {
	case err := <-result:
		if !errors.Is(err, ErrConflict) {
			t.Fatalf("expected ErrConflict, got %v", err)
		}
	case <-ctx.Done():
		t.Fatal("snapshot did not reject cyclic ancestors promptly")
	}
}
