package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	Admin    AdminConfig
	Storage  StorageConfig
	Apps     AppsConfig
}

type ServerConfig struct {
	PublicHostname  string
	ClientHTTPSPort uint16
	AdminHTTPSPort  uint16
}

func (c ServerConfig) ClientOrigin() string {
	return httpsOrigin(c.PublicHostname, c.ClientHTTPSPort)
}

func (c ServerConfig) AdminOrigin() string {
	return httpsOrigin(c.PublicHostname, c.AdminHTTPSPort)
}

type DatabaseConfig struct {
	DSN string
}

type AdminConfig struct {
	Password string
}

type AppsConfig struct {
	AIAssistantSecret string
}

type StorageConfig struct {
	Provider         string
	Endpoint         string
	Region           string
	AccessKeyID      string
	SecretAccessKey  string
	BootstrapEnabled bool
	ForcePathStyle   bool
	Buckets          StorageBucketsConfig
	Lifecycle        StorageLifecycleConfig
	AssetHostnames   StorageAssetHostnamesConfig
}

type StorageAssetHostnamesConfig struct {
	Public    string
	Private   string
	Temporary string
}

type StorageBucketsConfig struct {
	Public    string
	Private   string
	Temporary string
}

type StorageLifecycleConfig struct {
	TemporaryExpireDays int32
	AbortMultipartDays  int32
}

func Load() (Config, error) {
	cfg := Config{}

	database, err := loadDatabaseConfig()
	if err != nil {
		return Config{}, err
	}
	cfg.Database = database
	if cfg.Admin.Password, err = requiredEnv("ADMIN_PASSWORD"); err != nil {
		return Config{}, err
	}
	if cfg.Apps.AIAssistantSecret, err = requiredEnv("AI_ASSISTANT_SECRET"); err != nil {
		return Config{}, err
	}
	storage, err := loadStorageConfig()
	if err != nil {
		return Config{}, err
	}
	cfg.Storage = storage
	if err := loadPublicEndpoints(&cfg); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func loadPublicEndpoints(cfg *Config) error {
	var err error
	if cfg.Server.PublicHostname, err = requiredHostnameEnv("PUBLIC_HOSTNAME"); err != nil {
		return err
	}
	if cfg.Storage.AssetHostnames.Public, err = requiredHostnameEnv("PUBLIC_ASSETS_HOSTNAME"); err != nil {
		return err
	}
	if cfg.Storage.AssetHostnames.Private, err = requiredHostnameEnv("PRIVATE_ASSETS_HOSTNAME"); err != nil {
		return err
	}
	if cfg.Storage.AssetHostnames.Temporary, err = requiredHostnameEnv("TEMPORARY_ASSETS_HOSTNAME"); err != nil {
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

func loadDatabaseConfig() (DatabaseConfig, error) {
	database, err := requiredEnv("POSTGRES_DB")
	if err != nil {
		return DatabaseConfig{}, err
	}
	user, err := requiredEnv("POSTGRES_USER")
	if err != nil {
		return DatabaseConfig{}, err
	}
	password, err := requiredEnv("POSTGRES_PASSWORD")
	if err != nil {
		return DatabaseConfig{}, err
	}
	host := strings.TrimSpace(os.Getenv("POSTGRES_HOST"))
	if host == "" {
		host = "localhost"
	}
	if err := validateHostname("POSTGRES_HOST", host); err != nil {
		return DatabaseConfig{}, err
	}

	dsn := (&url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(user, password),
		Host:     net.JoinHostPort(host, "5432"),
		Path:     "/" + database,
		RawQuery: "sslmode=disable",
	}).String()
	return DatabaseConfig{DSN: dsn}, nil
}

func loadStorageConfig() (StorageConfig, error) {
	cfg := StorageConfig{Provider: "s3"}
	var err error
	if cfg.Endpoint, err = requiredHTTPURLEnv("AWS_ENDPOINT_URL_S3"); err != nil {
		return StorageConfig{}, err
	}
	if cfg.Region, err = requiredEnv("AWS_REGION"); err != nil {
		return StorageConfig{}, err
	}
	if cfg.AccessKeyID, err = requiredEnv("AWS_ACCESS_KEY_ID"); err != nil {
		return StorageConfig{}, err
	}
	if cfg.SecretAccessKey, err = requiredEnv("AWS_SECRET_ACCESS_KEY"); err != nil {
		return StorageConfig{}, err
	}
	if cfg.BootstrapEnabled, err = boolFromEnv("S3_BOOTSTRAP_ENABLED", false); err != nil {
		return StorageConfig{}, err
	}
	if cfg.ForcePathStyle, err = boolFromEnv("S3_FORCE_PATH_STYLE", false); err != nil {
		return StorageConfig{}, err
	}
	if cfg.Buckets.Public, err = requiredEnv("PUBLIC_ASSETS_BUCKET"); err != nil {
		return StorageConfig{}, err
	}
	if cfg.Buckets.Private, err = requiredEnv("PRIVATE_ASSETS_BUCKET"); err != nil {
		return StorageConfig{}, err
	}
	if cfg.Buckets.Temporary, err = requiredEnv("TEMPORARY_ASSETS_BUCKET"); err != nil {
		return StorageConfig{}, err
	}
	if cfg.Lifecycle.TemporaryExpireDays, err = positiveInt32FromEnv("TEMPORARY_ASSETS_EXPIRE_DAYS", 180); err != nil {
		return StorageConfig{}, err
	}
	if cfg.Lifecycle.AbortMultipartDays, err = positiveInt32FromEnv("S3_ABORT_MULTIPART_DAYS", 7); err != nil {
		return StorageConfig{}, err
	}

	return cfg, nil
}

func requiredEnv(name string) (string, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}

func requiredHostnameEnv(name string) (string, error) {
	value, err := requiredEnv(name)
	if err != nil {
		return "", err
	}
	if err := validateHostname(name, value); err != nil {
		return "", err
	}
	return value, nil
}

func validateHostname(name string, value string) error {
	if strings.Contains(value, "://") || strings.ContainsAny(value, "/?#:\t\r\n ") {
		return fmt.Errorf("%s must be a hostname without scheme, port, or path", name)
	}
	return nil
}

func requiredHTTPURLEnv(name string) (string, error) {
	value, err := requiredEnv(name)
	if err != nil {
		return "", err
	}
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("%s must be an HTTP(S) URL without query or fragment", name)
	}
	return strings.TrimRight(value, "/"), nil
}

func httpsPortFromEnv(name string, defaultPort uint16) (uint16, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return defaultPort, nil
	}
	port, err := strconv.ParseUint(value, 10, 16)
	if err != nil || port == 0 {
		return 0, fmt.Errorf("%s must be an integer between 1 and 65535", name)
	}
	return uint16(port), nil
}

func boolFromEnv(name string, defaultValue bool) (bool, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return defaultValue, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("%s must be true or false", name)
	}
	return parsed, nil
}

func positiveInt32FromEnv(name string, defaultValue int32) (int32, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return defaultValue, nil
	}
	parsed, err := strconv.ParseInt(value, 10, 32)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return int32(parsed), nil
}

func httpsOrigin(hostname string, port uint16) string {
	host := hostname
	if port != 443 {
		host = net.JoinHostPort(hostname, strconv.FormatUint(uint64(port), 10))
	}
	return "https://" + host
}
