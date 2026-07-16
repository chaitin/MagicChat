package config

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	Admin    AdminConfig    `yaml:"admin"`
	Storage  StorageConfig  `yaml:"storage"`
	Apps     AppsConfig     `yaml:"apps"`
}

type ServerConfig struct {
	Addr            string `yaml:"addr"`
	PublicHostname  string `yaml:"-"`
	ClientHTTPSPort uint16 `yaml:"-"`
	AdminHTTPSPort  uint16 `yaml:"-"`
}

func (c ServerConfig) ClientOrigin() string {
	return httpsOrigin(c.PublicHostname, c.ClientHTTPSPort)
}

func (c ServerConfig) AdminOrigin() string {
	return httpsOrigin(c.PublicHostname, c.AdminHTTPSPort)
}

type DatabaseConfig struct {
	DSN string `yaml:"dsn"`
}

type AdminConfig struct {
	Password string `yaml:"password"`
}

type AppsConfig struct {
	AIAssistantSecret string `yaml:"ai_assistant_secret"`
}

type StorageConfig struct {
	Provider        string                 `yaml:"provider"`
	Endpoint        string                 `yaml:"endpoint"`
	Region          string                 `yaml:"region"`
	AccessKeyID     string                 `yaml:"access_key_id"`
	SecretAccessKey string                 `yaml:"secret_access_key"`
	ForcePathStyle  bool                   `yaml:"force_path_style"`
	Buckets         StorageBucketsConfig   `yaml:"buckets"`
	Lifecycle       StorageLifecycleConfig `yaml:"lifecycle"`
	AssetsHostname  string                 `yaml:"-"`
}

type StorageBucketsConfig struct {
	Public    string `yaml:"public"`
	Private   string `yaml:"private"`
	Temporary string `yaml:"temporary"`
}

type StorageLifecycleConfig struct {
	TemporaryExpireDays int32 `yaml:"temporary_expire_days"`
	AbortMultipartDays  int32 `yaml:"abort_multipart_days"`
}

