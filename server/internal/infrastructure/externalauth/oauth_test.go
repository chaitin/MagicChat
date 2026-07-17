package externalauth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"app/internal/application/identityprovider"
)

func TestOIDCDoesNotUsePKCE(t *testing.T) {
	provider := identityprovider.Provider{
		Type:     identityprovider.TypeOIDC,
		ClientID: "client-id",
		Scopes:   []string{"openid"},
		Config: map[string]any{
			"authorize_url": "https://auth.example.com/oauth2/auth",
		},
	}

	authorizeURL, err := NewOAuth().BuildAuthorizeURL(
		provider,
		"login-state",
		"https://chat.example.com/api/client/auth/third-party/oidc/callback",
		"pkce-verifier",
	)
	if err != nil {
		t.Fatalf("build authorize URL: %v", err)
	}
	parsedURL, err := url.Parse(authorizeURL)
	if err != nil {
		t.Fatalf("parse authorize URL: %v", err)
	}
	if value := parsedURL.Query().Get("code_challenge"); value != "" {
		t.Fatalf("code_challenge = %q, want empty", value)
	}
	if value := parsedURL.Query().Get("code_challenge_method"); value != "" {
		t.Fatalf("code_challenge_method = %q, want empty", value)
	}
}

func TestOIDCTokenExchangeDoesNotSendCodeVerifier(t *testing.T) {
	var tokenForm url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			if err := r.ParseForm(); err != nil {
				t.Fatalf("parse token form: %v", err)
			}
			tokenForm = r.PostForm
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "access-token"})
		case "/userinfo":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"sub": "user-id", "email": "user@example.com", "name": "Example User",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := identityprovider.Provider{
		Type: identityprovider.TypeOIDC, ClientID: "client-id", ClientSecret: "client-secret",
		Config: map[string]any{
			"token_url": server.URL + "/token", "userinfo_url": server.URL + "/userinfo",
			"external_id_field": "sub", "email_field": "email", "name_field": "name",
		},
	}
	profile, err := NewOAuth().FetchProfile(
		context.Background(), provider, "authorization-code", "https://chat.example.com/callback", "pkce-verifier",
	)
	if err != nil {
		t.Fatalf("fetch profile: %v", err)
	}
	if profile.ExternalUserID != "user-id" || profile.Email != "user@example.com" {
		t.Fatalf("profile = %#v", profile)
	}
	if value := tokenForm.Get("code_verifier"); value != "" {
		t.Fatalf("code_verifier = %q, want empty", value)
	}
	if tokenForm.Get("client_secret") != "client-secret" {
		t.Fatalf("client_secret was not sent")
	}
}
