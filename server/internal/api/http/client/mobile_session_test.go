package client

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"app/internal/application/account"
	"app/internal/application/emailauth"

	"github.com/labstack/echo/v4"
)

func TestLoginMobileSessionCapabilityNegotiation(t *testing.T) {
	expiresAt := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	loginResult := account.LoginResult{
		Account: account.Account{ID: "user-1", Email: "alice@example.com", Name: "Alice", CreatedAt: expiresAt.Add(-time.Hour)},
		Session: account.SessionCredential{Token: "test-session-placeholder", ExpiresAt: expiresAt},
	}

	loginRoutes := []struct {
		name, path, body string
		register         func(*echo.Echo)
	}{
		{
			name: "password", path: "/api/client/auth/login", body: `{"email":"alice@example.com","password":"secret"}`,
			register: func(router *echo.Echo) {
				service := &mobileSessionAccountService{fakeAccountService: &fakeAccountService{loginResult: loginResult}}
				NewAccountAPI(service, service, nil).RegisterPublicRoutes(router)
			},
		},
		{
			name: "email code", path: "/api/client/auth/email-code/login", body: `{"email":"alice@example.com","code":"01234567"}`,
			register: func(router *echo.Echo) {
				NewEmailAuthAPI(&mobileSessionEmailAuthService{result: loginResult}).RegisterPublicRoutes(router)
			},
		},
	}
	capabilities := []struct {
		name, version, origin string
		wantMobile            bool
	}{
		{name: "supported native", version: MobileSessionCapabilityVersion, wantMobile: true},
		{name: "no header"},
		{name: "unknown version", version: "1"},
		{name: "browser origin", version: MobileSessionCapabilityVersion, origin: "https://app.example.com"},
	}

	for _, route := range loginRoutes {
		for _, capability := range capabilities {
			t.Run(route.name+"/"+capability.name, func(t *testing.T) {
				router := echo.New()
				route.register(router)
				request := httptest.NewRequest(http.MethodPost, route.path, bytes.NewBufferString(route.body))
				request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
				if capability.version != "" {
					request.Header.Set(MobileSessionCapabilityHeader, capability.version)
				}
				if capability.origin != "" {
					request.Header.Set("Origin", capability.origin)
				}
				recorder := httptest.NewRecorder()
				router.ServeHTTP(recorder, request)

				if recorder.Code != http.StatusOK {
					t.Fatalf("status = %d", recorder.Code)
				}
				cookies := recorder.Result().Cookies()
				if capability.wantMobile && len(cookies) != 0 {
					t.Fatal("native login unexpectedly wrote a Cookie")
				}
				if !capability.wantMobile && (len(cookies) != 1 || cookies[0].Name != UserSessionCookieName || cookies[0].Value != loginResult.Session.Token) {
					t.Fatal("compatibility session cookie was not preserved")
				}
				var response struct {
					Data struct {
						User          json.RawMessage `json:"user"`
						MobileSession *struct {
							Token        string    `json:"token"`
							RefreshToken string    `json:"refresh_token"`
							ExpiresAt    time.Time `json:"expires_at"`
						} `json:"mobile_session"`
					} `json:"data"`
				}
				if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
					t.Fatalf("decode response: %v", err)
				}
				if len(response.Data.User) == 0 {
					t.Fatal("response does not contain user")
				}
				if capability.wantMobile {
					if response.Data.MobileSession == nil || response.Data.MobileSession.Token != loginResult.Session.Token || response.Data.MobileSession.RefreshToken == "" || !response.Data.MobileSession.ExpiresAt.Equal(expiresAt) {
						t.Fatal("supported native response does not contain the created session credential")
					}
				} else {
					if response.Data.MobileSession != nil || strings.Contains(recorder.Body.String(), `"token"`) {
						t.Fatal("non-mobile login response exposed a session token field")
					}
				}
			})
		}
	}
}

type mobileSessionAccountService struct {
	*fakeAccountService
	refreshToken string
	revokedToken string
}

func (*mobileSessionAccountService) BeginNativeSession(_ context.Context, token string) (account.NativeSessionCredential, error) {
	return testNativeCredential(token), nil
}
func (*mobileSessionAccountService) ExchangeNativeSession(_ context.Context, token string) (account.NativeSessionCredential, error) {
	return testNativeCredential(token), nil
}
func (s *mobileSessionAccountService) RefreshNativeSession(_ context.Context, token string) (account.NativeSessionCredential, error) {
	s.refreshToken = token
	return testNativeCredential("rotated-access-token"), nil
}
func (s *mobileSessionAccountService) RevokeNativeSession(_ context.Context, token string) error {
	s.revokedToken = token
	return nil
}

func testNativeCredential(token string) account.NativeSessionCredential {
	return account.NativeSessionCredential{SessionCredential: account.SessionCredential{Token: token, ExpiresAt: time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)},
		RefreshToken: "refresh-placeholder", RefreshExpiresAt: time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC), RefreshAbsoluteExpiresAt: time.Date(2027, 9, 3, 0, 0, 0, 0, time.UTC)}
}

type mobileSessionEmailAuthService struct {
	result account.LoginResult
}

func (s *mobileSessionEmailAuthService) RequestCode(context.Context, emailauth.RequestCodeCommand) (emailauth.RequestCodeResult, error) {
	return emailauth.RequestCodeResult{}, nil
}

func (s *mobileSessionEmailAuthService) Login(context.Context, emailauth.LoginCommand) (account.LoginResult, error) {
	return s.result, nil
}
func (*mobileSessionEmailAuthService) BeginNativeSession(_ context.Context, token string) (account.NativeSessionCredential, error) {
	return testNativeCredential(token), nil
}
