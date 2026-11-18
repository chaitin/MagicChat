package usermanagement

import (
	"app/internal/store"
	"context"
	"github.com/google/uuid"
	"testing"
)

func TestListUserIDsFilter(t *testing.T) {
	db := openUserManagementTestDB(t)
	a, b := uuid.NewString(), uuid.NewString()
	for _, id := range []string{a, b} {
		if err := db.Create(&store.User{ID: id, Email: id + "@example.test", Name: "Member", Status: store.UserStatusDisabled, PasswordHash: "hash"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(Dependencies{DB: db})
	result, err := service.List(context.Background(), ListCommand{UserIDs: a + "," + a, PageSize: "100"})
	if err != nil || result.Total != 1 || len(result.Users) != 1 || result.Users[0].ID != a {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	result, err = service.List(context.Background(), ListCommand{UserIDs: uuid.NewString()})
	if err != nil || result.Total != 0 {
		t.Fatalf("unknown ID escaped filter: %+v %v", result, err)
	}
	if _, err = service.List(context.Background(), ListCommand{UserIDs: "invalid"}); err == nil {
		t.Fatal("invalid ID accepted")
	}
}
