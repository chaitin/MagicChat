package client

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"app/internal/application/account"
	appapp "app/internal/application/app"

	"github.com/labstack/echo/v4"
)

func TestAppAPIMapsOwnedApplicationManagementAndOnlyReturnsStoredSecretFromOwnedDetail(t *testing.T) {
	now := time.Date(2026, 7, 16, 10, 0, 0, 0, time.UTC)
	service := &fakeClientAppService{value: appapp.App{
		ID: "app-1", Name: "分析应用", Description: "分析消息", Enabled: true,
		Visibility: appapp.VisibilityRestricted, GrantedUserIDs: []string{"user-2"},
		ConnectionSecret: "stored-secret-must-not-leak", CreatedAt: now, UpdatedAt: now,
	}}
	router := echo.New()
	group := router.Group("/api/client", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set(currentAccountKey, account.Account{ID: "owner-1"})
			return next(c)
		}
	})
	NewAppAPI(service).RegisterRoutes(group)

	create := serveClientAppRequest(router, http.MethodPost, "/api/client/apps", `{
		"name":"分析应用","description":"分析消息","visibility":"restricted","user_ids":["user-2"]
	}`)
	if create.Code != http.StatusCreated || service.create.AccountID != "owner-1" ||
		service.create.Visibility != appapp.VisibilityRestricted || len(service.create.UserIDs) != 1 {
		t.Fatalf("create status = %d, command = %#v, body = %s", create.Code, service.create, create.Body.String())
	}
	if !strings.Contains(create.Body.String(), `"connection_secret":"stored-secret-must-not-leak"`) {
		t.Fatalf("create credential response = %s", create.Body.String())
	}

	list := serveClientAppRequest(router, http.MethodGet, "/api/client/apps", "")
	if list.Code != http.StatusOK || service.listAccountID != "owner-1" {
		t.Fatalf("list status = %d, account = %q, body = %s", list.Code, service.listAccountID, list.Body.String())
	}
	if strings.Contains(list.Body.String(), "stored-secret-must-not-leak") || strings.Contains(list.Body.String(), "connection_secret") {
		t.Fatalf("list leaked secret: %s", list.Body.String())
	}

	get := serveClientAppRequest(router, http.MethodGet, "/api/client/apps/app-1", "")
	if get.Code != http.StatusOK || service.get != (appapp.OwnedAppCommand{AccountID: "owner-1", AppID: "app-1"}) {
		t.Fatalf("get status = %d, command = %#v, body = %s", get.Code, service.get, get.Body.String())
	}
	if !strings.Contains(get.Body.String(), `"connection_secret":"stored-secret-must-not-leak"`) {
		t.Fatalf("get credential response = %s", get.Body.String())
	}

	update := serveClientAppRequest(router, http.MethodPatch, "/api/client/apps/app-1", `{
		"name":"新名称","visibility":"public","user_ids":[]
	}`)
	if update.Code != http.StatusOK || service.update.AccountID != "owner-1" || service.update.AppID != "app-1" ||
		service.update.Name == nil || *service.update.Name != "新名称" || service.update.Visibility == nil || *service.update.Visibility != "public" {
		t.Fatalf("update status = %d, command = %#v, body = %s", update.Code, service.update, update.Body.String())
	}

	disable := serveClientAppRequest(router, http.MethodPost, "/api/client/apps/app-1/disable", "{}")
	if disable.Code != http.StatusOK || service.enabled.Enabled || service.enabled.AccountID != "owner-1" {
		t.Fatalf("disable status = %d, command = %#v", disable.Code, service.enabled)
	}
	enable := serveClientAppRequest(router, http.MethodPost, "/api/client/apps/app-1/enable", "{}")
	if enable.Code != http.StatusOK || !service.enabled.Enabled {
		t.Fatalf("enable status = %d, command = %#v", enable.Code, service.enabled)
	}

	regenerated := serveClientAppRequest(router, http.MethodPost, "/api/client/apps/app-1/secret/regenerate", "{}")
	if regenerated.Code != http.StatusOK || service.regenerate.AccountID != "owner-1" ||
		!strings.Contains(regenerated.Body.String(), `"connection_secret":"stored-secret-must-not-leak"`) {
		t.Fatalf("regenerate status = %d, command = %#v, body = %s", regenerated.Code, service.regenerate, regenerated.Body.String())
	}

	deleted := serveClientAppRequest(router, http.MethodDelete, "/api/client/apps/app-1", "")
	if deleted.Code != http.StatusOK || service.deleted.AccountID != "owner-1" || service.deleted.AppID != "app-1" {
		t.Fatalf("delete status = %d, command = %#v, body = %s", deleted.Code, service.deleted, deleted.Body.String())
	}
}

