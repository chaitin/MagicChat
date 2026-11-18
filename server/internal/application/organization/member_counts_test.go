package organization

import (
	"app/internal/store"
	"context"
	"testing"
)

func TestSnapshotMemberCounts(t *testing.T) {
	db := testOrganizationDB(t)
	service := NewService(db)
	ctx := context.Background()
	department := func(unit, parent, name string) Department {
		t.Helper()
		value, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: unit, ParentID: parent, Name: name})
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	parent := department(store.RootOrganizationUnitID, store.RootDepartmentID, "Parent")
	left := department(store.RootOrganizationUnitID, parent.ID, "Left")
	right := department(store.RootOrganizationUnitID, parent.ID, "Right")
	empty := department(store.RootOrganizationUnitID, store.RootDepartmentID, "Empty")
	subsidiary, err := service.CreateUnit(ctx, "admin", UnitInput{Name: "Subsidiary", Kind: "subsidiary"})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	subsidiaryRoot := ""
	for _, d := range snapshot.Departments {
		if d.UnitID == subsidiary.ID && d.IsRoot {
			subsidiaryRoot = d.ID
		}
	}
	if subsidiaryRoot == "" {
		t.Fatal("missing subsidiary root")
	}
	child := department(subsidiary.ID, subsidiaryRoot, "Child")
	assign := func(name string, ids ...string) string {
		t.Helper()
		user := testOrganizationUser(t, db, name)
		assignments := make([]AssignmentInput, len(ids))
		for i, id := range ids {
			assignments[i] = AssignmentInput{DepartmentID: id, IsPrimary: i == 0}
		}
		if len(ids) > 0 {
			if _, err := service.SetAssignments(ctx, "admin", user, assignments); err != nil {
				t.Fatal(err)
			}
		}
		return user
	}
	assign("Multiple", left.ID, right.ID, child.ID)
	viewer := assign("Viewer", left.ID)
	assign("ParentDirect", parent.ID)
	assign("RootDirect", store.RootDepartmentID)
	assign("SubsidiaryOnly", child.ID)
	disabled := assign("Disabled", left.ID)
	if err := db.Model(&store.User{}).Where("id = ?", disabled).Update("status", "disabled").Error; err != nil {
		t.Fatal(err)
	}
	unassigned := assign("Unassigned")
	check := func(viewer string, expectedUnits, expectedDepartments map[string]int) {
		t.Helper()
		result, err := service.SnapshotForViewer(ctx, viewer)
		if err != nil {
			t.Fatal(err)
		}
		for _, unit := range result.Units {
			want, ok := expectedUnits[unit.ID]
			if !ok {
				t.Fatalf("unexpected unit %s", unit.ID)
			}
			if unit.MemberCount == nil || *unit.MemberCount != want {
				t.Fatalf("unit %s count %v want %d", unit.Name, unit.MemberCount, want)
			}
			delete(expectedUnits, unit.ID)
		}
		for _, d := range result.Departments {
			want, ok := expectedDepartments[d.ID]
			if !ok {
				t.Fatalf("unexpected department %s", d.Name)
			}
			if d.MemberCount == nil || *d.MemberCount != want {
				t.Fatalf("department %s count %v want %d", d.Name, d.MemberCount, want)
			}
			members, err := service.NodeMembersForViewer(ctx, viewer, d.ID, 1, 100)
			if err != nil {
				t.Fatal(err)
			}
			if members.Total != int64(want) {
				t.Fatalf("department %s members total %d want %d", d.Name, members.Total, want)
			}
			delete(expectedDepartments, d.ID)
		}
		if len(expectedUnits) != 0 || len(expectedDepartments) != 0 {
			t.Fatalf("missing nodes: %v %v", expectedUnits, expectedDepartments)
		}
	}
	check(viewer, map[string]int{store.RootOrganizationUnitID: 5, subsidiary.ID: 2},
		map[string]int{store.RootDepartmentID: 5, parent.ID: 3, left.ID: 2, right.ID: 1, empty.ID: 0, subsidiaryRoot: 2, child.ID: 2})
	if _, err := service.SetPolicy(ctx, "admin", Policy{VisibilityScope: "same_department"}); err != nil {
		t.Fatal(err)
	}
	check(viewer, map[string]int{store.RootOrganizationUnitID: 2},
		map[string]int{store.RootDepartmentID: 2, parent.ID: 2, left.ID: 2})
	check(unassigned, map[string]int{}, map[string]int{})
	if _, err := service.SetPolicy(ctx, "admin", Policy{VisibilityScope: "same_unit"}); err != nil {
		t.Fatal(err)
	}
	check(viewer, map[string]int{store.RootOrganizationUnitID: 4},
		map[string]int{store.RootDepartmentID: 4, parent.ID: 3, left.ID: 2, right.ID: 1, empty.ID: 0})
}
