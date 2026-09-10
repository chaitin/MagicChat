package httpserver

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	gatewayadmin "push-gateway/internal/admin"
	"push-gateway/internal/gateway"
	"push-gateway/internal/model"
	"push-gateway/internal/provider"
	"push-gateway/internal/provider/fake"
	"push-gateway/internal/secure"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/argon2"
	"gorm.io/gorm"
)

const testHTTPServerKey = "mcps_srv_BBBBBBBBBBBB_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"

func TestAPIRoutesInstallationGrantAndNotification(t *testing.T) {
	router := newTestRouter(t)
	registration := requestJSON(t, router, http.MethodPost, "/api/v1/installations", map[string]any{
		"provider": "fake", "provider_token": "provider-token-http",
		"platform": "android", "app_version": "1.0.0",
	}, nil)
	if registration.Code != http.StatusCreated {
		t.Fatalf("registration status = %d, body = %s", registration.Code, registration.Body.String())
	}
	var installation gateway.InstallationCredential
	decodeResponse(t, registration, &installation)
	if installation.InstallationID == "" || installation.ManagementToken == "" {
		t.Fatalf("installation credential = %#v", installation)
	}

	unauthorized := requestJSON(t, router, http.MethodPost,
		"/api/v1/installations/"+installation.InstallationID+"/active-grant", nil,
		map[string]string{"Authorization": "Installation wrong-token"})
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, body = %s", unauthorized.Code, unauthorized.Body.String())
	}
	grantResponse := requestJSON(t, router, http.MethodPost,
		"/api/v1/installations/"+installation.InstallationID+"/active-grant", nil,
		map[string]string{"Authorization": "Installation " + installation.ManagementToken})
	if grantResponse.Code != http.StatusCreated {
		t.Fatalf("grant status = %d, body = %s", grantResponse.Code, grantResponse.Body.String())
	}
	var grant gateway.GrantCredential
	decodeResponse(t, grantResponse, &grant)

	headers := map[string]string{
		"Authorization":          "Bearer " + grant.SendToken,
		"Idempotency-Key":        "message-http-1:grant-http-1",
		"X-MagicChat-Server-Key": testHTTPServerKey,
	}
	notification := requestJSON(t, router, http.MethodPost,
		"/api/v1/grants/"+grant.GrantID+"/notifications", map[string]any{
			"event": gateway.EventMessageCreated, "route_token": "route-token-http",
			"collapse_key": "conversation-http", "ttl_seconds": 120,
		}, headers)
	if notification.Code != http.StatusAccepted {
		t.Fatalf("notification status = %d, body = %s", notification.Code, notification.Body.String())
	}
	var first gateway.JobResult
	decodeResponse(t, notification, &first)
	duplicate := requestJSON(t, router, http.MethodPost,
		"/api/v1/grants/"+grant.GrantID+"/notifications", map[string]any{
			"event": gateway.EventMessageCreated, "route_token": "route-token-http",
		}, headers)
	var second gateway.JobResult
	decodeResponse(t, duplicate, &second)
	if duplicate.Code != http.StatusAccepted || !second.Duplicate || second.JobID != first.JobID {
		t.Fatalf("duplicate status/body = %d/%s", duplicate.Code, duplicate.Body.String())
	}
	metrics := requestJSON(t, router, http.MethodGet, "/api/metrics", nil, nil)
	for _, expected := range []string{
		`push_gateway_jobs{status="queued"} 1`,
		`push_gateway_grants{status="active"} 1`,
		`push_gateway_installations{provider="fake",platform="android",status="active"} 1`,
		`push_gateway_private_servers{status="active"} 1`,
		"push_gateway_server_notifications_accepted_today 1",
		"push_gateway_server_quota_rejections_total 0",
		"push_gateway_recent_failed_jobs 0",
		"# TYPE push_gateway_recent_failed_jobs_by_code gauge",
		"push_gateway_oldest_pending_job_age_seconds",
	} {
		if !strings.Contains(metrics.Body.String(), expected) {
			t.Fatalf("metrics do not contain %q: %s", expected, metrics.Body.String())
		}
	}
}

