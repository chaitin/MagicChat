package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"app/internal/application/account"
	"app/internal/application/mobilepush"

	"github.com/labstack/echo/v4"
)

type fakePushService struct {
	register             mobilepush.RegisterGrantCommand
	presence             mobilepush.PresenceCommand
	preferencesUser      string
	statusUser           string
	statusSession        string
	revokeUserID         string
	revokeInstallationID string
	revokeGrantID        string
	routeUserID          string
	routeToken           string
	err                  error
}

func (s *fakePushService) RegisterGrant(_ context.Context, cmd mobilepush.RegisterGrantCommand) (mobilepush.Grant, error) {
	s.register = cmd
	if s.err != nil {
		return mobilepush.Grant{}, s.err
	}
	return mobilepush.Grant{
		InstallationID: cmd.InstallationID, GatewayGrantID: cmd.GatewayGrantID,
		Platform: cmd.Platform, ExpiresAt: cmd.ExpiresAt,
	}, nil
}

func (s *fakePushService) RevokeGrant(_ context.Context, userID, installationID, grantID string) error {
	s.revokeUserID, s.revokeInstallationID, s.revokeGrantID = userID, installationID, grantID
	return s.err
}

func (s *fakePushService) ResolveRoute(_ context.Context, userID, token string) (mobilepush.Route, error) {
	s.routeUserID, s.routeToken = userID, token
	if s.err != nil {
		return mobilepush.Route{}, s.err
	}
	return mobilepush.Route{ConversationID: "conversation-1", MessageID: "message-1"}, nil
}

func (s *fakePushService) ReportPresence(_ context.Context, cmd mobilepush.PresenceCommand) error {
	s.presence = cmd
	return s.err
}
func (s *fakePushService) GetPreferences(_ context.Context, userID string) (mobilepush.PushPreferences, error) {
	s.preferencesUser = userID
	return mobilepush.PushPreferences{}, s.err
}
func (s *fakePushService) SetPreferences(_ context.Context, userID string, value mobilepush.PushPreferences) (mobilepush.PushPreferences, error) {
	s.preferencesUser = userID
	return value, s.err
}
func (s *fakePushService) GetStatus(_ context.Context, userID, sessionID string) (mobilepush.PushStatus, error) {
	s.statusUser, s.statusSession = userID, sessionID
	return mobilepush.PushStatus{DelaySeconds: 5}, s.err
}

func TestPushPolicyAPIBindsAuthenticatedSessionAndRejectsSpoofedFields(t *testing.T) {
	service := &fakePushService{}
	router := pushTestRouter(service)
	response := servePushRequest(router, http.MethodPut, "/api/client/push/presence", `{"platform":"ios","foreground":true}`)
	if response.Code != http.StatusOK || service.presence.UserID != "user-1" || service.presence.SessionID != "00000000-0000-0000-0000-000000000010" || !service.presence.Foreground {
		t.Fatalf("presence=%#v response=%d", service.presence, response.Code)
	}
	for _, body := range []string{`{}`, `{"platform":"ios"}`, `{"platform":"ios","foreground":true,"session_id":"other"}`, `{"platform":"desktop","foreground":true,"user_id":"other"}`} {
		if result := servePushRequest(router, http.MethodPut, "/api/client/push/presence", body); result.Code != http.StatusBadRequest {
			t.Fatalf("accepted spoofed/incomplete body: %s", body)
		}
	}
	response = servePushRequest(router, http.MethodPut, "/api/client/push/preferences", `{"pause_when_desktop_active":true}`)
	if response.Code != http.StatusOK || service.preferencesUser != "user-1" || !strings.Contains(response.Body.String(), `"pause_when_desktop_active":true`) {
		t.Fatalf("preferences=%d %s", response.Code, response.Body.String())
	}
	response = servePushRequest(router, http.MethodGet, "/api/client/push/status", "")
	if response.Code != http.StatusOK || service.statusUser != "user-1" || service.statusSession != "00000000-0000-0000-0000-000000000010" || !strings.Contains(response.Body.String(), `"delay_seconds":5`) {
		t.Fatalf("status=%d %s", response.Code, response.Body.String())
	}
	unauthenticated := echo.New()
	NewPushAPI(service).RegisterRoutes(unauthenticated.Group("/api/client"))
	for _, path := range []string{"/api/client/push/status", "/api/client/push/preferences"} {
		if result := servePushRequest(unauthenticated, http.MethodGet, path, ""); result.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated read accepted: %s", path)
		}
	}
}