func Load() (Config, error) {
	path := os.Getenv("CONFIG")
	if strings.TrimSpace(path) == "" {
		path = "config.yaml"
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read config file: %w", err)
	}

	cfg := Config{
		Server: ServerConfig{Addr: ":20080"},
	}
	if err := yaml.Unmarshal(content, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse config file: %w", err)
	}

	if strings.TrimSpace(cfg.Server.Addr) == "" {
		cfg.Server.Addr = ":20080"
	}
	if strings.TrimSpace(cfg.Database.DSN) == "" {
		return Config{}, fmt.Errorf("database.dsn is required")
	}
	if strings.TrimSpace(cfg.Admin.Password) == "" {
		return Config{}, fmt.Errorf("admin.password is required")
	}
	if err := normalizePublicEndpoints(&cfg); err != nil {
		return Config{}, err
	}
	if err := normalizeAppsConfig(&cfg.Apps); err != nil {
		return Config{}, err
	}
	if err := normalizeStorageConfig(&cfg.Storage); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func normalizePublicEndpoints(cfg *Config) error {
	cfg.Server.PublicHostname = strings.TrimSpace(firstNonEmptyEnv("PUBLIC_HOSTNAME"))
	cfg.Storage.AssetsHostname = strings.TrimSpace(firstNonEmptyEnv("ASSETS_HOSTNAME"))

	if err := validateHostnameEnv("PUBLIC_HOSTNAME", cfg.Server.PublicHostname); err != nil {
		return err
	}
	if err := validateHostnameEnv("ASSETS_HOSTNAME", cfg.Storage.AssetsHostname); err != nil {
		return err
	}

	clientPort, err := httpsPortFromEnv("CLIENT_HTTPS_PORT", 443)
	if err != nil {
		return err
	}
	adminPort, err := httpsPortFromEnv("ADMIN_HTTPS_PORT", 1443)
	if err != nil {
		return err
	}
	if clientPort == adminPort {
		return fmt.Errorf("CLIENT_HTTPS_PORT and ADMIN_HTTPS_PORT must be different")
	}
	cfg.Server.ClientHTTPSPort = clientPort
	cfg.Server.AdminHTTPSPort = adminPort

	return nil
}

func validateHostnameEnv(name string, value string) error {
	if value == "" {
		return fmt.Errorf("%s is required", name)
	}
	if strings.Contains(value, "://") || strings.ContainsAny(value, "/?#:\t\r\n ") {
		return fmt.Errorf("%s must be a hostname without scheme, port, or path", name)
	}

	return nil
}

func httpsPortFromEnv(name string, defaultPort uint16) (uint16, error) {
	value := strings.TrimSpace(firstNonEmptyEnv(name))
	if value == "" {
		return defaultPort, nil
	}
	port, err := strconv.ParseUint(value, 10, 16)
	if err != nil || port == 0 {
		return 0, fmt.Errorf("%s must be an integer between 1 and 65535", name)
	}
	return uint16(port), nil
}

func httpsOrigin(hostname string, port uint16) string {
	host := hostname
	if port != 443 {
		host = net.JoinHostPort(hostname, strconv.FormatUint(uint64(port), 10))
	}
	return "https://" + host
}

func normalizeAppsConfig(cfg *AppsConfig) error {
	if value := firstNonEmptyEnv("AI_ASSISTANT_SECRET"); value != "" {
		cfg.AIAssistantSecret = value
	}
	cfg.AIAssistantSecret = strings.TrimSpace(cfg.AIAssistantSecret)
	if cfg.AIAssistantSecret == "" {
		return fmt.Errorf("apps.ai_assistant_secret is required")
	}

	return nil
}

func normalizeStorageConfig(cfg *StorageConfig) error {
	cfg.Provider = strings.ToLower(strings.TrimSpace(cfg.Provider))
	if cfg.Provider == "" {
		return nil
	}
	if cfg.Provider != "s3" {
		return fmt.Errorf("storage.provider must be s3")
	}

	cfg.Endpoint = strings.TrimSpace(cfg.Endpoint)
	cfg.Region = strings.TrimSpace(cfg.Region)
	cfg.AccessKeyID = strings.TrimSpace(cfg.AccessKeyID)
	cfg.SecretAccessKey = strings.TrimSpace(cfg.SecretAccessKey)
	cfg.Buckets.Public = strings.TrimSpace(cfg.Buckets.Public)
	cfg.Buckets.Private = strings.TrimSpace(cfg.Buckets.Private)
	cfg.Buckets.Temporary = strings.TrimSpace(cfg.Buckets.Temporary)

	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}
	if cfg.AccessKeyID == "" {
		cfg.AccessKeyID = firstNonEmptyEnv("RUSTFS_ACCESS_KEY", "AWS_ACCESS_KEY_ID")
	}
	if cfg.SecretAccessKey == "" {
		cfg.SecretAccessKey = firstNonEmptyEnv("RUSTFS_SECRET_KEY", "AWS_SECRET_ACCESS_KEY")
	}
	if cfg.AccessKeyID == "" {
		return fmt.Errorf("storage.access_key_id is required")
	}
	if cfg.SecretAccessKey == "" {
		return fmt.Errorf("storage.secret_access_key is required")
	}
	if cfg.Buckets.Public == "" {
		return fmt.Errorf("storage.buckets.public is required")
	}
	if cfg.Buckets.Private == "" {
		return fmt.Errorf("storage.buckets.private is required")
	}
	if cfg.Buckets.Temporary == "" {
		return fmt.Errorf("storage.buckets.temporary is required")
	}
	if cfg.Lifecycle.TemporaryExpireDays <= 0 {
		cfg.Lifecycle.TemporaryExpireDays = 180
	}
	if cfg.Lifecycle.AbortMultipartDays <= 0 {
		cfg.Lifecycle.AbortMultipartDays = 7
	}

	return nil
}

func firstNonEmptyEnv(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}

	return ""
}