func TestAdminServerRoutesUseSessionAndCSRF(t *testing.T) {
	router := newTestRouter(t)
	crossSite := requestJSON(t, router, http.MethodPost, "/api/admin/v1/session", map[string]any{
		"username": "operator", "password": "correct password",
	}, map[string]string{"Sec-Fetch-Site": "cross-site"})
	if crossSite.Code != http.StatusForbidden {
		t.Fatalf("cross-site login status = %d", crossSite.Code)
	}
	unauthorized := requestJSON(t, router, http.MethodGet, "/api/admin/v1/servers", nil, nil)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d", unauthorized.Code)
	}
	login := requestJSON(t, router, http.MethodPost, "/api/admin/v1/session", map[string]any{
		"username": "operator", "password": "correct password",
	}, nil)
	if login.Code != http.StatusOK {
		t.Fatalf("login status/body = %d/%s", login.Code, login.Body.String())
	}
	var sessionCookie, csrfCookie *http.Cookie
	for _, cookie := range login.Result().Cookies() {
		switch cookie.Name {
		case adminSessionCookie:
			sessionCookie = cookie
		case adminCSRFCookie:
			csrfCookie = cookie
		}
	}
	if sessionCookie == nil || csrfCookie == nil || !sessionCookie.HttpOnly || csrfCookie.HttpOnly {
		t.Fatalf("admin cookies = %#v", login.Result().Cookies())
	}
	cookieHeader := sessionCookie.Name + "=" + sessionCookie.Value + "; " + csrfCookie.Name + "=" + csrfCookie.Value
	headers := map[string]string{"Cookie": cookieHeader, "X-CSRF-Token": csrfCookie.Value}
	created := requestJSON(t, router, http.MethodPost, "/api/admin/v1/servers", map[string]any{
		"name": "生产环境一号", "daily_quota": 100000,
	}, headers)
	if created.Code != http.StatusCreated || !strings.Contains(created.Body.String(), "mcps_srv_") {
		t.Fatalf("create status/body = %d/%s", created.Code, created.Body.String())
	}
	listed := requestJSON(t, router, http.MethodGet, "/api/admin/v1/servers", nil, map[string]string{"Cookie": cookieHeader})
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), "生产环境一号") {
		t.Fatalf("list status/body = %d/%s", listed.Code, listed.Body.String())
	}
}

func TestRecentGatewayFailureMetricsAreGroupedByAnonymousCode(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open metrics database: %v", err)
	}
	if err := db.AutoMigrate(&model.Job{}); err != nil {
		t.Fatalf("migrate metrics database: %v", err)
	}
	now := time.Now().UTC()
	jobs := []model.Job{
		{ID: uuid.NewString(), GrantID: uuid.NewString(), IdempotencyKey: "metrics-failure-1", EventType: gateway.EventMessageCreated, RouteToken: "route-1", Status: model.JobStatusFailed, LastErrorCode: "jpush_1004", NextAttemptAt: now, ExpiresAt: now.Add(time.Minute), CreatedAt: now, UpdatedAt: now},
		{ID: uuid.NewString(), GrantID: uuid.NewString(), IdempotencyKey: "metrics-failure-2", EventType: gateway.EventMessageCreated, RouteToken: "route-2", Status: model.JobStatusFailed, LastErrorCode: "jpush_1004", NextAttemptAt: now, ExpiresAt: now.Add(time.Minute), CreatedAt: now, UpdatedAt: now},
	}
	if err := db.Create(&jobs).Error; err != nil {
		t.Fatalf("create failed jobs: %v", err)
	}
	counts, err := metricErrorCodeCounts(db.Model(&model.Job{}).Where("status = ?", model.JobStatusFailed))
	if err != nil || len(counts) != 1 || counts[0].Code != "jpush_1004" || counts[0].Count != 2 {
		t.Fatalf("failure counts = %#v, err = %v", counts, err)
	}
	var output strings.Builder
	writeMetricErrorCodeCounts(&output, "push_gateway_recent_failed_jobs_by_code", "test", counts)
	if !strings.Contains(output.String(), `push_gateway_recent_failed_jobs_by_code{code="jpush_1004"} 2`) {
		t.Fatalf("metric output = %s", output.String())
	}
}

func TestAdminCookieSecurityFollowsRequestScheme(t *testing.T) {
	httpRequest := httptest.NewRequest(http.MethodPost, "/", nil)
	if requestUsesHTTPS(httpRequest) {
		t.Fatal("plain HTTP request was treated as HTTPS")
	}
	httpsRequest := httptest.NewRequest(http.MethodPost, "/", nil)
	httpsRequest.Header.Set("X-Forwarded-Proto", "https")
	if !requestUsesHTTPS(httpsRequest) {
		t.Fatal("forwarded HTTPS request was treated as plain HTTP")
	}
}

