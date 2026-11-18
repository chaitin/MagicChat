package usermanagement

import (
	"context"
	"strings"
	"testing"
	"time"

	"app/internal/store"
	"github.com/google/uuid"
)

type profileUpdateRecorder struct {
	ids       []string
	updatedAt time.Time
}

func (r *profileUpdateRecorder) PublishUserProfileUpdated(_ context.Context, id string, at time.Time) {
	r.ids = append(r.ids, id)
	r.updatedAt = at
}

func TestUpdateMemberNormalizesAndPreservesAccountAndNotifies(t *testing.T) {
	db := openUserManagementTestDB(t)
	now := time.Date(2026, 11, 10, 3, 0, 0, 0, time.UTC)
	phone := "+8613812345678"
	user := store.User{ID: uuid.NewString(), Email: "before@example.com", Name: "Before", Nickname: "Old", Phone: &phone, Status: StatusDisabled, PasswordHash: "unchanged", Avatar: store.DefaultUserAvatar}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	recorder := &profileUpdateRecorder{}
	service := NewService(Dependencies{DB: db, ProfileNotifications: recorder, Now: func() time.Time { return now }})
	value, err := service.Update(context.Background(), UpdateCommand{UserID: user.ID, Email: " AFTER@Example.com ", Name: " 修改姓名 ", Nickname: " 昵称 ", Phone: "139 1234 5678"})
	if err != nil {
		t.Fatal(err)
	}
	if value.Email != "after@example.com" || value.Name != "修改姓名" || value.Nickname != "昵称" || value.Phone != "+8613912345678" || value.Status != StatusDisabled {
		t.Fatalf("updated member = %#v", value)
	}
	var stored store.User
	if err := db.First(&stored, "id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.PasswordHash != user.PasswordHash || stored.Avatar != user.Avatar || !stored.CreatedAt.Equal(user.CreatedAt) {
		t.Fatalf("unrelated account fields changed: %#v", stored)
	}
	if len(recorder.ids) != 1 || recorder.ids[0] != user.ID || !recorder.updatedAt.Equal(now) {
		t.Fatalf("profile notification = %#v", recorder)
	}
	value, err = service.Update(context.Background(), UpdateCommand{UserID: user.ID, Email: value.Email, Name: value.Name})
	if err != nil || value.Phone != "" || value.Nickname != "" {
		t.Fatalf("optional fields not cleared: %#v %v", value, err)
	}
	if err := db.First(&stored, "id = ?", user.ID).Error; err != nil || stored.Phone != nil {
		t.Fatalf("phone must be NULL: %#v %v", stored.Phone, err)
	}
}

func TestUpdateMemberValidationAndConflictsAreAtomic(t *testing.T) {
	db := openUserManagementTestDB(t)
	phone := "+8613912345678"
	user := store.User{ID: uuid.NewString(), Email: "one@example.com", Name: "One", PasswordHash: "hash", Status: StatusActive}
	other := store.User{ID: uuid.NewString(), Email: "two@example.com", Name: "Two", Phone: &phone, PasswordHash: "hash", Status: StatusActive}
	for _, value := range []store.User{user, other} {
		if err := db.Create(&value).Error; err != nil {
			t.Fatal(err)
		}
	}
	recorder := &profileUpdateRecorder{}
	service := NewService(Dependencies{DB: db, ProfileNotifications: recorder})
	cases := []struct {
		name string
		cmd  UpdateCommand
		code ErrorCode
	}{
		{"duplicate email", UpdateCommand{UserID: user.ID, Email: other.Email, Name: "Changed"}, CodeConflict},
		{"duplicate phone", UpdateCommand{UserID: user.ID, Email: user.Email, Name: "Changed", Phone: phone}, CodeConflict},
		{"invalid email", UpdateCommand{UserID: user.ID, Email: "invalid", Name: "Changed"}, CodeInvalidRequest},
		{"empty name", UpdateCommand{UserID: user.ID, Email: user.Email}, CodeInvalidRequest},
		{"long name", UpdateCommand{UserID: user.ID, Email: user.Email, Name: strings.Repeat("字", 121)}, CodeInvalidRequest},
		{"long nickname", UpdateCommand{UserID: user.ID, Email: user.Email, Name: "Changed", Nickname: strings.Repeat("字", 121)}, CodeInvalidRequest},
		{"invalid phone", UpdateCommand{UserID: user.ID, Email: user.Email, Name: "Changed", Phone: "abc"}, CodeInvalidRequest},
		{"invalid ID", UpdateCommand{UserID: "bad", Email: user.Email, Name: "Changed"}, CodeInvalidRequest},
		{"missing user", UpdateCommand{UserID: uuid.NewString(), Email: user.Email, Name: "Changed"}, CodeNotFound},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.Update(context.Background(), test.cmd)
			if ErrorCodeOf(err) != test.code {
				t.Fatalf("error = %v, want %s", err, test.code)
			}
			var stored store.User
			if err := db.First(&stored, "id = ?", user.ID).Error; err != nil {
				t.Fatal(err)
			}
			if stored.Name != user.Name || stored.Email != user.Email || stored.Phone != nil {
				t.Fatalf("failed edit changed user: %#v", stored)
			}
		})
	}
	if len(recorder.ids) != 0 {
		t.Fatal("failed edit published a profile notification")
	}
}

