package usermanagement

import (
	"context"
	"strings"
	"testing"

	"app/internal/application/organization"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func addJobTitleTestDepartment(t *testing.T, db *gorm.DB) string {
	t.Helper()
	unitID, rootID, deptID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	parentID := store.RootOrganizationUnitID
	if err := db.Create(&store.OrganizationUnit{ID: unitID, ParentID: &parentID, Name: "Subsidiary", Kind: "subsidiary"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, dept := range []store.OrganizationDepartment{
		{ID: rootID, UnitID: unitID, IsRoot: true},
		{ID: deptID, UnitID: unitID, ParentID: &rootID, Name: "Engineering"},
	} {
		if err := db.Create(&dept).Error; err != nil {
			t.Fatal(err)
		}
	}
	return deptID
}

func TestMemberHasOneJobTitleAcrossOrganizations(t *testing.T) {
	db, service, user, _, notifications, changed := unifiedMemberFixture(t)
	deptID := addJobTitleTestDepartment(t, db)
	title := " 工程师 "
	memberships := []organization.AssignmentInput{
		{DepartmentID: store.RootDepartmentID, IsPrimary: true},
		{DepartmentID: deptID},
	}
	updated, err := service.Update(context.Background(), UpdateCommand{
		UserID: user.ID, Name: user.Name, Email: user.Email, JobTitle: &title, Assignments: &memberships,
	})
	if err != nil || updated.JobTitle != "工程师" {
		t.Fatalf("update: %+v %v", updated, err)
	}
	org := organization.NewService(db)
	assertTitles := func() {
		t.Helper()
		values, err := org.Assignments(context.Background(), user.ID)
		if err != nil || len(values) != 2 {
			t.Fatalf("memberships: %+v %v", values, err)
		}
		for _, value := range values {
			if value.Title != "工程师" {
				t.Fatalf("membership overrides member title: %+v", value)
			}
			page, err := org.Members(context.Background(), value.DepartmentID, 1, 50)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, member := range page.Members {
				if member.ID == user.ID {
					found = member.Title == "工程师"
				}
			}
			if !found {
				t.Fatalf("directory title: %+v", page)
			}
		}
	}
	assertTitles()
	memberships[0].IsPrimary, memberships[1].IsPrimary = false, true
	if _, err := org.SetAssignments(context.Background(), "admin:test", user.ID, memberships); err != nil {
		t.Fatal(err)
	}
	assertTitles()
	if len(notifications.ids) != 1 || *changed != 1 {
		t.Fatalf("notifications: %+v %d", notifications.ids, *changed)
	}
	if db.Migrator().HasColumn(&store.OrganizationAssignment{}, "title") {
		t.Fatal("memberships still store independent job titles")
	}
}

func TestMemberJobTitleCanBeOmittedClearedOrRejected(t *testing.T) {
	for _, scenario := range []string{"omitted", "clear", "too long"} {
		t.Run(scenario, func(t *testing.T) {
			db, service, user, _, notifications, changed := unifiedMemberFixture(t)
			var input *string
			want := "Before"
			switch scenario {
			case "clear":
				value := ""
				input, want = &value, ""
			case "too long":
				value := strings.Repeat("职", 161)
				input = &value
			}
			value, err := service.Update(context.Background(), UpdateCommand{UserID: user.ID, Name: user.Name, Email: user.Email, JobTitle: input})
			if scenario == "too long" {
				if ErrorCodeOf(err) != CodeInvalidRequest {
					t.Fatalf("invalid title: %v", err)
				}
				if len(notifications.ids) != 0 || *changed != 0 {
					t.Fatal("invalid title published changes")
				}
			} else if err != nil || value.JobTitle != want {
				t.Fatalf("title: %+v %v", value, err)
			}
			var stored store.User
			if err := db.First(&stored, "id = ?", user.ID).Error; err != nil || stored.JobTitle != want {
				t.Fatalf("stored title: %+v %v", stored, err)
			}
		})
	}
}

func TestCreateMemberWithOneTitleAndMultipleOrganizations(t *testing.T) {
	for _, invalid := range []bool{false, true} {
		t.Run(map[bool]string{false: "valid", true: "rollback"}[invalid], func(t *testing.T) {
			db, service, _, _, _, changed := unifiedMemberFixture(t)
			deptID := addJobTitleTestDepartment(t, db)
			if invalid {
				deptID = uuid.NewString()
			}
			memberships := []organization.AssignmentInput{
				{DepartmentID: store.RootDepartmentID, IsPrimary: true},
				{DepartmentID: deptID},
			}
			value, err := service.Create(context.Background(), CreateCommand{
				Email: "single-title@example.test", Name: "New Member", JobTitle: " 工程师 ", Assignments: &memberships,
			})
			if invalid {
				if ErrorCodeOf(err) != CodeNotFound {
					t.Fatalf("create error: %v", err)
				}
				var count int64
				if err := db.Model(&store.User{}).Where("email = ?", "single-title@example.test").Count(&count).Error; err != nil || count != 0 || *changed != 0 {
					t.Fatalf("partial create: %d %v", count, err)
				}
				return
			}
			if err != nil || value.User.JobTitle != "工程师" {
				t.Fatalf("create: %+v %v", value, err)
			}
			values, err := organization.NewService(db).Assignments(context.Background(), value.User.ID)
			if err != nil || len(values) != 2 {
				t.Fatalf("memberships: %+v %v", values, err)
			}
			for _, item := range values {
				if item.Title != "工程师" {
					t.Fatalf("title: %+v", item)
				}
			}
		})
	}
}