func TestClientAddressOnlyTrustsConfiguredProxy(t *testing.T) {
	_, trustedNetwork, err := net.ParseCIDR("10.0.0.0/8")
	if err != nil {
		t.Fatalf("parse network: %v", err)
	}
	server := &Server{trustedProxies: []*net.IPNet{trustedNetwork}}
	trustedRequest := httptest.NewRequest(http.MethodPost, "/", nil)
	trustedRequest.RemoteAddr = "10.0.0.2:1234"
	trustedRequest.Header.Set("X-Forwarded-For", "203.0.113.5")
	if got := server.clientAddress(trustedRequest); got != "203.0.113.5" {
		t.Fatalf("trusted client address = %q", got)
	}
	untrustedRequest := httptest.NewRequest(http.MethodPost, "/", nil)
	untrustedRequest.RemoteAddr = "198.51.100.8:1234"
	untrustedRequest.Header.Set("X-Forwarded-For", "203.0.113.6")
	if got := server.clientAddress(untrustedRequest); got != "198.51.100.8" {
		t.Fatalf("untrusted client address = %q", got)
	}
}

func TestMalformedResourceIDReturnsBadRequest(t *testing.T) {
	router := newTestRouter(t)
	response := requestJSON(t, router, http.MethodPost, "/api/v1/installations/not-a-uuid/active-grant", nil,
		map[string]string{"Authorization": "Installation token"})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("malformed ID status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestOperationalRoutesUseAPIPrefix(t *testing.T) {
	router := newTestRouter(t)
	for _, path := range []string{"/api/health/live", "/api/health/ready", "/api/metrics", "/api/openapi.json"} {
		response := requestJSON(t, router, http.MethodGet, path, nil, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d, body = %s", path, response.Code, response.Body.String())
		}
	}
	if response := requestJSON(t, router, http.MethodGet, "/health/live", nil, nil); response.Code != http.StatusNotFound {
		t.Fatalf("unprefixed health status = %d", response.Code)
	}
}

func newTestRouter(t *testing.T) *echo.Echo {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&model.RateLimit{}, &model.Installation{}, &model.Grant{}, &model.Server{},
		&model.ServerKey{}, &model.ServerDailyUsage{}, &model.AdminSession{},
		&model.AdminAuditEvent{}, &model.Job{},
	); err != nil {
		t.Fatalf("migrate sqlite: %v", err)
	}
	serverID := uuid.NewString()
	if err := db.Create(&model.Server{ID: serverID, Name: "http", Status: model.ServerStatusActive, DailyQuota: 1000, Revision: 1, CreatedAt: time.Now(), UpdatedAt: time.Now()}).Error; err != nil {
		t.Fatalf("create server: %v", err)
	}
	if err := db.Create(&model.ServerKey{ID: uuid.NewString(), ServerID: serverID, PublicID: "BBBBBBBBBBBB", KeyHash: secure.HashToken(testHTTPServerKey), KeyCiphertext: []byte{1}, Status: model.ServerKeyStatusActive, CreatedAt: time.Now()}).Error; err != nil {
		t.Fatalf("create server key: %v", err)
	}
	cipher, err := secure.NewTokenCipher(make([]byte, 32))
	if err != nil {
		t.Fatalf("create cipher: %v", err)
	}
	now := time.Now().UTC()
	service, err := gateway.New(gateway.Options{
		DB: db, Cipher: cipher, Providers: []provider.Provider{fake.New()},
		Now: func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("create gateway: %v", err)
	}
	adminService, err := gatewayadmin.New(gatewayadmin.Options{
		DB: db, Cipher: cipher, Username: "operator", PasswordHash: httpTestPasswordHash("correct password"),
		Now: func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("create admin: %v", err)
	}
	return New(db, service, Options{Admin: adminService})
}

func requestJSON(t *testing.T, router http.Handler, method, path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var content []byte
	if body != nil {
		var err error
		content, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(content))
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func httpTestPasswordHash(password string) string {
	salt := []byte("0123456789abcdef")
	encoded := argon2.IDKey([]byte(password), salt, 1, 8*1024, 1, 32)
	return fmt.Sprintf("$argon2id$v=19$m=8192,t=1,p=1$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(encoded))
}

func decodeResponse(t *testing.T, response *httptest.ResponseRecorder, target any) {
	t.Helper()
	if err := json.Unmarshal(response.Body.Bytes(), target); err != nil {
		t.Fatalf("decode response %q: %v", response.Body.String(), err)
	}
}
