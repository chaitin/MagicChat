package organization

import (
	"context"
	"errors"
	"reflect"
	"sort"
	"testing"

	"app/internal/store"

	"gorm.io/gorm"
)

func leaderTestDepartment(t *testing.T, s *Service, unitID, parentID, name string) Department {
	t.Helper()
	dept, err := s.CreateDepartment(context.Background(), "admin", DepartmentInput{UnitID: unitID, ParentID: parentID, Name: name})
	if err != nil {
		t.Fatal(err)
	}
	return dept
}

func leaderTestRoot(t *testing.T, db *gorm.DB, unitID string) string {
	t.Helper()
	var root store.OrganizationDepartment
	if err := db.Where("unit_id = ? AND is_root = ?", unitID, true).First(&root).Error; err != nil {
		t.Fatal(err)
	}
	return root.ID
}

func TestLeaderMembershipEntryPointsPreserveExistingProfileAndAssignments(t *testing.T) {
	for _, entry := range []string{"create_unit", "update_unit", "set_unit", "set_group", "create_department", "update_department", "set_department"} {
		t.Run(entry, func(t *testing.T) {
			db := testOrganizationDB(t)
			s := NewService(db)
			ctx := context.Background()
			user := testOrganizationUser(t, db, "负责人")
			manager := testOrganizationUser(t, db, "上级")
			old := leaderTestDepartment(t, s, store.RootOrganizationUnitID, store.RootDepartmentID, "原部门")
			if err := db.Model(&store.User{}).Where("id = ?", user).Update("job_title", "高级工程师").Error; err != nil {
				t.Fatal(err)
			}
			before, err := s.SetAssignments(ctx, "admin", user, []AssignmentInput{{DepartmentID: old.ID, IsPrimary: true, SortOrder: 7}})
			if err != nil {
				t.Fatal(err)
			}
			reporting, err := s.SetReporting(ctx, "admin", user, Reporting{DirectManagerUserID: &manager})
			if err != nil {
				t.Fatal(err)
			}
			unit, err := s.CreateUnit(ctx, "admin", UnitInput{Name: "目标单位", Kind: "subsidiary"})
			if err != nil {
				t.Fatal(err)
			}
			root := leaderTestRoot(t, db, unit.ID)
			dept := leaderTestDepartment(t, s, unit.ID, root, "目标部门")
			target := root
			leaders := []Leader{{UserID: user, IsPrimary: true}}
			switch entry {
			case "create_unit":
				created, createErr := s.CreateUnit(ctx, "admin", UnitInput{Name: "新单位", Kind: "subsidiary", LeaderUserID: &user})
				err = createErr
				if err == nil {
					target = leaderTestRoot(t, db, created.ID)
				}
			case "update_unit":
				err = s.UpdateUnit(ctx, "admin", unit.ID, UnitInput{ParentID: store.RootOrganizationUnitID, Name: "新名称", Kind: unit.Kind, LeaderUserID: &user})
			case "set_unit":
				err = s.SetUnitLeader(ctx, "admin", unit.ID, &user)
			case "set_group":
				// This member belongs to another unit, so joining the group requires a new direct membership.
				if _, err = s.SetAssignments(ctx, "admin", user, []AssignmentInput{{DepartmentID: dept.ID, IsPrimary: true, SortOrder: 7}}); err != nil {
					t.Fatal(err)
				}
				before, err = s.Assignments(ctx, user)
				if err != nil {
					t.Fatal(err)
				}
				target = store.RootDepartmentID
				err = s.SetUnitLeader(ctx, "admin", store.RootOrganizationUnitID, &user)
			case "create_department":
				created, createErr := s.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: unit.ID, ParentID: root, Name: "新部门", Leaders: &leaders})
				err, target = createErr, created.ID
				if err == nil && !reflect.DeepEqual(created.Leaders, leaders) {
					t.Fatalf("创建响应未包含负责人: %+v", created)
				}
			case "update_department":
				target = dept.ID
				err = s.UpdateDepartment(ctx, "admin", dept.ID, DepartmentInput{UnitID: unit.ID, ParentID: root, Name: "新部门名", Leaders: &leaders})
			case "set_department":
				target = dept.ID
				err = s.SetDepartmentLeaders(ctx, "admin", dept.ID, leaders)
			}
			if err != nil {
				t.Fatal(err)
			}
			after, err := s.Assignments(ctx, user)
			if err != nil || len(after) != 2 {
				t.Fatalf("归属 = %+v, %v", after, err)
			}
			for _, assignment := range after {
				if assignment.DepartmentID == before[0].DepartmentID {
					if !reflect.DeepEqual(assignment, before[0]) {
						t.Fatalf("已有归属被修改: %+v -> %+v", before[0], assignment)
					}
				} else if assignment.DepartmentID != target || assignment.IsPrimary || assignment.Title != "高级工程师" {
					t.Fatalf("自动归属不正确: %+v", assignment)
				}
			}
			afterReporting, err := s.Reporting(ctx, user)
			if err != nil || !reflect.DeepEqual(afterReporting, reporting) {
				t.Fatalf("汇报关系被修改: %+v, %v", afterReporting, err)
			}
			members, err := s.Members(ctx, target, 1, 50)
			if err != nil || len(members.Members) != 1 || members.Members[0].ID != user {
				t.Fatalf("负责人未出现在成员列表: %+v, %v", members, err)
			}
		})
	}
}

