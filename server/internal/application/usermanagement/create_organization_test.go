package usermanagement

import (
	"context"
	"fmt"
	"testing"
	"time"

	"app/internal/application/organization"
	"app/internal/store"

	"github.com/google/uuid"
)

func TestCreateMemberWithOrganizationIsAtomic(t *testing.T) {
	for _, scenario := range []string{"unit direct", "department", "missing department", "invalid department", "disabled unit"} {
		t.Run(scenario, func(t *testing.T) {
			db, service, _, _, _, changed := unifiedMemberFixture(t)
			unitID, rootID, departmentID, userID := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
			parentID := store.RootOrganizationUnitID
			if err := db.Create(&store.OrganizationUnit{ID: unitID, ParentID: &parentID, Name: "Selected Unit", Kind: "subsidiary"}).Error; err != nil {
				t.Fatal(err)
			}
			for _, department := range []store.OrganizationDepartment{
				{ID: rootID, UnitID: unitID, IsRoot: true},
				{ID: departmentID, UnitID: unitID, ParentID: &rootID, Name: "Selected Department"},
			} {
				if err := db.Create(&department).Error; err != nil {
					t.Fatal(err)
				}
			}
			// Simulate the production insert trigger; explicit membership must replace its root assignment.
			if err := db.Exec(fmt.Sprintf("CREATE TRIGGER test_assign_root AFTER INSERT ON users BEGIN INSERT INTO organization_assignments (id, user_id, department_id, is_primary, created_at, updated_at) VALUES ('%s', NEW.id, '%s', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP); END",
				uuid.NewString(), store.RootDepartmentID)).Error; err != nil {
				t.Fatal(err)
			}
			service.newID = func() string { return userID }
			selected, wantError := departmentID, ErrorCode("")
			switch scenario {
			case "unit direct":
				selected = rootID
			case "missing department":
				selected, wantError = uuid.NewString(), CodeNotFound
			case "invalid department":
				selected, wantError = "invalid", CodeInvalidRequest
			case "disabled unit":
				now := time.Now().UTC()
				if err := db.Model(&store.OrganizationUnit{}).Where("id = ?", unitID).Update("disabled_at", &now).Error; err != nil {
					t.Fatal(err)
				}
				wantError = CodeConflict
			}
			result, err := service.Create(context.Background(), CreateCommand{
				Actor: "admin:create-test", Email: "new-member@example.test", Name: "New Member", DepartmentID: selected,
			})
			if wantError != "" {
				if ErrorCodeOf(err) != wantError {
					t.Fatalf("create error = %v, want %s", err, wantError)
				}
				for _, table := range []struct {
					model  any
					column string
				}{
					{&store.User{}, "id"}, {&store.OrganizationAssignment{}, "user_id"}, {&store.Project{}, "owner_user_id"},
				} {
					var count int64
					if err := db.Model(table.model).Where(table.column+" = ?", userID).Count(&count).Error; err != nil || count != 0 {
						t.Fatalf("creation leaked after rollback: %T, %d, %v", table.model, count, err)
					}
				}
				var audits int64
				db.Model(&store.OrganizationAuditEvent{}).Where("actor = ?", "admin:create-test").Count(&audits)
				if *changed != 0 || audits != 0 {
					t.Fatalf("failed create published changes: %d, audits=%d", *changed, audits)
				}
				return
			}
			if err != nil || result.InitialPassword == "" || result.User.ID != userID {
				t.Fatalf("create = %+v, %v", result, err)
			}
			roles, err := organization.NewService(db).Assignments(context.Background(), userID)
			if err != nil || len(roles) != 1 || roles[0].DepartmentID != selected || !roles[0].IsPrimary {
				t.Fatalf("created assignments = %+v, %v", roles, err)
			}
			var projects, audits int64
			db.Model(&store.Project{}).Where("owner_user_id = ?", userID).Count(&projects)
			db.Model(&store.OrganizationAuditEvent{}).Where("actor = ?", "admin:create-test").Count(&audits)
			if projects != 1 || audits != 1 || *changed != 1 {
				t.Fatalf("create effects: projects=%d audits=%d notifications=%d", projects, audits, *changed)
			}
		})
	}
}
