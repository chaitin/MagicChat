package organization

import (
	"context"
	"errors"
	"testing"
	"time"

	"app/internal/store"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func testOrganizationDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&store.User{}, &store.AppSettings{}, &store.OrganizationUnit{},
		&store.OrganizationDepartment{}, &store.OrganizationAssignment{},
		&store.OrganizationMemberReporting{}, &store.OrganizationMemberDottedManager{},
		&store.OrganizationDepartmentLeader{},
		&store.OrganizationAuditEvent{},
		&store.OrganizationPolicy{},
	); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := db.Create(&store.AppSettings{ID: store.AppSettingsID, AppName: "Test", OrganizationName: "Test Group", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&store.OrganizationUnit{ID: store.RootOrganizationUnitID, Name: "", Kind: "group", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&store.OrganizationDepartment{ID: store.RootDepartmentID, UnitID: store.RootOrganizationUnitID, IsRoot: true, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&store.OrganizationPolicy{ID: 1, VisibilityScope: "all", UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func TestOrganizationVisibilityUsesViewerPrimaryUnit(t *testing.T) {
	db := testOrganizationDB(t)
	service := NewService(db)
	ctx := context.Background()
	viewer := testOrganizationUser(t, db, "Viewer")
	colleague := testOrganizationUser(t, db, "Colleague")
	other := testOrganizationUser(t, db, "Other")
	first, err := service.CreateUnit(ctx, "admin", UnitInput{Name: "A", Kind: "subsidiary"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.CreateUnit(ctx, "admin", UnitInput{Name: "B", Kind: "subsidiary"})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	roots := map[string]string{}
	for _, department := range snapshot.Departments {
		if department.IsRoot {
			roots[department.UnitID] = department.ID
		}
	}
	for _, value := range []struct{ user, department string }{{viewer, roots[first.ID]}, {colleague, roots[first.ID]}, {other, roots[second.ID]}} {
		if _, err := service.SetAssignments(ctx, "admin", value.user, []AssignmentInput{{DepartmentID: value.department, IsPrimary: true}}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := service.SetPolicy(ctx, "admin", Policy{VisibilityScope: "same_unit"}); err != nil {
		t.Fatal(err)
	}
	if err := service.SetUnitLeader(ctx, "admin", store.RootOrganizationUnitID, &other); err != nil {
		t.Fatal(err)
	}
	ids, err := service.VisibleUserIDs(ctx, viewer)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, id := range ids {
		found[id] = true
	}
	if !found[viewer] || !found[colleague] || found[other] {
		t.Fatalf("visible users = %v", ids)
	}
	visible, err := service.SnapshotForViewer(ctx, viewer)
	if err != nil {
		t.Fatal(err)
	}
	for _, unit := range visible.Units {
		if unit.ID == second.ID {
			t.Fatal("other subsidiary leaked")
		}
		if unit.ID == store.RootOrganizationUnitID && unit.LeaderUserID != nil {
			t.Fatalf("hidden root leader leaked: %s", *unit.LeaderUserID)
		}
	}
	if _, err := service.AssignmentsForViewer(ctx, viewer, other); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other assignments = %v", err)
	}
}

func TestOrganizationVisibilityRechecksViewerAfterTransfer(t *testing.T) {
	db := testOrganizationDB(t)
	service := NewService(db)
	ctx := context.Background()
	viewer := testOrganizationUser(t, db, "Viewer")
	formerColleague := testOrganizationUser(t, db, "Former colleague")
	newColleague := testOrganizationUser(t, db, "New colleague")
	first, err := service.CreateUnit(ctx, "admin", UnitInput{Name: "A", Kind: "subsidiary"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.CreateUnit(ctx, "admin", UnitInput{Name: "B", Kind: "subsidiary"})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	roots := map[string]string{}
	for _, department := range snapshot.Departments {
		if department.IsRoot {
			roots[department.UnitID] = department.ID
		}
	}
	for _, assignment := range []struct{ user, department string }{
		{viewer, roots[first.ID]}, {formerColleague, roots[first.ID]}, {newColleague, roots[second.ID]},
	} {
		if _, err := service.SetAssignments(ctx, "admin", assignment.user, []AssignmentInput{{DepartmentID: assignment.department, IsPrimary: true}}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := service.SetPolicy(ctx, "admin", Policy{VisibilityScope: "same_unit"}); err != nil {
		t.Fatal(err)
	}
	before, err := service.MembersForViewer(ctx, viewer, roots[first.ID], 1, 50)
	if err != nil || before.Total != 2 {
		t.Fatalf("members before transfer = %+v, %v", before, err)
	}
	if _, err := service.SetAssignments(ctx, "admin", viewer, []AssignmentInput{{DepartmentID: roots[second.ID], IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.MembersForViewer(ctx, viewer, roots[first.ID], 1, 50); !errors.Is(err, ErrNotFound) {
		t.Fatalf("former unit members after transfer = %v", err)
	}
	after, err := service.MembersForViewer(ctx, viewer, roots[second.ID], 1, 50)
	if err != nil || after.Total != 2 {
		t.Fatalf("new unit members after transfer = %+v, %v", after, err)
	}
	if _, err := service.AssignmentsForViewer(ctx, viewer, formerColleague); !errors.Is(err, ErrNotFound) {
		t.Fatalf("former colleague assignments after transfer = %v", err)
	}
}

func testOrganizationUser(t *testing.T, db *gorm.DB, name string) string {
	t.Helper()
	id := uuid.NewString()
	now := time.Now().UTC()
	if err := db.Create(&store.User{ID: id, Name: name, Email: id + "@example.test", Status: store.UserStatusActive, PasswordHash: "unused", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	return id
}

func TestOrganizationSnapshotOrdersUnitAndDepartmentTrees(t *testing.T) {
	root := Unit{ID: "root"}
	childParent := "root"
	child := Unit{ID: "child", ParentID: &childParent}
	grandParent := "child"
	grandchild := Unit{ID: "grandchild", ParentID: &grandParent}
	units := orderUnits([]Unit{grandchild, root, child})
	if units[0].ID != "root" || units[1].ID != "child" || units[2].ID != "grandchild" {
		t.Fatalf("unit order = %+v", units)
	}
	departmentRoot := Department{ID: "root-dept", UnitID: "root"}
	departmentParent := "root-dept"
	departmentChild := Department{ID: "child-dept", UnitID: "root", ParentID: &departmentParent}
	secondRoot := Department{ID: "second-root", UnitID: "child"}
	departments := orderDepartments([]Department{departmentChild, secondRoot, departmentRoot}, units)
	if departments[0].ID != "root-dept" || departments[1].ID != "child-dept" || departments[2].ID != "second-root" {
		t.Fatalf("department order = %+v", departments)
	}
}

func TestOrganizationSameDepartmentHidesOtherMembersAndManagers(t *testing.T) {
	db := testOrganizationDB(t)
	service := NewService(db)
	ctx := context.Background()
	viewer := testOrganizationUser(t, db, "Viewer")
	colleague := testOrganizationUser(t, db, "Colleague")
	other := testOrganizationUser(t, db, "Other")
	sales, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: store.RootOrganizationUnitID, ParentID: store.RootDepartmentID, Name: "Sales"})
	if err != nil {
		t.Fatal(err)
	}
	engineering, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: store.RootOrganizationUnitID, ParentID: store.RootDepartmentID, Name: "Engineering"})
	if err != nil {
		t.Fatal(err)
	}
	for _, assignment := range []struct{ user, department string }{{viewer, sales.ID}, {other, engineering.ID}} {
		if _, err := service.SetAssignments(ctx, "admin", assignment.user, []AssignmentInput{{DepartmentID: assignment.department, IsPrimary: true}}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := service.SetAssignments(ctx, "admin", colleague, []AssignmentInput{{DepartmentID: sales.ID, IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetReporting(ctx, "admin", colleague, Reporting{DirectManagerUserID: &other}); err != nil {
		t.Fatal(err)
	}
	if err := service.SetDepartmentLeaders(ctx, "admin", store.RootDepartmentID, []Leader{{UserID: other, IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetPolicy(ctx, "admin", Policy{VisibilityScope: "same_department"}); err != nil {
		t.Fatal(err)
	}
	visible, err := service.SnapshotForViewer(ctx, viewer)
	if err != nil {
		t.Fatal(err)
	}
	for _, department := range visible.Departments {
		if department.ID == engineering.ID {
			t.Fatal("unrelated department leaked")
		}
		if department.ID == store.RootDepartmentID && len(department.Leaders) != 0 {
			t.Fatalf("hidden ancestor leader leaked: %+v", department.Leaders)
		}
	}
	if _, err := service.MembersForViewer(ctx, viewer, engineering.ID, 1, 50); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unrelated department members = %v", err)
	}
	rootMembers, err := service.MembersForViewer(ctx, viewer, store.RootDepartmentID, 1, 50)
	if err != nil || rootMembers.Total != 0 {
		t.Fatalf("ancestor members = %+v, %v", rootMembers, err)
	}
	assignments, err := service.AssignmentsForViewer(ctx, viewer, colleague)
	if err != nil || len(assignments) != 1 {
		t.Fatalf("colleague assignments = %+v, %v", assignments, err)
	}
	reporting, err := service.ReportingForViewer(ctx, viewer, colleague)
	if err != nil || reporting.DirectManagerUserID != nil {
		t.Fatalf("hidden manager = %+v, %v", reporting, err)
	}
}

func TestAssignmentsPreserveIdentityAndReportingIsMemberLevel(t *testing.T) {
	db := testOrganizationDB(t)
	service := NewService(db)
	ctx := context.Background()
	a := testOrganizationUser(t, db, "A")
	b := testOrganizationUser(t, db, "B")
	dept, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: store.RootOrganizationUnitID, ParentID: store.RootDepartmentID, Name: "Sales"})
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.SetAssignments(ctx, "admin", a, []AssignmentInput{{DepartmentID: store.RootDepartmentID, IsPrimary: true}})
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 1 {
		t.Fatalf("first assignments = %v", first)
	}
	_, err = service.SetAssignments(ctx, "admin", b, []AssignmentInput{{DepartmentID: dept.ID, IsPrimary: true}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetReporting(ctx, "admin", b, Reporting{DirectManagerUserID: &a}); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&store.User{}).Where("id = ?", a).Update("job_title", "Director").Error; err != nil {
		t.Fatal(err)
	}
	second, err := service.SetAssignments(ctx, "admin", a, []AssignmentInput{
		{DepartmentID: store.RootDepartmentID},
		{DepartmentID: dept.ID, IsPrimary: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 2 || second[1].ID != first[0].ID || !second[0].IsPrimary || second[0].Title != "Director" {
		t.Fatalf("assignment update = %+v", second)
	}
	if _, err := service.SetReporting(ctx, "admin", a, Reporting{DottedManagerUserIDs: []string{b}}); err != nil {
		t.Fatal(err)
	}
	_, err = service.SetReporting(ctx, "admin", a, Reporting{DirectManagerUserID: &b})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("cycle error = %v", err)
	}
	reporting, err := service.Reporting(ctx, a)
	if err != nil || reporting.DirectManagerUserID != nil || len(reporting.DottedManagerUserIDs) != 1 || reporting.DottedManagerUserIDs[0] != b {
		t.Fatalf("reporting rollback = %+v, %v", reporting, err)
	}
	stored, err := service.Assignments(ctx, a)
	if err != nil || len(stored) != 2 {
		t.Fatalf("rollback failed: %v, %v", stored, err)
	}
	if _, err := service.SetAssignments(ctx, "admin", a, []AssignmentInput{{DepartmentID: store.RootDepartmentID, IsPrimary: true}, {DepartmentID: dept.ID}}); err != nil {
		t.Fatal(err)
	}
	reporting, err = service.Reporting(ctx, a)
	if err != nil || len(reporting.DottedManagerUserIDs) != 1 {
		t.Fatalf("reporting changed with primary department = %+v, %v", reporting, err)
	}
}

func TestDepartmentLeadersDoNotCreateReportingCycle(t *testing.T) {
	db := testOrganizationDB(t)
	service := NewService(db)
	ctx := context.Background()
	wang := testOrganizationUser(t, db, "Wang")
	li := testOrganizationUser(t, db, "Li")
	engineering, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: store.RootOrganizationUnitID, ParentID: store.RootDepartmentID, Name: "Engineering"})
	if err != nil {
		t.Fatal(err)
	}
	project, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: store.RootOrganizationUnitID, ParentID: store.RootDepartmentID, Name: "Project A"})
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []struct {
		user   string
		first  string
		second string
	}{{wang, engineering.ID, project.ID}, {li, project.ID, engineering.ID}} {
		if _, err := service.SetAssignments(ctx, "admin", value.user, []AssignmentInput{
			{DepartmentID: value.first, IsPrimary: true},
			{DepartmentID: value.second},
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := service.SetDepartmentLeaders(ctx, "admin", engineering.ID, []Leader{{UserID: wang, IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	if err := service.SetDepartmentLeaders(ctx, "admin", project.ID, []Leader{{UserID: li, IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetReporting(ctx, "admin", li, Reporting{DirectManagerUserID: &wang}); err != nil {
		t.Fatal(err)
	}
	reporting, err := service.Reporting(ctx, wang)
	if err != nil || reporting.DirectManagerUserID != nil {
		t.Fatalf("department leader changed Wang's reporting: %+v, %v", reporting, err)
	}
	if _, err := service.SetReporting(ctx, "admin", wang, Reporting{DirectManagerUserID: &li}); !errors.Is(err, ErrConflict) {
		t.Fatalf("formal reporting cycle error = %v", err)
	}
}

func TestOrganizationRelationshipGuards(t *testing.T) {
	db := testOrganizationDB(t)
	service := NewService(db)
	ctx := context.Background()
	a := testOrganizationUser(t, db, "A")
	unit, err := service.CreateUnit(ctx, "admin", UnitInput{Name: "Subsidiary", Kind: "subsidiary"})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Units[0].Name != "Test Group" {
		t.Fatalf("root name = %s", snapshot.Units[0].Name)
	}
	var unitRoot string
	for _, department := range snapshot.Departments {
		if department.UnitID == unit.ID {
			unitRoot = department.ID
		}
	}
	department, err := service.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: unit.ID, ParentID: unitRoot, Name: "Engineering"})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.SetDepartmentLeaders(ctx, "admin", department.ID, []Leader{{UserID: a}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("missing primary = %v", err)
	}
	if err := service.SetDepartmentLeaders(ctx, "admin", department.ID, []Leader{{UserID: a, IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetAssignments(ctx, "admin", a, []AssignmentInput{{DepartmentID: department.ID, IsPrimary: true}}); err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteUnit(ctx, "admin", unit.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("nonempty unit deletion = %v", err)
	}
	if err := service.UpdateDepartment(ctx, "admin", department.ID, DepartmentInput{UnitID: unit.ID, ParentID: department.ID, Name: "Engineering"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("self parenting = %v", err)
	}
	if _, err := service.SetAssignments(ctx, "admin", a, []AssignmentInput{{DepartmentID: department.ID}, {DepartmentID: department.ID, IsPrimary: true}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("duplicate department = %v", err)
	}
	second, err := service.CreateUnit(ctx, "admin", UnitInput{Name: "Second", Kind: "subsidiary"})
	if err != nil {
		t.Fatal(err)
	}
	updated, err := service.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var secondRoot string
	for _, item := range updated.Departments {
		if item.UnitID == second.ID && item.IsRoot {
			secondRoot = item.ID
		}
	}
	if err := service.UpdateDepartment(ctx, "admin", department.ID, DepartmentInput{UnitID: second.ID, ParentID: secondRoot, Name: "Engineering"}); err != nil {
		t.Fatal(err)
	}
	assignments, err := service.Assignments(ctx, a)
	if err != nil || len(assignments) != 1 || assignments[0].UnitID != second.ID {
		t.Fatalf("moved assignment = %v, %v", assignments, err)
	}
}