func TestLeaderFirstMembershipAndRemoval(t *testing.T) {
	for _, kind := range []string{"unit", "department"} {
		t.Run(kind, func(t *testing.T) {
			db := testOrganizationDB(t)
			s := NewService(db)
			ctx := context.Background()
			first := testOrganizationUser(t, db, "原负责人")
			next := testOrganizationUser(t, db, "新负责人")
			target := store.RootDepartmentID
			set := func(id *string) error {
				return s.SetUnitLeader(ctx, "admin", store.RootOrganizationUnitID, id)
			}
			if kind == "department" {
				dept := leaderTestDepartment(t, s, store.RootOrganizationUnitID, store.RootDepartmentID, "研发")
				target = dept.ID
				set = func(id *string) error {
					leaders := []Leader{}
					if id != nil {
						leaders = append(leaders, Leader{UserID: *id, IsPrimary: true})
					}
					return s.SetDepartmentLeaders(ctx, "admin", target, leaders)
				}
			}
			if err := set(&first); err != nil {
				t.Fatal(err)
			}
			before, err := s.Assignments(ctx, first)
			if err != nil || len(before) != 1 || !before[0].IsPrimary || before[0].DepartmentID != target {
				t.Fatalf("首次归属未成为主归属: %+v, %v", before, err)
			}
			for _, id := range []*string{&first, &next, nil} {
				if err := set(id); err != nil {
					t.Fatal(err)
				}
			}
			after, err := s.Assignments(ctx, first)
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatalf("重复保存或取消负责人修改了已有归属: %+v, %v", after, err)
			}
			added, err := s.Assignments(ctx, next)
			if err != nil || len(added) != 1 || !added[0].IsPrimary || added[0].DepartmentID != target {
				t.Fatalf("新负责人未加入: %+v, %v", added, err)
			}
			var audits int64
			if err := db.Model(&store.OrganizationAuditEvent{}).Where("action = ? AND target_id = ?", "member.assignments", first).Count(&audits).Error; err != nil || audits != 1 {
				t.Fatalf("重复保存生成了多次归属变更: %d, %v", audits, err)
			}
		})
	}
}

func TestUnitLeaderAlreadyInDepartmentDoesNotGainDuplicateDirectMembership(t *testing.T) {
	db := testOrganizationDB(t)
	s := NewService(db)
	ctx := context.Background()
	user := testOrganizationUser(t, db, "负责人")
	unit, err := s.CreateUnit(ctx, "admin", UnitInput{Name: "单位", Kind: "subsidiary"})
	if err != nil {
		t.Fatal(err)
	}
	root := leaderTestRoot(t, db, unit.ID)
	dept := leaderTestDepartment(t, s, unit.ID, root, "研发")
	before, err := s.SetAssignments(ctx, "admin", user, []AssignmentInput{{DepartmentID: dept.ID, IsPrimary: true}})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetUnitLeader(ctx, "admin", unit.ID, &user); err != nil {
		t.Fatal(err)
	}
	after, err := s.Assignments(ctx, user)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("已有本单位归属仍被重复加入: %+v, %v", after, err)
	}
}

