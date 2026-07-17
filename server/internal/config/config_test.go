package config

import (
	"net/url"
	"strings"
	"testing"
)

func TestLoadReadsEnvironmentConfiguration(t *testing.T) {
	setRequiredEnvironment(t)
	t.Setenv("PUBLIC_HOSTNAME", "chat.example.com")
	t.Setenv("CLIENT_HTTPS_PORT", "8443")
	t.Setenv("ADMIN_HTTPS_PORT", "9443")
	t.Setenv("POSTGRES_HOST", "postgres.internal")
	t.Setenv("POSTGRES_DB", "magic-chat")
	t.Setenv("POSTGRES_USER", "magic-chat")
	t.Setenv("POSTGRES_PASSWORD", "p@ss:word")
	t.Setenv("AWS_ENDPOINT_URL_S3", "https://s3.example.com/")
	t.Setenv("AWS_REGION", "ap-guangzhou")
	t.Setenv("S3_BOOTSTRAP_ENABLED", "true")
	t.Setenv("S3_FORCE_PATH_STYLE", "true")
	t.Setenv("TEMPORARY_ASSETS_EXPIRE_DAYS", "90")
	t.Setenv("S3_ABORT_MULTIPART_DAYS", "5")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Server.PublicHostname != "chat.example.com" {
		t.Fatalf("Server.PublicHostname = %q", cfg.Server.PublicHostname)
	}
	if cfg.Server.ClientOrigin() != "https://chat.example.com:8443" {
		t.Fatalf("Server.ClientOrigin() = %q", cfg.Server.ClientOrigin())
	}
	if cfg.Server.AdminOrigin() != "https://chat.example.com:9443" {
		t.Fatalf("Server.AdminOrigin() = %q", cfg.Server.AdminOrigin())
	}
	dsn, err := url.Parse(cfg.Database.DSN)
	if err != nil {
		t.Fatalf("parse Database.DSN: %v", err)
	}
	password, _ := dsn.User.Password()
	if dsn.Host != "postgres.internal:5432" || dsn.User.Username() != "magic-chat" || password != "p@ss:word" || dsn.Path != "/magic-chat" {
		t.Fatalf("Database.DSN components = %#v", dsn)
	}
	if dsn.Query().Get("sslmode") != "disable" {
		t.Fatalf("Database.DSN sslmode = %q", dsn.Query().Get("sslmode"))
	}
	if cfg.Admin.Password != "test-admin-password" {
		t.Fatalf("Admin.Password = %q", cfg.Admin.Password)
	}
	if cfg.Apps.AIAssistantSecret != "test-ai-assistant-secret" {
		t.Fatalf("Apps.AIAssistantSecret = %q", cfg.Apps.AIAssistantSecret)
	}
	if cfg.Storage.Provider != "s3" || cfg.Storage.Endpoint != "https://s3.example.com" || cfg.Storage.Region != "ap-guangzhou" {
		t.Fatalf("Storage endpoint configuration = %#v", cfg.Storage)
	}
	if !cfg.Storage.ForcePathStyle {
		t.Fatal("Storage.ForcePathStyle = false, want true")
	}
	if !cfg.Storage.BootstrapEnabled {
		t.Fatal("Storage.BootstrapEnabled = false, want true")
	}
	if cfg.Storage.Buckets.Public != "magicchat-public" || cfg.Storage.Buckets.Private != "magicchat-private" || cfg.Storage.Buckets.Temporary != "magicchat-temporary" {
		t.Fatalf("Storage.Buckets = %#v", cfg.Storage.Buckets)
	}
	if cfg.Storage.AssetHostnames.Public != "public-assets.example.com" || cfg.Storage.AssetHostnames.Private != "private-assets.example.com" || cfg.Storage.AssetHostnames.Temporary != "temporary-assets.example.com" {
		t.Fatalf("Storage.AssetHostnames = %#v", cfg.Storage.AssetHostnames)
	}
	if cfg.Storage.Lifecycle.TemporaryExpireDays != 90 || cfg.Storage.Lifecycle.AbortMultipartDays != 5 {
		t.Fatalf("Storage.Lifecycle = %#v", cfg.Storage.Lifecycle)
	}
}

