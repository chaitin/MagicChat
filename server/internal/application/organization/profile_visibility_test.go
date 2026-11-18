package organization

import (
	"context"
	"reflect"
	"testing"

	"app/internal/store"
)

func TestVisibleMemberProfileFieldsAreAlwaysReturned(t *testing.T) {
	db := testOrganizationDB(t)
	service := NewService(db)
	ctx := context.Background()
	viewer := testOrganizationUser(t, db, "Viewer")
	target := testOrganizationUser(t, db, "Target")
	direct := testOrganizationUser(t, db, "Direct")
	dotted := testOrganizationUser(t, db, "Dotted")
	first, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: store.RootOrganizationUnitID, ParentID: store.RootDepartmentID, Name: "First"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: store.RootOrganizationUnitID, ParentID: store.RootDepartmentID, Name: "Second"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&store.User{}).Where("id = ?", target).Update("job_title", "Engineer").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetAssignments(ctx, "admin", target, []AssignmentInput{{DepartmentID: first.ID}, {DepartmentID: second.ID, IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetReporting(ctx, "admin", target, Reporting{DirectManagerUserID: &direct, DottedManagerUserIDs: []string{dotted}}); err != nil {
		t.Fatal(err)
	}
	before, err := service.SnapshotForViewer(ctx, viewer)
	if err != nil {
		t.Fatal(err)
	}
	policy := Policy{VisibilityScope: "all"}
	if saved, err := service.SetPolicy(ctx, "admin", policy); err != nil || saved != policy {
		t.Fatalf("save = %+v, %v", saved, err)
	}
	if saved, err := service.Policy(ctx); err != nil || saved != policy {
		t.Fatalf("load = %+v, %v", saved, err)
	}
	after, err := service.SnapshotForViewer(ctx, viewer)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("profile policy changed organization tree: %+v, %v", after, err)
	}
	assignments, err := service.AssignmentsForViewer(ctx, viewer, target)
	if err != nil {
		t.Fatal(err)
	}
	wantCount := 2
	if len(assignments) != wantCount {
		t.Fatalf("assignments = %+v", assignments)
	}
	wantTitle := "Engineer"
	primaryFound := false
	for _, assignment := range assignments {
		primaryFound = primaryFound || assignment.IsPrimary
		if assignment.UnitID != store.RootOrganizationUnitID || assignment.Title != wantTitle {
			t.Fatalf("assignment = %+v", assignment)
		}
		if assignment.DepartmentID == "" {
			t.Fatal("visible department missing")
		}
	}
	if !primaryFound {
		t.Fatal("unit projection lost primary status")
	}
	reporting, err := service.ReportingForViewer(ctx, viewer, target)
	if err != nil {
		t.Fatal(err)
	}
	{
		if reporting.DirectManagerUserID == nil || *reporting.DirectManagerUserID != direct || len(reporting.DottedManagerUserIDs) != 1 || reporting.DottedManagerUserIDs[0] != dotted {
			t.Fatalf("reporting = %+v", reporting)
		}
	}
	for _, read := range []func(context.Context, string, string, int, int) (MemberPage, error){service.MembersForViewer, service.NodeMembersForViewer} {
		page, err := read(ctx, viewer, second.ID, 1, 100)
		if err != nil || len(page.Members) != 1 || page.Members[0].Title != wantTitle {
			t.Fatalf("members = %+v, %v", page, err)
		}
	}
	admin, err := service.Assignments(ctx, target)
	if err != nil || len(admin) != 2 || admin[0].Title != "Engineer" || admin[0].DepartmentID == "" {
		t.Fatalf("admin assignments were redacted: %+v, %v", admin, err)
	}
	adminReporting, err := service.Reporting(ctx, target)
	if err != nil || adminReporting.DirectManagerUserID == nil {
		t.Fatalf("admin reporting redacted: %+v, %v", adminReporting, err)
	}
}

func TestMemberDepartmentsStillRespectDirectoryScope(t *testing.T) {
	db := testOrganizationDB(t)
	service := NewService(db)
	ctx := context.Background()
	viewer := testOrganizationUser(t, db, "Viewer")
	target := testOrganizationUser(t, db, "Target")
	visible, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: store.RootOrganizationUnitID, ParentID: store.RootDepartmentID, Name: "Visible"})
	if err != nil {
		t.Fatal(err)
	}
	hidden, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: store.RootOrganizationUnitID, ParentID: store.RootDepartmentID, Name: "Hidden"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetAssignments(ctx, "admin", viewer, []AssignmentInput{{DepartmentID: visible.ID, IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetAssignments(ctx, "admin", target, []AssignmentInput{{DepartmentID: visible.ID}, {DepartmentID: hidden.ID, IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetPolicy(ctx, "admin", Policy{VisibilityScope: "same_department"}); err != nil {
		t.Fatal(err)
	}
	assignments, err := service.AssignmentsForViewer(ctx, viewer, target)
	if err != nil || len(assignments) != 1 || assignments[0].DepartmentID != visible.ID || assignments[0].IsPrimary {
		t.Fatalf("filtered assignments = %+v, %v", assignments, err)
	}
}
