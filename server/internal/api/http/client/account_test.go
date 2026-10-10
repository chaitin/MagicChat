package client

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"app/internal/application/account"

	"github.com/labstack/echo/v4"
)

func TestAccountAPILoginMapsTransportDataAndSetsCookie(t *testing.T) {
	now := time.Date(2026, 7, 15, 4, 0, 0, 0, time.UTC)
	service := &fakeAccountService{
		loginResult: account.LoginResult{
			Account: account.Account{ID: "account-1", Email: "alice@example.com", Name: "Alice", Status: account.StatusActive, CreatedAt: now},
			Session: account.SessionCredential{Token: "session-token", ExpiresAt: now.Add(time.Hour)},
		},
	}
	api := NewAccountAPI(service, service, nil)
	router := echo.New()
	api.RegisterPublicRoutes(router)
	body := bytes.NewBufferString(`{"email":"alice@example.com","password":"secret"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/client/auth/login", body)
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	request.Header.Set("User-Agent", "account-api-test")
	request.RemoteAddr = "127.0.0.1:12345"
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if service.loginCommand.Email != "alice@example.com" || service.loginCommand.UserAgent != "account-api-test" || service.loginCommand.IP != "127.0.0.1" {
		t.Fatalf("login command = %#v", service.loginCommand)
	}
	response := recorder.Result()
	cookies := response.Cookies()
	if len(cookies) != 1 || cookies[0].Name != UserSessionCookieName || cookies[0].Value != "session-token" || !cookies[0].HttpOnly {
		t.Fatalf("cookies = %#v", cookies)
	}
}

func TestSessionCookieUsesSecureFlagForHTTPSAndForwardedHTTPS(t *testing.T) {
	for _, configure := range []func(*http.Request){
		func(request *http.Request) { request.TLS = &tls.ConnectionState{} },
		func(request *http.Request) { request.Header.Set("X-Forwarded-Proto", "https") },
	} {
		request := httptest.NewRequest(http.MethodGet, "/", nil)
		configure(request)
		recorder := httptest.NewRecorder()
		context := echo.New().NewContext(request, recorder)
		setSessionCookie(context, "fixture-session", time.Now().Add(time.Hour))
		cookies := recorder.Result().Cookies()
		if len(cookies) != 1 || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteLaxMode {
			t.Fatalf("secure cookie flags missing")
		}
	}
}

func TestAccountAPIReturnsUnavailableForDisabledPasswordLogin(t *testing.T) {
	service := &fakeAccountService{loginErr: &account.Error{
		Code: account.CodeLoginUnavailable, Message: "密码登录未启用",
	}}
	api := NewAccountAPI(service, service, nil)
	router := echo.New()
	api.RegisterPublicRoutes(router)
	request := httptest.NewRequest(http.MethodPost, "/api/client/auth/login", bytes.NewBufferString(
		`{"email":"alice@example.com","password":"secret"}`,
	))
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestAccountAPISessionCredentialPrecedence(t *testing.T) {
	tests := []struct {
		name, authorization, cookie, wantToken string
		wantStatus                             int
	}{
		{name: "bearer only", authorization: "Bearer bearer-token", wantToken: "bearer-token", wantStatus: http.StatusOK},
		{name: "cookie only", cookie: "cookie-token", wantToken: "cookie-token", wantStatus: http.StatusOK},
		{name: "same", authorization: "Bearer shared-token", cookie: "shared-token", wantToken: "shared-token", wantStatus: http.StatusOK},
		{name: "conflict prefers bearer", authorization: "Bearer bearer-token", cookie: "cookie-token", wantToken: "bearer-token", wantStatus: http.StatusOK},
		{name: "invalid bearer does not use cookie", authorization: "Bearer invalid-token", cookie: "cookie-token", wantToken: "invalid-token", wantStatus: http.StatusUnauthorized},
		{name: "wrong scheme", authorization: "Basic placeholder", cookie: "cookie-token", wantStatus: http.StatusUnauthorized},
		{name: "missing token", authorization: "Bearer ", cookie: "cookie-token", wantStatus: http.StatusUnauthorized},
		{name: "multiple credentials", authorization: "Bearer first, Bearer second", cookie: "cookie-token", wantStatus: http.StatusUnauthorized},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &fakeAccountService{authenticated: account.AuthenticatedSession{Account: account.Account{ID: "account-1"}}, invalidToken: "invalid-token"}
			api := NewAccountAPI(service, service, nil)
			router := echo.New()
			router.GET("/api/client/protected", func(c echo.Context) error { return c.NoContent(http.StatusOK) }, api.RequireSession)
			request := httptest.NewRequest(http.MethodGet, "/api/client/protected", nil)
			if test.authorization != "" {
				request.Header.Set("Authorization", test.authorization)
			}
			if test.cookie != "" {
				request.AddCookie(&http.Cookie{Name: UserSessionCookieName, Value: test.cookie})
			}
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			if recorder.Code != test.wantStatus || service.authToken != test.wantToken {
				t.Fatalf("status = %d, authenticated expected credential = %t", recorder.Code, service.authToken == test.wantToken)
			}
		})
	}
}

func TestAccountAPILogoutUsesExactCredential(t *testing.T) {
	service := &fakeAccountService{authenticated: account.AuthenticatedSession{Account: account.Account{ID: "account-1"}}}
	api := NewAccountAPI(service, service, nil)
	router := echo.New()
	api.RegisterPublicRoutes(router)
	request := httptest.NewRequest(http.MethodPost, "/api/client/auth/logout", nil)
	request.Header.Set("Authorization", "Bearer selected-token")
	request.AddCookie(&http.Cookie{Name: UserSessionCookieName, Value: "other-token"})
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || service.logoutToken != "selected-token" {
		t.Fatalf("status = %d, revoked selected credential = %t", recorder.Code, service.logoutToken == "selected-token")
	}
	if len(recorder.Result().Cookies()) != 0 {
		t.Fatal("bearer logout unexpectedly wrote a Cookie")
	}

	anonymous := httptest.NewRequest(http.MethodPost, "/api/client/auth/logout", nil)
	anonymousRecorder := httptest.NewRecorder()
	router.ServeHTTP(anonymousRecorder, anonymous)
	if anonymousRecorder.Code != http.StatusOK {
		t.Fatalf("anonymous logout status = %d", anonymousRecorder.Code)
	}

	service.invalidToken = "expired-cookie-placeholder"
	expiredCookie := httptest.NewRequest(http.MethodPost, "/api/client/auth/logout", nil)
	expiredCookie.AddCookie(&http.Cookie{
		Name:  UserSessionCookieName,
		Value: "expired-cookie-placeholder",
	})
	expiredCookieRecorder := httptest.NewRecorder()
	router.ServeHTTP(expiredCookieRecorder, expiredCookie)
	if expiredCookieRecorder.Code != http.StatusOK || service.logoutToken != "expired-cookie-placeholder" {
		t.Fatalf("expired cookie logout status = %d", expiredCookieRecorder.Code)
	}
	if len(expiredCookieRecorder.Result().Cookies()) == 0 || expiredCookieRecorder.Result().Cookies()[0].Value != "" {
		t.Fatal("expired cookie logout did not clear compatibility cookie")
	}

	service.logoutToken = ""
	invalidBearer := httptest.NewRequest(http.MethodPost, "/api/client/auth/logout", nil)
	invalidBearer.Header.Set("Authorization", "Bearer invalid-bearer-placeholder")
	invalidBearer.AddCookie(&http.Cookie{Name: UserSessionCookieName, Value: "valid-cookie-placeholder"})
	service.invalidToken = "invalid-bearer-placeholder"
	invalidBearerRecorder := httptest.NewRecorder()
	router.ServeHTTP(invalidBearerRecorder, invalidBearer)
	if invalidBearerRecorder.Code != http.StatusUnauthorized || service.logoutToken != "invalid-bearer-placeholder" {
		t.Fatalf("invalid bearer logout status = %d", invalidBearerRecorder.Code)
	}
}

func TestAccountAPIProtectedRoutesUseSessionAuthenticator(t *testing.T) {
	now := time.Date(2026, 7, 15, 4, 0, 0, 0, time.UTC)
	service := &fakeAccountService{
		authenticated: account.AuthenticatedSession{
			ID: "session-1",
			Account: account.Account{
				ID:        "account-1",
				Email:     "alice@example.com",
				Name:      "Alice",
				Status:    account.StatusActive,
				CreatedAt: now,
			},
		},
	}
	hookCalled := false
	api := NewAccountAPI(service, service, func(_ echo.Context, session account.AuthenticatedSession) {
		hookCalled = session.ID == "session-1"
	})
	router := echo.New()
	group := router.Group("/api/client", api.RequireSession)
	api.RegisterProtectedRoutes(group)
	request := httptest.NewRequest(http.MethodGet, "/api/client/me", nil)
	request.AddCookie(&http.Cookie{Name: UserSessionCookieName, Value: "session-token"})
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || service.authToken != "session-token" || !hookCalled {
		t.Fatalf("status = %d, token = %q, hook = %t, body = %s", recorder.Code, service.authToken, hookCalled, recorder.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	data := payload["data"].(map[string]any)
	user := data["user"].(map[string]any)
	if user["id"] != "account-1" || user["email"] != "alice@example.com" {
		t.Fatalf("user response = %#v", user)
	}
}

type fakeAccountService struct {
	loginCommand  account.LoginCommand
	loginResult   account.LoginResult
	loginErr      error
	authToken     string
	logoutToken   string
	invalidToken  string
	authenticated account.AuthenticatedSession
}

func (s *fakeAccountService) Login(_ context.Context, cmd account.LoginCommand) (account.LoginResult, error) {
	s.loginCommand = cmd
	return s.loginResult, s.loginErr
}

func (s *fakeAccountService) Logout(_ context.Context, cmd account.LogoutCommand) error {
	s.logoutToken = cmd.Token
	if cmd.RequireExisting && cmd.Token == s.invalidToken && cmd.Token != "" {
		return &account.Error{Code: account.CodeUnauthorized, Message: "未登录"}
	}
	return nil
}

func (s *fakeAccountService) GetProfile(context.Context, string) (account.Account, error) {
	return s.authenticated.Account, nil
}

func (s *fakeAccountService) UpdateProfile(_ context.Context, cmd account.UpdateProfileCommand) (account.Account, error) {
	return s.authenticated.Account, nil
}

func (s *fakeAccountService) UploadAvatar(_ context.Context, cmd account.UploadAvatarCommand) (account.Account, error) {
	return s.authenticated.Account, nil
}

func (s *fakeAccountService) AuthenticateSession(_ context.Context, token string) (account.AuthenticatedSession, error) {
	s.authToken = token
	if token == s.invalidToken && token != "" {
		return account.AuthenticatedSession{}, &account.Error{Code: account.CodeUnauthorized, Message: "未登录"}
	}
	return s.authenticated, nil
}
