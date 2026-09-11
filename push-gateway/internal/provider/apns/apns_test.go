package apns

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"push-gateway/internal/provider"
)

func TestSendBuildsAPNsRequest(t *testing.T) {
	var captured *http.Request
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		captured = request.Clone(request.Context())
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("decode payload: %v", err)
		}
		response.Header().Set("apns-id", "apns-message-1")
		response.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	pushProvider := newTestProvider(t, server.URL)
	expiresAt := time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC)
	receipt, err := pushProvider.Send(t.Context(), provider.Notification{
		ID:    "4f8f9f84-1302-4c40-af80-5d37bb7f3f6c",
		Token: strings.Repeat("ab", 32), Platform: "ios", Environment: "production",
		Title: "即应", Body: "你收到一条新消息", Event: "message.created",
		GrantID: "grant-1", RouteToken: "route-1", CollapseKey: "conversation-1", ExpiresAt: expiresAt,
	})
	if err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	if receipt.MessageID != "apns-message-1" {
		t.Fatalf("receipt = %#v", receipt)
	}
	if captured == nil || captured.URL.Path != "/3/device/"+strings.Repeat("ab", 32) {
		t.Fatalf("request = %#v", captured)
	}
	if captured.Header.Get("apns-id") != "4f8f9f84-1302-4c40-af80-5d37bb7f3f6c" {
		t.Fatalf("apns-id = %q", captured.Header.Get("apns-id"))
	}
	if !strings.HasPrefix(captured.Header.Get("Authorization"), "bearer ") || captured.Header.Get("apns-topic") != "cloud.baizhi.chat" {
		t.Fatalf("APNs headers = %#v", captured.Header)
	}
	if captured.Header.Get("apns-collapse-id") != "conversation-1" || captured.Header.Get("apns-expiration") != "1787306400" {
		t.Fatalf("delivery headers = %#v", captured.Header)
	}
	if payload["event"] != "message.created" || payload["grant_id"] != "grant-1" || payload["route_token"] != "route-1" {
		t.Fatalf("payload = %#v", payload)
	}
	if _, exists := payload["conversation_id"]; exists {
		t.Fatalf("payload leaks conversation ID: %#v", payload)
	}
}

func TestSendClassifiesAPNsFailures(t *testing.T) {
	tests := []struct {
		name   string
		status int
		reason string
		kind   provider.ErrorKind
	}{
		{name: "unregistered", status: http.StatusGone, reason: "Unregistered", kind: provider.ErrorInvalidDevice},
		{name: "expired provider token", status: http.StatusForbidden, reason: "ExpiredProviderToken", kind: provider.ErrorTransient},
		{name: "busy", status: http.StatusServiceUnavailable, reason: "ServiceUnavailable", kind: provider.ErrorTransient},
		{name: "forbidden", status: http.StatusForbidden, reason: "InvalidProviderToken", kind: provider.ErrorPermanent},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.WriteHeader(test.status)
				_ = json.NewEncoder(response).Encode(map[string]string{"reason": test.reason})
			}))
			defer server.Close()
			pushProvider := newTestProvider(t, server.URL)
			_, err := pushProvider.Send(t.Context(), provider.Notification{
				Token: strings.Repeat("cd", 32), Platform: "ios", Environment: "production",
			})
			var sendErr *provider.SendError
			if !errors.As(err, &sendErr) || sendErr.Kind != test.kind {
				t.Fatalf("Send() error = %#v, want kind %q", err, test.kind)
			}
			if test.reason == "ExpiredProviderToken" && pushProvider.cachedJWT != "" {
				t.Fatal("expired APNs JWT remained cached")
			}
		})
	}
}

func TestValidateRegistrationRequiresExactDeviceTokenLength(t *testing.T) {
	pushProvider := newTestProvider(t, "https://example.test")
	registration := provider.Registration{Platform: "ios", Environment: "production"}
	registration.Token = strings.Repeat("ab", 32)
	if err := pushProvider.ValidateRegistration(registration); err != nil {
		t.Fatalf("valid device token was rejected: %v", err)
	}
	for _, token := range []string{
		"not-hex",
		strings.Repeat("ab", 31),
		strings.Repeat("ab", 33),
		strings.Repeat("ab", 2048),
	} {
		registration.Token = token
		if err := pushProvider.ValidateRegistration(registration); err == nil {
			t.Fatalf("invalid device token of length %d was accepted", len(token))
		}
	}
}

func TestSendRejectsMalformedDeviceToken(t *testing.T) {
	pushProvider := newTestProvider(t, "https://example.test")
	_, err := pushProvider.Send(t.Context(), provider.Notification{
		Token: "not-hex", Platform: "ios", Environment: "production",
	})
	var sendErr *provider.SendError
	if !errors.As(err, &sendErr) || sendErr.Kind != provider.ErrorInvalidDevice {
		t.Fatalf("Send() error = %#v", err)
	}
}

func newTestProvider(t *testing.T, endpoint string) *Provider {
	t.Helper()
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	content := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded})
	result, err := New(Config{
		KeyID: "KEY123", TeamID: "TEAM123", BundleID: "cloud.baizhi.chat",
		PrivateKeyPEM: content, ProductionEndpoint: endpoint, DevelopmentEndpoint: endpoint,
		Now: func() time.Time { return time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	return result
}
