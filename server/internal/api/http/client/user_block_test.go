package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"app/internal/application/account"
	userblockapp "app/internal/application/userblock"

	"github.com/labstack/echo/v4"
)

func TestUserBlockAPIUsesCurrentAccount(t *testing.T) {
	now := time.Date(2026, 9, 7, 8, 0, 0, 0, time.UTC)
	service := &fakeUserBlockService{status: userblockapp.Status{
		Blocked: true, BlockedAt: &now, UserID: "target-1",
	}}
	router := echo.New()
	group := router.Group("/api/client", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set(currentAccountKey, account.Account{ID: "current-1"})
			return next(c)
		}
	})
	NewUserBlockAPI(service).RegisterRoutes(group)

	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
		request := httptest.NewRequest(method, "/api/client/blocked-users/target-1", nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("method %s status = %d, body = %s", method, response.Code, response.Body.String())
		}
		if service.command.AccountID != "current-1" || service.command.UserID != "target-1" {
			t.Fatalf("method %s command = %#v", method, service.command)
		}
	}
}

type fakeUserBlockService struct {
	command userblockapp.Command
	status  userblockapp.Status
	err     error
}

func (f *fakeUserBlockService) Block(_ context.Context, command userblockapp.Command) (userblockapp.Status, error) {
	f.command = command
	return f.status, f.err
}

func (f *fakeUserBlockService) GetStatus(_ context.Context, command userblockapp.Command) (userblockapp.Status, error) {
	f.command = command
	return f.status, f.err
}

func (f *fakeUserBlockService) Unblock(_ context.Context, command userblockapp.Command) error {
	f.command = command
	return f.err
}
