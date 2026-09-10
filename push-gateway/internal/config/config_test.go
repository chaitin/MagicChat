package config

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestLoadReadsConfiguration(t *testing.T) {
	key := make([]byte, 32)
	for index := range key {
		key[index] = byte(index)
	}
	t.Setenv("DATABASE_URL", "postgres://push:test@db/push")
	t.Setenv("DATA_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(key))
	t.Setenv("DATA_ENCRYPTION_PREVIOUS_KEYS", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	t.Setenv("HTTP_ADDR", ":9090")
	t.Setenv("PUSH_PROVIDERS", "fake, fake")
	t.Setenv("DEFAULT_GRANT_TTL", "168h")
	t.Setenv("DEFAULT_NOTIFICATION_TTL", "2m")
	t.Setenv("MAX_NOTIFICATION_TTL", "30m")
	t.Setenv("WORKER_BATCH_SIZE", "25")
	t.Setenv("INSTALLATION_RETENTION", "240h")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.HTTPAddr != ":9090" || len(cfg.Providers) != 1 || cfg.Providers[0] != "fake" || cfg.WorkerBatchSize != 25 || len(cfg.PreviousDataEncryptionKeys) != 1 {
		t.Fatalf("configuration = %#v", cfg)
	}
	if cfg.GrantTTL != 168*time.Hour || cfg.NotificationTTL != 2*time.Minute || cfg.MaxNotificationTTL != 30*time.Minute || cfg.InstallationRetention != 240*time.Hour {
		t.Fatalf("TTL configuration = %#v", cfg)
	}
}

func TestLoadReadsPlaintextAdminConfiguration(t *testing.T) {
	key := make([]byte, 32)
	t.Setenv("DATABASE_URL", "postgres://db/push")
	t.Setenv("DATA_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(key))
	t.Setenv("PUSH_PROVIDERS", "fake")
	t.Setenv("PUSH_ADMIN_USERNAME", "operator")
	t.Setenv("PUSH_ADMIN_PASSWORD", "local admin password")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Admin.Username != "operator" || cfg.Admin.Password != "local admin password" || cfg.Admin.PasswordHash != "" {
		t.Fatalf("admin configuration did not load plaintext credential")
	}
}

func TestLoadReadsOptionalAdminConfiguration(t *testing.T) {
	key := make([]byte, 32)
	t.Setenv("DATABASE_URL", "postgres://db/push")
	t.Setenv("DATA_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(key))
	t.Setenv("PUSH_PROVIDERS", "fake")
	t.Setenv("PUSH_ADMIN_USERNAME", "operator")
	t.Setenv("PUSH_ADMIN_PASSWORD_HASH", "$argon2id$v=19$m=65536,t=3,p=2$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2g")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Admin.Username != "operator" || cfg.Admin.PasswordHash == "" {
		t.Fatalf("admin configuration = %#v", cfg.Admin)
	}
}

func TestLoadRejectsBothAdminPasswordForms(t *testing.T) {
	key := make([]byte, 32)
	t.Setenv("DATABASE_URL", "postgres://db/push")
	t.Setenv("DATA_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(key))
	t.Setenv("PUSH_PROVIDERS", "fake")
	t.Setenv("PUSH_ADMIN_USERNAME", "operator")
	t.Setenv("PUSH_ADMIN_PASSWORD", "local admin password")
	t.Setenv("PUSH_ADMIN_PASSWORD_HASH", "hash")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "cannot both") {
		t.Fatalf("both admin credentials error = %v", err)
	}
}

func TestLoadRejectsPartialAdminConfiguration(t *testing.T) {
	key := make([]byte, 32)
	t.Setenv("DATABASE_URL", "postgres://db/push")
	t.Setenv("DATA_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(key))
	t.Setenv("PUSH_PROVIDERS", "fake")
	t.Setenv("PUSH_ADMIN_USERNAME", "operator")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "admin password credential") {
		t.Fatalf("partial admin configuration error = %v", err)
	}
}

func TestLoadRequiresJPushCredentialsWhenEnabled(t *testing.T) {
	key := make([]byte, 32)
	t.Setenv("DATABASE_URL", "postgres://db/push")
	t.Setenv("DATA_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(key))
	t.Setenv("PUSH_PROVIDERS", "jpush")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "JPUSH_APP_KEY") {
		t.Fatalf("missing JPush credential error = %v", err)
	}
	t.Setenv("JPUSH_APP_KEY", "app-key")
	t.Setenv("JPUSH_MASTER_SECRET", "master-secret")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("load JPush configuration: %v", err)
	}
	if cfg.JPush.AppKey != "app-key" || cfg.JPush.MasterSecret != "master-secret" {
		t.Fatalf("JPush configuration = %#v", cfg.JPush)
	}
}

func TestLoadRejectsInstallationRetentionShorterThanJobs(t *testing.T) {
	key := make([]byte, 32)
	t.Setenv("DATABASE_URL", "postgres://db/push")
	t.Setenv("DATA_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(key))
	t.Setenv("PUSH_PROVIDERS", "fake")
	t.Setenv("JOB_RETENTION", "168h")
	t.Setenv("INSTALLATION_RETENTION", "24h")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "INSTALLATION_RETENTION") {
		t.Fatalf("invalid installation retention error = %v", err)
	}
}

func TestLoadRejectsInvalidTrustedProxyCIDR(t *testing.T) {
	key := make([]byte, 32)
	t.Setenv("DATABASE_URL", "postgres://db/push")
	t.Setenv("DATA_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(key))
	t.Setenv("PUSH_PROVIDERS", "fake")
	t.Setenv("TRUSTED_PROXY_CIDRS", "not-a-cidr")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "TRUSTED_PROXY_CIDRS") {
		t.Fatalf("invalid trusted proxy error = %v", err)
	}
}

func TestLoadRequiresAnExplicitProvider(t *testing.T) {
	key := make([]byte, 32)
	t.Setenv("DATABASE_URL", "postgres://db/push")
	t.Setenv("DATA_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(key))
	t.Setenv("PUSH_PROVIDERS", "")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "PUSH_PROVIDERS") {
		t.Fatalf("missing provider error = %v", err)
	}
}

func TestLoadRejectsMissingAndInvalidSecrets(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("DATA_ENCRYPTION_KEY", "")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("missing database error = %v", err)
	}

	t.Setenv("DATABASE_URL", "postgres://db/push")
	t.Setenv("DATA_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString([]byte("short")))
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "32-byte") {
		t.Fatalf("invalid key error = %v", err)
	}
}