func TestLoadUsesEnvironmentDefaults(t *testing.T) {
	setRequiredEnvironment(t)
	t.Setenv("CLIENT_HTTPS_PORT", "")
	t.Setenv("ADMIN_HTTPS_PORT", "")
	t.Setenv("POSTGRES_HOST", "")
	t.Setenv("S3_BOOTSTRAP_ENABLED", "")
	t.Setenv("S3_FORCE_PATH_STYLE", "")
	t.Setenv("TEMPORARY_ASSETS_EXPIRE_DAYS", "")
	t.Setenv("S3_ABORT_MULTIPART_DAYS", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Server.ClientOrigin() != "https://chat.example.com" {
		t.Fatalf("Server.ClientOrigin() = %q", cfg.Server.ClientOrigin())
	}
	if cfg.Server.AdminOrigin() != "https://chat.example.com:1443" {
		t.Fatalf("Server.AdminOrigin() = %q", cfg.Server.AdminOrigin())
	}
	if !strings.Contains(cfg.Database.DSN, "@localhost:5432/") {
		t.Fatalf("Database.DSN = %q", cfg.Database.DSN)
	}
	if cfg.Storage.ForcePathStyle {
		t.Fatal("Storage.ForcePathStyle = true, want false")
	}
	if cfg.Storage.BootstrapEnabled {
		t.Fatal("Storage.BootstrapEnabled = true, want false")
	}
	if cfg.Storage.Lifecycle.TemporaryExpireDays != 180 || cfg.Storage.Lifecycle.AbortMultipartDays != 7 {
		t.Fatalf("Storage.Lifecycle = %#v", cfg.Storage.Lifecycle)
	}
}

func TestLoadRejectsMissingRequiredEnvironment(t *testing.T) {
	required := []string{
		"PUBLIC_HOSTNAME",
		"PUBLIC_ASSETS_HOSTNAME",
		"PRIVATE_ASSETS_HOSTNAME",
		"TEMPORARY_ASSETS_HOSTNAME",
		"POSTGRES_DB",
		"POSTGRES_USER",
		"POSTGRES_PASSWORD",
		"ADMIN_PASSWORD",
		"AI_ASSISTANT_SECRET",
		"AWS_ENDPOINT_URL_S3",
		"AWS_REGION",
		"AWS_ACCESS_KEY_ID",
		"AWS_SECRET_ACCESS_KEY",
		"PUBLIC_ASSETS_BUCKET",
		"PRIVATE_ASSETS_BUCKET",
		"TEMPORARY_ASSETS_BUCKET",
	}

	for _, name := range required {
		t.Run(name, func(t *testing.T) {
			setRequiredEnvironment(t)
			t.Setenv(name, "")

			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), name) {
				t.Fatalf("Load() error = %v, want %s", err, name)
			}
		})
	}
}

func TestLoadRejectsInvalidEnvironment(t *testing.T) {
	tests := []struct {
		name      string
		envName   string
		envValue  string
		errorText string
	}{
		{name: "hostname scheme", envName: "PUBLIC_HOSTNAME", envValue: "https://chat.example.com", errorText: "PUBLIC_HOSTNAME"},
		{name: "asset hostname path", envName: "PUBLIC_ASSETS_HOSTNAME", envValue: "assets.example.com/public", errorText: "PUBLIC_ASSETS_HOSTNAME"},
		{name: "postgres host port", envName: "POSTGRES_HOST", envValue: "postgres:5432", errorText: "POSTGRES_HOST"},
		{name: "client port zero", envName: "CLIENT_HTTPS_PORT", envValue: "0", errorText: "CLIENT_HTTPS_PORT"},
		{name: "admin port oversized", envName: "ADMIN_HTTPS_PORT", envValue: "65536", errorText: "ADMIN_HTTPS_PORT"},
		{name: "endpoint scheme", envName: "AWS_ENDPOINT_URL_S3", envValue: "ftp://s3.example.com", errorText: "AWS_ENDPOINT_URL_S3"},
		{name: "bootstrap enabled", envName: "S3_BOOTSTRAP_ENABLED", envValue: "sometimes", errorText: "S3_BOOTSTRAP_ENABLED"},
		{name: "path style", envName: "S3_FORCE_PATH_STYLE", envValue: "sometimes", errorText: "S3_FORCE_PATH_STYLE"},
		{name: "temporary expiration", envName: "TEMPORARY_ASSETS_EXPIRE_DAYS", envValue: "0", errorText: "TEMPORARY_ASSETS_EXPIRE_DAYS"},
		{name: "multipart expiration", envName: "S3_ABORT_MULTIPART_DAYS", envValue: "abc", errorText: "S3_ABORT_MULTIPART_DAYS"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setRequiredEnvironment(t)
			t.Setenv(test.envName, test.envValue)

			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), test.errorText) {
				t.Fatalf("Load() error = %v, want %s", err, test.errorText)
			}
		})
	}
}

func TestLoadRejectsMatchingPublicPorts(t *testing.T) {
	setRequiredEnvironment(t)
	t.Setenv("CLIENT_HTTPS_PORT", "8443")
	t.Setenv("ADMIN_HTTPS_PORT", "8443")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "must be different") {
		t.Fatalf("Load() error = %v, want matching port error", err)
	}
}

func setRequiredEnvironment(t *testing.T) {
	t.Helper()

	values := map[string]string{
		"PUBLIC_HOSTNAME":              "chat.example.com",
		"PUBLIC_ASSETS_HOSTNAME":       "public-assets.example.com",
		"PRIVATE_ASSETS_HOSTNAME":      "private-assets.example.com",
		"TEMPORARY_ASSETS_HOSTNAME":    "temporary-assets.example.com",
		"POSTGRES_DB":                  "magic-chat",
		"POSTGRES_USER":                "magic-chat",
		"POSTGRES_PASSWORD":            "test-postgres-password",
		"ADMIN_PASSWORD":               "test-admin-password",
		"AI_ASSISTANT_SECRET":          "test-ai-assistant-secret",
		"AWS_ENDPOINT_URL_S3":          "https://s3.example.com",
		"AWS_REGION":                   "us-east-1",
		"AWS_ACCESS_KEY_ID":            "test-access-key",
		"AWS_SECRET_ACCESS_KEY":        "test-secret-key",
		"PUBLIC_ASSETS_BUCKET":         "magicchat-public",
		"PRIVATE_ASSETS_BUCKET":        "magicchat-private",
		"TEMPORARY_ASSETS_BUCKET":      "magicchat-temporary",
		"S3_BOOTSTRAP_ENABLED":         "false",
		"S3_FORCE_PATH_STYLE":          "false",
		"TEMPORARY_ASSETS_EXPIRE_DAYS": "180",
		"S3_ABORT_MULTIPART_DAYS":      "7",
	}
	for name, value := range values {
		t.Setenv(name, value)
	}
}