func TestAppAPIRejectsUnknownJSONFields(t *testing.T) {
	router := echo.New()
	group := router.Group("/api/client", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set(currentAccountKey, account.Account{ID: "owner-1"})
			return next(c)
		}
	})
	NewAppAPI(&fakeClientAppService{}).RegisterRoutes(group)
	recorder := serveClientAppRequest(router, http.MethodPost, "/api/client/apps", `{"name":"应用","unknown":true}`)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestAppAPIRejectsOversizedJSONBodies(t *testing.T) {
	router := echo.New()
	group := router.Group("/api/client", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set(currentAccountKey, account.Account{ID: "owner-1"})
			return next(c)
		}
	})
	NewAppAPI(&fakeClientAppService{}).RegisterRoutes(group)
	oversized := `{"name":"` + strings.Repeat("a", maxClientAppJSONRequestBytes) + `"}`
	for _, test := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/api/client/apps"},
		{method: http.MethodPatch, path: "/api/client/apps/app-1"},
	} {
		recorder := serveClientAppRequest(router, test.method, test.path, oversized)
		if recorder.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("%s %s status = %d, body = %s", test.method, test.path, recorder.Code, recorder.Body.String())
		}
	}
}

func serveClientAppRequest(router *echo.Echo, method string, path string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if body != "" {
		request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

type fakeClientAppService struct {
	value         appapp.App
	listAccountID string
	create        appapp.CreateOwnedCommand
	get           appapp.OwnedAppCommand
	update        appapp.UpdateOwnedCommand
	enabled       appapp.SetOwnedEnabledCommand
	regenerate    appapp.OwnedAppCommand
	deleted       appapp.OwnedAppCommand
}

func (s *fakeClientAppService) ListOwned(_ context.Context, accountID string) ([]appapp.App, error) {
	s.listAccountID = accountID
	return []appapp.App{s.value}, nil
}

func (s *fakeClientAppService) GetOwned(_ context.Context, cmd appapp.OwnedAppCommand) (appapp.App, error) {
	s.get = cmd
	return s.value, nil
}

func (s *fakeClientAppService) CreateOwned(_ context.Context, cmd appapp.CreateOwnedCommand) (appapp.App, error) {
	s.create = cmd
	return s.value, nil
}

func (s *fakeClientAppService) UpdateOwned(_ context.Context, cmd appapp.UpdateOwnedCommand) (appapp.App, error) {
	s.update = cmd
	return s.value, nil
}

func (s *fakeClientAppService) SetOwnedEnabled(_ context.Context, cmd appapp.SetOwnedEnabledCommand) (appapp.App, error) {
	s.enabled = cmd
	return s.value, nil
}

func (s *fakeClientAppService) RegenerateOwnedSecret(_ context.Context, cmd appapp.OwnedAppCommand) (appapp.App, error) {
	s.regenerate = cmd
	return s.value, nil
}

func (s *fakeClientAppService) DeleteOwned(_ context.Context, cmd appapp.OwnedAppCommand) error {
	s.deleted = cmd
	return nil
}

func (s *fakeClientAppService) UploadOwnedAvatar(_ context.Context, _ appapp.UploadOwnedAvatarCommand) (appapp.App, error) {
	return s.value, nil
}
