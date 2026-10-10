package client

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"app/internal/application/account"

	"github.com/labstack/echo/v4"
)

func TestNativeSessionEndpointsRejectBrowserAndLegacyCredentials(t *testing.T) {
	service := &mobileSessionAccountService{fakeAccountService: &fakeAccountService{authenticated: account.AuthenticatedSession{Account: account.Account{ID: "user-1"}}}}
	router := echo.New()
	NewAccountAPI(service, service, nil).RegisterPublicRoutes(router)

	for _, route := range []struct {
		path, body string
	}{
		{"/api/client/auth/native/refresh", `{"refresh_token":"refresh-token"}`},
		{"/api/client/auth/native/revoke", `{"refresh_token":"refresh-token"}`},
		{"/api/client/auth/native/exchange", `{}`},
	} {
		for _, state := range []struct {
			header, origin string
			wantStatus     int
		}{
			{"", "", http.StatusUnauthorized},
			{"1", "", http.StatusUnauthorized},
			{MobileSessionCapabilityVersion, "https://web.example.test", http.StatusUnauthorized},
			{MobileSessionCapabilityVersion, "", http.StatusOK},
		} {
			req := httptest.NewRequest(http.MethodPost, route.path, bytes.NewBufferString(route.body))
			req.Header.Set("Content-Type", "application/json")
			if state.header != "" {
				req.Header.Set(MobileSessionCapabilityHeader, state.header)
			}
			if state.origin != "" {
				req.Header.Set("Origin", state.origin)
			}
			if route.path == "/api/client/auth/native/exchange" {
				req.Header.Set("Authorization", "Bearer temporary-oauth-token")
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, req)
			if response.Code != state.wantStatus {
				t.Fatalf("%s/%q/%q: status=%d body=%s", route.path, state.header, state.origin, response.Code, response.Body.String())
			}
			if len(response.Result().Cookies()) != 0 {
				t.Fatalf("%s wrote Cookie", route.path)
			}
		}
	}
	if service.refreshToken != "refresh-token" || service.revokedToken != "refresh-token" {
		t.Fatalf("refresh and revoke not called: %+v", service)
	}
}