func TestDepartmentAllLeadersJoinWithoutChangingExistingMembership(t *testing.T) {
	db := testOrganizationDB(t)
	s := NewService(db)
	ctx := context.Background()
	first := testOrganizationUser(t, db, "主负责人")
	second := testOrganizationUser(t, db, "共同负责人")
	existing := testOrganizationUser(t, db, "已有成员")
	dept := leaderTestDepartment(t, s, store.RootOrganizationUnitID, store.RootDepartmentID, "研发")
	before, err := s.SetAssignments(ctx, "admin", existing, []AssignmentInput{
		{DepartmentID: store.RootDepartmentID, IsPrimary: true},
		{DepartmentID: dept.ID, SortOrder: 9},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SetDepartmentLeaders(ctx, "admin", dept.ID, []Leader{
		{UserID: existing}, {UserID: second}, {UserID: first, IsPrimary: true},
	}); err != nil {
		t.Fatal(err)
	}
	for _, user := range []string{first, second} {
		assignments, err := s.Assignments(ctx, user)
		if err != nil || len(assignments) != 1 || assignments[0].DepartmentID != dept.ID || !assignments[0].IsPrimary {
			t.Fatalf("负责人未加入部门: %+v, %v", assignments, err)
		}
	}
	after, err := s.Assignments(ctx, existing)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("已有成员的归属被更改: %+v, %v", after, err)
	}
}

type leaderMembershipState struct {
	Units       []store.OrganizationUnit
	Departments []store.OrganizationDepartment
	Assignments []store.OrganizationAssignment
	Leaders     []store.OrganizationDepartmentLeader
	Audits      []store.OrganizationAuditEvent
}

func leaderTestState(t *testing.T, db *gorm.DB) leaderMembershipState {
	t.Helper()
	var state leaderMembershipState
	for _, query := range []struct {
		dest  any
		order string
	}{
		{&state.Units, "id"},
		{&state.Departments, "id"},
		{&state.Assignments, "id"},
		{&state.Leaders, "department_id, user_id"},
		{&state.Audits, "id"},
	} {
		if err := db.Order(query.order).Find(query.dest).Error; err != nil {
			t.Fatal(err)
		}
	}
	return state
}

func TestLeaderMembershipFailureRollsBackAllEntryPoints(t *testing.T) {
	for _, entry := range []string{"create_unit", "update_unit", "set_unit", "create_department", "update_department", "set_department"} {
		t.Run(entry, func(t *testing.T) {
			db := testOrganizationDB(t)
			s := NewService(db)
			ctx := context.Background()
			ids := []string{testOrganizationUser(t, db, "候选一"), testOrganizationUser(t, db, "候选二")}
			sort.Strings(ids)
			free, full := ids[0], ids[1]
			input := []AssignmentInput{}
			for i := 0; i < 20; i++ {
				dept := leaderTestDepartment(t, s, store.RootOrganizationUnitID, store.RootDepartmentID, "原部门"+string(rune('A'+i)))
				input = append(input, AssignmentInput{DepartmentID: dept.ID, IsPrimary: i == 0})
			}
			if _, err := s.SetAssignments(ctx, "admin", full, input); err != nil {
				t.Fatal(err)
			}
			unit, err := s.CreateUnit(ctx, "admin", UnitInput{Name: "目标单位", Kind: "subsidiary"})
			if err != nil {
				t.Fatal(err)
			}
			root := leaderTestRoot(t, db, unit.ID)
			dept := leaderTestDepartment(t, s, unit.ID, root, "目标部门")
			previous := testOrganizationUser(t, db, "原负责人")
			if entry == "update_unit" || entry == "set_unit" {
				if err := s.SetUnitLeader(ctx, "admin", unit.ID, &previous); err != nil {
					t.Fatal(err)
				}
			} else if entry == "update_department" || entry == "set_department" {
				if err := s.SetDepartmentLeaders(ctx, "admin", dept.ID, []Leader{{UserID: previous, IsPrimary: true}}); err != nil {
					t.Fatal(err)
				}
			}
			before := leaderTestState(t, db)
			leaders := []Leader{{UserID: free, IsPrimary: true}, {UserID: full}}
			switch entry {
			case "create_unit":
				_, err = s.CreateUnit(ctx, "admin", UnitInput{Name: "失败单位", Kind: "subsidiary", LeaderUserID: &full})
			case "update_unit":
				err = s.UpdateUnit(ctx, "admin", unit.ID, UnitInput{ParentID: store.RootOrganizationUnitID, Name: "失败名称", Kind: unit.Kind, LeaderUserID: &full})
			case "set_unit":
				err = s.SetUnitLeader(ctx, "admin", unit.ID, &full)
			case "create_department":
				_, err = s.CreateDepartment(ctx, "admin", DepartmentInput{UnitID: unit.ID, ParentID: root, Name: "失败部门", Leaders: &leaders})
			case "update_department":
				err = s.UpdateDepartment(ctx, "admin", dept.ID, DepartmentInput{UnitID: unit.ID, ParentID: root, Name: "失败名称", Leaders: &leaders})
			case "set_department":
				err = s.SetDepartmentLeaders(ctx, "admin", dept.ID, leaders)
			}
			if !errors.Is(err, ErrInvalid) {
				t.Fatalf("归属超限未拒绝保存: %v", err)
			}
			if after := leaderTestState(t, db); !reflect.DeepEqual(before, after) {
				t.Fatalf("失败后留下负责人、组织、成员归属或审计的部分变更")
			}
		})
	}
}