func TestListIncludesOnlyPrimaryOrganizationAndRootName(t *testing.T) {
	db := openUserManagementTestDB(t)
	if err := db.AutoMigrate(&store.OrganizationUnit{}, &store.OrganizationDepartment{}, &store.OrganizationAssignment{}, &store.AppSettings{}); err != nil {
		t.Fatal(err)
	}
	settings := store.AppSettings{ID: store.AppSettingsID, AppName: "test", OrganizationName: "集团名称", ContactDirectoryMode: store.ContactDirectoryModeFriends}
	if err := db.Create(&settings).Error; err != nil {
		t.Fatal(err)
	}
	unit := store.OrganizationUnit{ID: store.RootOrganizationUnitID, Name: "", Kind: "group"}
	child := store.OrganizationUnit{ID: uuid.NewString(), Name: "子公司", Kind: "subsidiary"}
	for _, value := range []store.OrganizationUnit{unit, child} {
		if err := db.Create(&value).Error; err != nil {
			t.Fatal(err)
		}
	}
	root := store.OrganizationDepartment{ID: uuid.NewString(), UnitID: unit.ID, Name: "", IsRoot: true}
	dept := store.OrganizationDepartment{ID: uuid.NewString(), UnitID: child.ID, Name: "研发部"}
	for _, value := range []store.OrganizationDepartment{root, dept} {
		if err := db.Create(&value).Error; err != nil {
			t.Fatal(err)
		}
	}
	one := store.User{ID: uuid.NewString(), Email: "one@example.com", Name: "One", JobTitle: "工程师", PasswordHash: "hash", Status: StatusActive}
	two := store.User{ID: uuid.NewString(), Email: "two@example.com", Name: "Two", JobTitle: "顾问", PasswordHash: "hash", Status: StatusActive}
	three := store.User{ID: uuid.NewString(), Email: "three@example.com", Name: "Three", PasswordHash: "hash", Status: StatusActive}
	for _, user := range []store.User{one, two, three} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, value := range []store.OrganizationAssignment{
		{ID: uuid.NewString(), UserID: one.ID, DepartmentID: dept.ID, IsPrimary: true},
		{ID: uuid.NewString(), UserID: one.ID, DepartmentID: root.ID, IsPrimary: false},
		{ID: uuid.NewString(), UserID: two.ID, DepartmentID: root.ID, IsPrimary: true},
	} {
		if err := db.Create(&value).Error; err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(Dependencies{DB: db})
	result, err := service.List(context.Background(), ListCommand{IncludeOrganization: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 3 || len(result.Users) != 3 {
		t.Fatalf("duplicates: %#v", result)
	}
	for _, user := range result.Users {
		switch user.ID {
		case one.ID:
			if user.Organization == nil || user.Organization.UnitName != "子公司" || user.Organization.DepartmentName != "研发部" || user.Organization.Title != "工程师" {
				t.Fatalf("primary assignment: %#v", user.Organization)
			}
		case two.ID:
			if user.Organization == nil || user.Organization.UnitName != "集团名称" || user.Organization.DepartmentName != "" {
				t.Fatalf("root assignment: %#v", user.Organization)
			}
		case three.ID:
			if user.Organization != nil {
				t.Fatalf("unassigned user: %#v", user.Organization)
			}
		}
	}
}
