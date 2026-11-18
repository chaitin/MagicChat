package organization

import (
	"app/internal/store"
	"context"
	"testing"
)

func TestNodeMembersIncludesDescendantsAndDeduplicates(t *testing.T) {
	db := testOrganizationDB(t)
	service := NewService(db)
	ctx := context.Background()
	first := testOrganizationUser(t, db, "First")
	second := testOrganizationUser(t, db, "Second")
	dept, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: store.RootOrganizationUnitID, ParentID: store.RootDepartmentID, Name: "Parent"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: store.RootOrganizationUnitID, ParentID: dept.ID, Name: "Child"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetAssignments(ctx, "admin", first, []AssignmentInput{{DepartmentID: dept.ID, IsPrimary: true}, {DepartmentID: child.ID}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetAssignments(ctx, "admin", second, []AssignmentInput{{DepartmentID: child.ID, IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	page, err := service.NodeMembersForViewer(ctx, first, dept.ID, 1, 100)
	if err != nil || page.Total != 2 || len(page.Members) != 2 {
		t.Fatalf("node members=%+v err=%v", page, err)
	}
	if _, err := service.SetPolicy(ctx, "admin", Policy{VisibilityScope: "same_department"}); err != nil {
		t.Fatal(err)
	}
	// Second only belongs to Child. The visible ancestor must not expose any unrelated members.
	hidden := testOrganizationUser(t, db, "Hidden")
	if _, err := service.SetAssignments(ctx, "admin", hidden, []AssignmentInput{{DepartmentID: store.RootDepartmentID, IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	page, err = service.NodeMembersForViewer(ctx, second, store.RootDepartmentID, 1, 100)
	if err != nil || page.Total != 2 {
		t.Fatalf("restricted node members=%+v err=%v", page, err)
	}
	for _, member := range page.Members {
		if member.ID == hidden {
			t.Fatal("hidden ancestor member leaked")
		}
	}
}

func TestUnitNodeIncludesChildUnits(t *testing.T) {
	db := testOrganizationDB(t)
	service := NewService(db)
	ctx := context.Background()
	user := testOrganizationUser(t, db, "Subsidiary Member")
	unit, err := service.CreateUnit(ctx, "admin", UnitInput{ParentID: store.RootOrganizationUnitID, Name: "Subsidiary", Kind: "subsidiary"})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	root := ""
	for _, dept := range snapshot.Departments {
		if dept.UnitID == unit.ID && dept.IsRoot {
			root = dept.ID
		}
	}
	if _, err := service.SetAssignments(ctx, "admin", user, []AssignmentInput{{DepartmentID: root, IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	page, err := service.NodeMembersForViewer(ctx, user, store.RootDepartmentID, 1, 100)
	if err != nil || page.Total != 1 || page.Members[0].ID != user {
		t.Fatalf("child unit members=%+v err=%v", page, err)
	}
}
