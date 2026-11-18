package usermanagement

import (
	"context"
	"testing"

	"app/internal/application/organization"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func unifiedMemberFixture(t *testing.T) (*gorm.DB, *Service, store.User, store.User, *profileUpdateRecorder, *int) {
	t.Helper()
	db := openUserManagementTestDB(t)
	if err := db.AutoMigrate(&store.OrganizationUnit{}, &store.OrganizationDepartment{}, &store.OrganizationAssignment{},
		&store.OrganizationMemberReporting{}, &store.OrganizationMemberDottedManager{}, &store.OrganizationAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	user := store.User{ID: uuid.NewString(), Email: "member@example.test", Name: "Before", JobTitle: "Before", Status: StatusActive, PasswordHash: "hash"}
	manager := store.User{ID: uuid.NewString(), Email: "manager@example.test", Name: "Manager", Status: StatusActive, PasswordHash: "hash"}
	for _, item := range []store.User{user, manager} {
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&store.OrganizationUnit{ID: store.RootOrganizationUnitID, Kind: "group"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&store.OrganizationDepartment{ID: store.RootDepartmentID, UnitID: store.RootOrganizationUnitID, IsRoot: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&store.OrganizationAssignment{ID: uuid.NewString(), UserID: user.ID, DepartmentID: store.RootDepartmentID, IsPrimary: true}).Error; err != nil {
		t.Fatal(err)
	}
	recorder, changed := &profileUpdateRecorder{}, new(int)
	s := NewService(Dependencies{DB: db, ProfileNotifications: recorder, OrganizationChanged: func() { *changed++ }})
	return db, s, user, manager, recorder, changed
}

func TestUnifiedMemberUpdateCommitsAllSections(t *testing.T) {
	db, s, user, manager, notifications, changed := unifiedMemberFixture(t)
	assignments := []organization.AssignmentInput{{DepartmentID: store.RootDepartmentID, IsPrimary: true}}
	reporting := organization.Reporting{DirectManagerUserID: &manager.ID, DottedManagerUserIDs: []string{}}
	jobTitle := "After"
	value, err := s.Update(context.Background(), UpdateCommand{JobTitle: &jobTitle, Actor: "admin:test", UserID: user.ID, Name: "After", Email: "after@example.test", Nickname: "New", Assignments: &assignments, Reporting: &reporting})
	if err != nil {
		t.Fatal(err)
	}
	var stored store.User
	if err := db.First(&stored, "id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	org := organization.NewService(db)
	roles, err := org.Assignments(context.Background(), user.ID)
	if err != nil {
		t.Fatal(err)
	}
	reports, err := org.Reporting(context.Background(), user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if value.Name != "After" || stored.Email != "after@example.test" || stored.Nickname != "New" || roles[0].Title != "After" ||
		reports.DirectManagerUserID == nil || *reports.DirectManagerUserID != manager.ID {
		t.Fatalf("incomplete update: %#v %#v %#v", stored, roles, reports)
	}
	var audits int64
	db.Model(&store.OrganizationAuditEvent{}).Where("actor = ?", "admin:test").Count(&audits)
	if len(notifications.ids) != 1 || *changed != 1 || audits != 2 {
		t.Fatalf("notifications/audits: %d %d %d", len(notifications.ids), *changed, audits)
	}
}

func TestUnifiedMemberUpdateRollsBackEverySection(t *testing.T) {
	for _, failure := range []string{"assignment", "reporting", "duplicate email"} {
		t.Run(failure, func(t *testing.T) {
			db, s, user, manager, notifications, changed := unifiedMemberFixture(t)
			assignments := []organization.AssignmentInput{{DepartmentID: store.RootDepartmentID, IsPrimary: true}}
			reporting := organization.Reporting{DirectManagerUserID: &manager.ID, DottedManagerUserIDs: []string{}}
			email := "after@example.test"
			expected := CodeNotFound
			switch failure {
			case "assignment":
				assignments[0].DepartmentID = uuid.NewString()
			case "reporting":
				reporting.DirectManagerUserID = &user.ID
				expected = CodeInvalidRequest
			case "duplicate email":
				email = manager.Email
				expected = CodeConflict
			}
			jobTitle := "After"
			_, err := s.Update(context.Background(), UpdateCommand{JobTitle: &jobTitle, Actor: "admin:test", UserID: user.ID, Name: "After", Email: email, Assignments: &assignments, Reporting: &reporting})
			if ErrorCodeOf(err) != expected {
				t.Fatalf("error: %v", err)
			}
			var stored store.User
			if err := db.First(&stored, "id = ?", user.ID).Error; err != nil {
				t.Fatal(err)
			}
			org := organization.NewService(db)
			roles, err := org.Assignments(context.Background(), user.ID)
			if err != nil {
				t.Fatal(err)
			}
			reports, err := org.Reporting(context.Background(), user.ID)
			if err != nil {
				t.Fatal(err)
			}
			var audits int64
			db.Model(&store.OrganizationAuditEvent{}).Count(&audits)
			if stored.Name != "Before" || stored.Email != user.Email || roles[0].Title != "Before" || reports.DirectManagerUserID != nil ||
				audits != 0 || len(notifications.ids) != 0 || *changed != 0 {
				t.Fatalf("partial save: %#v %#v %#v audits=%d notifications=%d changed=%d", stored, roles, reports, audits, len(notifications.ids), *changed)
			}
		})
	}
}
