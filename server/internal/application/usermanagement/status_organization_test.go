package usermanagement

import (
	"context"
	"testing"

	"app/internal/store"
	"github.com/google/uuid"
)

func TestStatusChangeInvalidatesOrganizationAfterCommit(t *testing.T) {
	db := openUserManagementTestDB(t)
	user := store.User{ID: uuid.NewString(), Email: "status@example.test", Name: "Member", Status: StatusActive, PasswordHash: "unused"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	notifications := 0
	expectedStatus := StatusActive
	service := NewService(Dependencies{
		DB: db,
		OrganizationChanged: func() {
			notifications++
			var saved store.User
			if err := db.First(&saved, "id = ?", user.ID).Error; err != nil || saved.Status != expectedStatus {
				t.Fatalf("notification before committed status: %+v, %v", saved, err)
			}
		},
	})
	for _, status := range []string{StatusDisabled, StatusActive} {
		expectedStatus = status
		before := notifications
		if _, err := service.SetStatus(context.Background(), SetStatusCommand{UserID: user.ID, Status: status}); err != nil {
			t.Fatal(err)
		}
		if notifications != before+1 {
			t.Fatalf("status %s: notifications = %d, want %d", status, notifications, before+1)
		}
		if _, err := service.SetStatus(context.Background(), SetStatusCommand{UserID: user.ID, Status: status}); err != nil {
			t.Fatal(err)
		}
		if notifications != before+1 {
			t.Fatal("unchanged status invalidated organization")
		}
	}
	if _, err := service.SetStatus(context.Background(), SetStatusCommand{UserID: uuid.NewString(), Status: StatusDisabled}); err == nil {
		t.Fatal("missing user should fail")
	}
	if notifications != 2 {
		t.Fatal("failed status change invalidated organization")
	}
}

func TestFailedStatusTransactionDoesNotInvalidateOrganization(t *testing.T) {
	db := openUserManagementTestDB(t)
	user := store.User{ID: uuid.NewString(), Email: "rollback@example.test", Name: "Member", Status: StatusActive, PasswordHash: "unused"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	// Force a failure after the status update but before the transaction commits.
	if err := db.Migrator().DropTable(&store.UserSession{}); err != nil {
		t.Fatal(err)
	}
	notifications := 0
	service := NewService(Dependencies{DB: db, OrganizationChanged: func() { notifications++ }})
	if _, err := service.SetStatus(context.Background(), SetStatusCommand{UserID: user.ID, Status: StatusDisabled}); err == nil {
		t.Fatal("expected transaction failure")
	}
	var saved store.User
	if err := db.First(&saved, "id = ?", user.ID).Error; err != nil || saved.Status != StatusActive {
		t.Fatalf("status not rolled back: %+v, %v", saved, err)
	}
	if notifications != 0 {
		t.Fatal("rolled-back status change invalidated organization")
	}
}
