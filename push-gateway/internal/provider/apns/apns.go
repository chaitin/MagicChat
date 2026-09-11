package apns

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"push-gateway/internal/provider"
)

const (
	productionEndpoint   = "https://api.push.apple.com"
	developmentEndpoint  = "https://api.sandbox.push.apple.com"
	deviceTokenHexLength = 64
	maxResponseBytes     = 16 << 10
	jwtLifetime          = 50 * time.Minute
)

type Config struct {
	KeyID               string
	TeamID              string
	BundleID            string
	PrivateKeyPEM       []byte
	ProductionEndpoint  string
	DevelopmentEndpoint string
	HTTPClient          *http.Client
	Now                 func() time.Time
}

type Provider struct {
	keyID               string
	teamID              string
	bundleID            string
	privateKey          *ecdsa.PrivateKey
	productionEndpoint  string
	developmentEndpoint string
	httpClient          *http.Client
	now                 func() time.Time

	jwtMu        sync.Mutex
	cachedJWT    string
	jwtCreatedAt time.Time
}

func New(config Config) (*Provider, error) {
	config.KeyID = strings.TrimSpace(config.KeyID)
	config.TeamID = strings.TrimSpace(config.TeamID)
	config.BundleID = strings.TrimSpace(config.BundleID)
	if config.KeyID == "" || config.TeamID == "" || config.BundleID == "" {
		return nil, fmt.Errorf("APNs key ID, team ID, and bundle ID are required")
	}
	privateKey, err := parsePrivateKey(config.PrivateKeyPEM)
	if err != nil {
		return nil, err
	}
	if config.ProductionEndpoint == "" {
		config.ProductionEndpoint = productionEndpoint
	}
	if config.DevelopmentEndpoint == "" {
		config.DevelopmentEndpoint = developmentEndpoint
	}
	for _, endpoint := range []string{config.ProductionEndpoint, config.DevelopmentEndpoint} {
		parsed, err := url.Parse(endpoint)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return nil, fmt.Errorf("invalid APNs endpoint %q", endpoint)
		}
	}
	if config.HTTPClient == nil {
		config.HTTPClient = &http.Client{Timeout: 10 * time.Second}
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	return &Provider{
		keyID: config.KeyID, teamID: config.TeamID, bundleID: config.BundleID,
		privateKey: privateKey, productionEndpoint: strings.TrimRight(config.ProductionEndpoint, "/"),
		developmentEndpoint: strings.TrimRight(config.DevelopmentEndpoint, "/"),
		httpClient:          config.HTTPClient, now: config.Now,
	}, nil
}

func (*Provider) Name() string { return "apns" }

func (*Provider) ValidateRegistration(registration provider.Registration) error {
	if registration.Platform != "ios" || registration.Environment != "development" && registration.Environment != "production" {
		return fmt.Errorf("APNs registration platform or environment is invalid")
	}
	deviceToken := strings.TrimSpace(registration.Token)
	decoded, err := hex.DecodeString(deviceToken)
	if err != nil || len(deviceToken) != deviceTokenHexLength || len(decoded) != deviceTokenHexLength/2 {
		return fmt.Errorf("APNs device token is invalid")
	}
	return nil
}