func TestPushAPIRoutesAuthenticatedUser(t *testing.T) {
	service := &fakePushService{}
	router := pushTestRouter(service)
	expiresAt := time.Date(2026, 9, 21, 9, 0, 0, 0, time.UTC)
	register := servePushRequest(router, http.MethodPut, "/api/client/push/grants", `{
		"installation_id":"00000000-0000-0000-0000-000000000001",
		"grant_id":"00000000-0000-0000-0000-000000000002",
		"send_token":"abcdefghijklmnopqrstuvwxyz1234567890",
		"platform":"ios",
		"expires_at":"2026-09-21T09:00:00Z"
	}`)
	if register.Code != http.StatusOK || service.register.UserID != "user-1" || service.register.SessionID != "00000000-0000-0000-0000-000000000010" || !service.register.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("register = %d/%s, command = %#v", register.Code, register.Body.String(), service.register)
	}
	revoke := servePushRequest(router, http.MethodPost, "/api/client/push/grants/00000000-0000-0000-0000-000000000001/revoke", `{
		"grant_id":"00000000-0000-0000-0000-000000000002"
	}`)
	if revoke.Code != http.StatusNoContent || service.revokeUserID != "user-1" || service.revokeGrantID != "00000000-0000-0000-0000-000000000002" {
		t.Fatalf("revoke = %d, service = %#v", revoke.Code, service)
	}
	resolve := servePushRequest(router, http.MethodPost, "/api/client/push/routes/resolve", `{
		"route_token":"route-token-abcdefghijklmnopqrstuvwxyz"
	}`)
	if resolve.Code != http.StatusOK || service.routeUserID != "user-1" || !strings.Contains(resolve.Body.String(), "conversation-1") {
		t.Fatalf("resolve = %d/%s, service = %#v", resolve.Code, resolve.Body.String(), service)
	}
}

func TestPushAPIStrictJSONAndErrors(t *testing.T) {
	service := &fakePushService{}
	router := pushTestRouter(service)
	invalid := servePushRequest(router, http.MethodPut, "/api/client/push/grants", `{"unknown":true}`)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid status = %d, body = %s", invalid.Code, invalid.Body.String())
	}
	service.err = &mobilepush.Error{Code: "push_disabled", Message: "disabled"}
	disabled := servePushRequest(router, http.MethodPut, "/api/client/push/grants", `{
		"installation_id":"00000000-0000-0000-0000-000000000001",
		"grant_id":"00000000-0000-0000-0000-000000000002",
		"send_token":"abcdefghijklmnopqrstuvwxyz1234567890",
		"platform":"ios",
		"expires_at":"2026-09-21T09:00:00Z"
	}`)
	if disabled.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled status = %d, body = %s", disabled.Code, disabled.Body.String())
	}
	service.err = &mobilepush.Error{Code: "grant_limit_reached", Message: "limit"}
	limited := servePushRequest(router, http.MethodPut, "/api/client/push/grants", `{
		"installation_id":"00000000-0000-0000-0000-000000000001",
		"grant_id":"00000000-0000-0000-0000-000000000002",
		"send_token":"abcdefghijklmnopqrstuvwxyz1234567890",
		"platform":"ios",
		"expires_at":"2026-09-21T09:00:00Z"
	}`)
	if limited.Code != http.StatusTooManyRequests {
		t.Fatalf("limited status = %d, body = %s", limited.Code, limited.Body.String())
	}
}

func pushTestRouter(service mobilepush.ClientService) *echo.Echo {
	router := echo.New()
	group := router.Group("/api/client", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set(currentAccountKey, account.Account{ID: "user-1"})
			c.Set(currentSessionKey, account.AuthenticatedSession{
				ID:      "00000000-0000-0000-0000-000000000010",
				Account: account.Account{ID: "user-1"},
			})
			return next(c)
		}
	})
	NewPushAPI(service).RegisterRoutes(group)
	return router
}

func servePushRequest(router http.Handler, method, path, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}
