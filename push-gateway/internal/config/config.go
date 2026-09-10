package config

import (
	"encoding/base64"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr                          string
	DatabaseURL                       string
	DataEncryptionKey                 []byte
	PreviousDataEncryptionKeys        [][]byte
	Providers                         []string
	TrustedProxyCIDRs                 []string
	APNS                              APNSConfig
	JPush                             JPushConfig
	Admin                             AdminConfig
	GrantTTL                          time.Duration
	NotificationTTL                   time.Duration
	MaxNotificationTTL                time.Duration
	WorkerPollInterval                time.Duration
	JobRetention                      time.Duration
	InstallationRetention             time.Duration
	WorkerBatchSize                   int
	MaxJobsPerGrantMinute             int
	MaxRegistrationsPerIPMinute       int
	MaxRegistrationsGlobalMinute      int
	MaxGrantRotationsPerInstallMinute int
	MaxNotificationsGlobalMinute      int
}

type APNSConfig struct {
	KeyID         string
	TeamID        string
	BundleID      string
	PrivateKeyPEM []byte
}

type JPushConfig struct {
	AppKey       string
	MasterSecret string
}

type AdminConfig struct {
	Username     string
	Password     string
	PasswordHash string
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:                          envOrDefault("HTTP_ADDR", ":20062"),
		Providers:                         providerNames(os.Getenv("PUSH_PROVIDERS")),
		GrantTTL:                          30 * 24 * time.Hour,
		NotificationTTL:                   5 * time.Minute,
		MaxNotificationTTL:                time.Hour,
		WorkerPollInterval:                time.Second,
		JobRetention:                      7 * 24 * time.Hour,
		InstallationRetention:             90 * 24 * time.Hour,
		WorkerBatchSize:                   50,
		MaxJobsPerGrantMinute:             120,
		MaxRegistrationsPerIPMinute:       20,
		MaxRegistrationsGlobalMinute:      1000,
		MaxGrantRotationsPerInstallMinute: 10,
		MaxNotificationsGlobalMinute:      10000,
	}
	cfg.DatabaseURL = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}

	encodedKey := strings.TrimSpace(os.Getenv("DATA_ENCRYPTION_KEY"))
	if encodedKey == "" {
		return Config{}, fmt.Errorf("DATA_ENCRYPTION_KEY is required")
	}
	key, err := base64.StdEncoding.DecodeString(encodedKey)
	if err != nil || len(key) != 32 {
		return Config{}, fmt.Errorf("DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key")
	}
	cfg.DataEncryptionKey = key
	if previousKeys := strings.TrimSpace(os.Getenv("DATA_ENCRYPTION_PREVIOUS_KEYS")); previousKeys != "" {
		for index, encodedPreviousKey := range strings.Split(previousKeys, ",") {
			previousKey, decodeErr := base64.StdEncoding.DecodeString(strings.TrimSpace(encodedPreviousKey))
			if decodeErr != nil || len(previousKey) != 32 {
				return Config{}, fmt.Errorf("DATA_ENCRYPTION_PREVIOUS_KEYS entry %d must be a base64-encoded 32-byte key", index)
			}
			cfg.PreviousDataEncryptionKeys = append(cfg.PreviousDataEncryptionKeys, previousKey)
		}
	}

	cfg.Admin.Username = strings.TrimSpace(os.Getenv("PUSH_ADMIN_USERNAME"))
	cfg.Admin.Password = os.Getenv("PUSH_ADMIN_PASSWORD")
	cfg.Admin.PasswordHash = strings.TrimSpace(os.Getenv("PUSH_ADMIN_PASSWORD_HASH"))
	if cfg.Admin.Password != "" && cfg.Admin.PasswordHash != "" {
		return Config{}, fmt.Errorf("PUSH_ADMIN_PASSWORD and PUSH_ADMIN_PASSWORD_HASH cannot both be configured")
	}
	hasUsername := cfg.Admin.Username != ""
	hasCredential := cfg.Admin.Password != "" || cfg.Admin.PasswordHash != ""
	if hasUsername != hasCredential {
		return Config{}, fmt.Errorf("PUSH_ADMIN_USERNAME and one admin password credential must be configured together")
	}

	if trustedProxies := strings.TrimSpace(os.Getenv("TRUSTED_PROXY_CIDRS")); trustedProxies != "" {
		for _, item := range strings.Split(trustedProxies, ",") {
			cidr := strings.TrimSpace(item)
			if _, _, parseErr := net.ParseCIDR(cidr); parseErr != nil {
				return Config{}, fmt.Errorf("TRUSTED_PROXY_CIDRS contains invalid CIDR %q", cidr)
			}
			cfg.TrustedProxyCIDRs = append(cfg.TrustedProxyCIDRs, cidr)
		}
	}

	if len(cfg.Providers) == 0 {
		return Config{}, fmt.Errorf("PUSH_PROVIDERS must contain at least one provider")
	}
	if contains(cfg.Providers, "apns") {
		cfg.APNS.KeyID = strings.TrimSpace(os.Getenv("APNS_KEY_ID"))
		cfg.APNS.TeamID = strings.TrimSpace(os.Getenv("APNS_TEAM_ID"))
		cfg.APNS.BundleID = strings.TrimSpace(os.Getenv("APNS_BUNDLE_ID"))
		encodedPrivateKey := strings.TrimSpace(os.Getenv("APNS_PRIVATE_KEY_BASE64"))
		if cfg.APNS.KeyID == "" || cfg.APNS.TeamID == "" || cfg.APNS.BundleID == "" || encodedPrivateKey == "" {
			return Config{}, fmt.Errorf("APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, and APNS_PRIVATE_KEY_BASE64 are required when apns is enabled")
		}
		cfg.APNS.PrivateKeyPEM, err = base64.StdEncoding.DecodeString(encodedPrivateKey)
		if err != nil || len(cfg.APNS.PrivateKeyPEM) == 0 {
			return Config{}, fmt.Errorf("APNS_PRIVATE_KEY_BASE64 must contain a base64-encoded APNs private key")
		}
	}
	if contains(cfg.Providers, "jpush") {
		cfg.JPush.AppKey = strings.TrimSpace(os.Getenv("JPUSH_APP_KEY"))
		cfg.JPush.MasterSecret = strings.TrimSpace(os.Getenv("JPUSH_MASTER_SECRET"))
		if cfg.JPush.AppKey == "" || cfg.JPush.MasterSecret == "" {
			return Config{}, fmt.Errorf("JPUSH_APP_KEY and JPUSH_MASTER_SECRET are required when jpush is enabled")
		}
	}
	if cfg.GrantTTL, err = durationEnv("DEFAULT_GRANT_TTL", cfg.GrantTTL); err != nil {
		return Config{}, err
	}
	if cfg.NotificationTTL, err = durationEnv("DEFAULT_NOTIFICATION_TTL", cfg.NotificationTTL); err != nil {
		return Config{}, err
	}
	if cfg.MaxNotificationTTL, err = durationEnv("MAX_NOTIFICATION_TTL", cfg.MaxNotificationTTL); err != nil {
		return Config{}, err
	}
	if cfg.WorkerPollInterval, err = durationEnv("WORKER_POLL_INTERVAL", cfg.WorkerPollInterval); err != nil {
		return Config{}, err
	}
	if cfg.JobRetention, err = durationEnv("JOB_RETENTION", cfg.JobRetention); err != nil {
		return Config{}, err
	}
	if cfg.InstallationRetention, err = durationEnv("INSTALLATION_RETENTION", cfg.InstallationRetention); err != nil {
		return Config{}, err
	}
	if cfg.WorkerBatchSize, err = positiveIntEnv("WORKER_BATCH_SIZE", cfg.WorkerBatchSize); err != nil {
		return Config{}, err
	}
	if cfg.MaxJobsPerGrantMinute, err = positiveIntEnv("MAX_JOBS_PER_GRANT_MINUTE", cfg.MaxJobsPerGrantMinute); err != nil {
		return Config{}, err
	}
	if cfg.MaxRegistrationsPerIPMinute, err = positiveIntEnv("MAX_REGISTRATIONS_PER_IP_MINUTE", cfg.MaxRegistrationsPerIPMinute); err != nil {
		return Config{}, err
	}
	if cfg.MaxRegistrationsGlobalMinute, err = positiveIntEnv("MAX_REGISTRATIONS_GLOBAL_MINUTE", cfg.MaxRegistrationsGlobalMinute); err != nil {
		return Config{}, err
	}
	if cfg.MaxGrantRotationsPerInstallMinute, err = positiveIntEnv("MAX_GRANT_ROTATIONS_PER_INSTALLATION_MINUTE", cfg.MaxGrantRotationsPerInstallMinute); err != nil {
		return Config{}, err
	}
	if cfg.MaxNotificationsGlobalMinute, err = positiveIntEnv("MAX_NOTIFICATIONS_GLOBAL_MINUTE", cfg.MaxNotificationsGlobalMinute); err != nil {
		return Config{}, err
	}
	if cfg.GrantTTL < time.Hour {
		return Config{}, fmt.Errorf("DEFAULT_GRANT_TTL must be at least 1h")
	}
	if cfg.NotificationTTL <= 0 || cfg.MaxNotificationTTL < cfg.NotificationTTL {
		return Config{}, fmt.Errorf("notification TTL configuration is invalid")
	}
	if cfg.WorkerPollInterval < 100*time.Millisecond {
		return Config{}, fmt.Errorf("WORKER_POLL_INTERVAL must be at least 100ms")
	}
	if cfg.JobRetention < time.Hour {
		return Config{}, fmt.Errorf("JOB_RETENTION must be at least 1h")
	}
	if cfg.InstallationRetention < cfg.JobRetention {
		return Config{}, fmt.Errorf("INSTALLATION_RETENTION must not be shorter than JOB_RETENTION")
	}
	return cfg, nil
}

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func providerNames(value string) []string {
	seen := make(map[string]struct{})
	var result []string
	for _, item := range strings.Split(value, ",") {
		name := strings.TrimSpace(item)
		if name == "" {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}
		seen[name] = struct{}{}
		result = append(result, name)
	}
	return result
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func durationEnv(name string, fallback time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive duration", name)
	}
	return parsed, nil
}

func positiveIntEnv(name string, fallback int) (int, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return parsed, nil
}