func (p *Provider) Send(ctx context.Context, notification provider.Notification) (provider.Receipt, error) {
	deviceToken := strings.TrimSpace(notification.Token)
	if err := p.ValidateRegistration(provider.Registration{
		Token: deviceToken, Platform: notification.Platform, Environment: notification.Environment,
	}); err != nil {
		return provider.Receipt{}, &provider.SendError{Kind: provider.ErrorInvalidDevice, Code: "bad_device_token"}
	}
	jwt, err := p.authorizationToken()
	if err != nil {
		return provider.Receipt{}, &provider.SendError{Kind: provider.ErrorPermanent, Code: "apns_authentication_key_invalid", Err: err}
	}
	payload, err := json.Marshal(map[string]any{
		"aps": map[string]any{
			"alert": map[string]string{"title": notification.Title, "body": notification.Body},
			"sound": "default",
		},
		"event": notification.Event, "grant_id": notification.GrantID,
		"route_token": notification.RouteToken,
	})
	if err != nil {
		return provider.Receipt{}, &provider.SendError{Kind: provider.ErrorPermanent, Code: "payload_encoding_failed", Err: err}
	}
	endpoint := p.productionEndpoint
	if notification.Environment == "development" {
		endpoint = p.developmentEndpoint
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/3/device/"+url.PathEscape(deviceToken), strings.NewReader(string(payload)))
	if err != nil {
		return provider.Receipt{}, &provider.SendError{Kind: provider.ErrorPermanent, Code: "request_creation_failed", Err: err}
	}
	request.Header.Set("Authorization", "bearer "+jwt)
	request.Header.Set("Content-Type", "application/json")
	if notificationID := strings.TrimSpace(notification.ID); notificationID != "" {
		request.Header.Set("apns-id", notificationID)
	}
	request.Header.Set("apns-topic", p.bundleID)
	request.Header.Set("apns-push-type", "alert")
	request.Header.Set("apns-priority", "10")
	if !notification.ExpiresAt.IsZero() {
		request.Header.Set("apns-expiration", strconv.FormatInt(notification.ExpiresAt.Unix(), 10))
	}
	if collapseID := normalizeCollapseID(notification.CollapseKey); collapseID != "" {
		request.Header.Set("apns-collapse-id", collapseID)
	}
	response, err := p.httpClient.Do(request)
	if err != nil {
		return provider.Receipt{}, &provider.SendError{Kind: provider.ErrorTransient, Code: "apns_unavailable", Err: err}
	}
	defer response.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if readErr != nil {
		return provider.Receipt{}, &provider.SendError{Kind: provider.ErrorTransient, Code: "apns_response_unreadable", Err: readErr}
	}
	if response.StatusCode == http.StatusOK {
		return provider.Receipt{MessageID: response.Header.Get("apns-id")}, nil
	}
	var failure struct {
		Reason string `json:"reason"`
	}
	_ = json.Unmarshal(body, &failure)
	if failure.Reason == "ExpiredProviderToken" {
		p.invalidateAuthorizationToken()
	}
	code := normalizeReason(failure.Reason)
	if code == "" {
		code = "apns_http_" + strconv.Itoa(response.StatusCode)
	}
	kind := classifyResponse(response.StatusCode, failure.Reason)
	return provider.Receipt{}, &provider.SendError{Kind: kind, Code: code}
}

func (p *Provider) authorizationToken() (string, error) {
	p.jwtMu.Lock()
	defer p.jwtMu.Unlock()
	now := p.now().UTC()
	if p.cachedJWT != "" && now.Sub(p.jwtCreatedAt) < jwtLifetime {
		return p.cachedJWT, nil
	}
	header, err := json.Marshal(map[string]string{"alg": "ES256", "kid": p.keyID})
	if err != nil {
		return "", err
	}
	claims, err := json.Marshal(map[string]any{"iss": p.teamID, "iat": now.Unix()})
	if err != nil {
		return "", err
	}
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	digest := sha256.Sum256([]byte(unsigned))
	r, s, err := ecdsa.Sign(rand.Reader, p.privateKey, digest[:])
	if err != nil {
		return "", err
	}
	signature := make([]byte, 64)
	r.FillBytes(signature[:32])
	s.FillBytes(signature[32:])
	p.cachedJWT = unsigned + "." + base64.RawURLEncoding.EncodeToString(signature)
	p.jwtCreatedAt = now
	return p.cachedJWT, nil
}

func (p *Provider) invalidateAuthorizationToken() {
	p.jwtMu.Lock()
	p.cachedJWT = ""
	p.jwtCreatedAt = time.Time{}
	p.jwtMu.Unlock()
}

func parsePrivateKey(content []byte) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode(content)
	if block == nil {
		return nil, fmt.Errorf("decode APNs private key PEM")
	}
	var key *ecdsa.PrivateKey
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err == nil {
		var ok bool
		key, ok = parsed.(*ecdsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("APNs private key is not ECDSA")
		}
	} else {
		key, err = x509.ParseECPrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse APNs private key: %w", err)
		}
	}
	if key.Curve != elliptic.P256() {
		return nil, fmt.Errorf("APNs private key must use P-256")
	}
	return key, nil
}

func normalizeCollapseID(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 64 {
		return value
	}
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func normalizeReason(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var result strings.Builder
	for index, current := range value {
		if current >= 'A' && current <= 'Z' {
			if index > 0 {
				result.WriteByte('_')
			}
			result.WriteRune(current + ('a' - 'A'))
			continue
		}
		result.WriteRune(current)
	}
	return result.String()
}

func classifyResponse(status int, reason string) provider.ErrorKind {
	switch reason {
	case "BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered":
		return provider.ErrorInvalidDevice
	}
	if reason == "ExpiredProviderToken" || status == http.StatusTooManyRequests || status >= 500 {
		return provider.ErrorTransient
	}
	return provider.ErrorPermanent
}
