package mobilepush

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGatewayClientSendsCapabilityRequest(t *testing.T) {
	var capturedAuthorization, capturedIdempotency, capturedServerKey string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/grants/grant-1/notifications" {
			t.Errorf("path = %q", request.URL.Path)
		}
		capturedAuthorization = request.Header.Get("Authorization")
		capturedIdempotency = request.Header.Get("Idempotency-Key")
		capturedServerKey = request.Header.Get("X-MagicChat-Server-Key")
		response.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()
	client := NewGatewayClientWithEndpointAndServerKey(server.URL, "server-secret", server.Client())
	if err := client.Send(t.Context(), "grant-1", "send-secret", "job-1", NotificationRequest{
		Event: "message.created", RouteToken: "route-token", TTLSeconds: 300,
	}); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	if capturedAuthorization != "Bearer send-secret" || capturedIdempotency != "job-1" || capturedServerKey != "server-secret" {
		t.Fatalf("headers = authorization:%q idempotency:%q server-key:%q", capturedAuthorization, capturedIdempotency, capturedServerKey)
	}
}

func TestGatewayClientClassifiesResponses(t *testing.T) {
	tests := []struct {
		status int
		code   string
		kind   GatewayErrorKind
	}{
		{status: http.StatusGone, code: "test_error", kind: GatewayErrorRevoked},
		{status: http.StatusTooManyRequests, code: "test_error", kind: GatewayErrorRetry},
		{status: http.StatusServiceUnavailable, code: "test_error", kind: GatewayErrorRetry},
		{status: http.StatusBadRequest, code: "test_error", kind: GatewayErrorInvalid},
		{status: http.StatusUnauthorized, code: "server_unauthorized", kind: GatewayErrorInvalid},
		{status: http.StatusForbidden, code: "server_disabled", kind: GatewayErrorInvalid},
		{status: http.StatusTooManyRequests, code: "daily_quota_exceeded", kind: GatewayErrorInvalid},
	}
	for _, test := range tests {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			response.WriteHeader(test.status)
			_, _ = response.Write([]byte(`{"error":{"code":"` + test.code + `"}}`))
		}))
		client := NewGatewayClientWithEndpoint(server.URL, server.Client())
		err := client.Send(t.Context(), "grant", "secret", "job", NotificationRequest{})
		server.Close()
		var gatewayErr *GatewayError
		if !errors.As(err, &gatewayErr) || gatewayErr.Kind != test.kind {
			t.Fatalf("status %d error = %#v", test.status, err)
		}
	}
}
