package config

import (
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	DefaultConfigPath    = "config.yaml"
	DefaultAgentMaxTurns = 20
	DefaultAppID         = "00000000-0000-0000-0000-000000000001"
	DefaultWebSocketURL  = "ws://server:20080/api/app/ws"
)

type Config struct {
	Agent        AgentConfig
	AppID        string
	AppSecret    string
	WebSocketURL string
	LLM          LLMConfig
	MCP          MCPConfig
}

type AgentConfig struct {
	MaxTurns int
}

type LLMConfig struct {
	BaseURL   string
	APIKey    string
	ModelName string
}

type MCPConfig struct {
	Servers []MCPServerConfig
}

type MCPServerConfig struct {
	Headers map[string]string
	Name    string
	URL     string
}

type fileConfig struct {
	Agent agentFileConfig `yaml:"agent"`
	App   appFileConfig   `yaml:"app"`
	LLM   llmFileConfig   `yaml:"llm"`
	MCP   mcpFileConfig   `yaml:"mcp"`
}

type agentFileConfig struct {
	MaxTurns int `yaml:"max_turns"`
}

type appFileConfig struct {
	ID           string `yaml:"id"`
	Secret       string `yaml:"secret"`
	WebSocketURL string `yaml:"websocket_url"`
}

type llmFileConfig struct {
	BaseURL   string `yaml:"base_url"`
	APIKey    string `yaml:"api_key"`
	ModelName string `yaml:"model_name"`
}

type mcpFileConfig struct {
	Servers []mcpServerFileConfig `yaml:"servers"`
}

type mcpServerFileConfig struct {
	Headers map[string]string `yaml:"headers"`
	Name    string            `yaml:"name"`
	URL     string            `yaml:"url"`
}

var mcpServerNamePattern = regexp.MustCompile(`^[A-Za-z0-9_]+$`)

func Load() (Config, error) {
	path := strings.TrimSpace(os.Getenv("CONFIG"))
	if path == "" {
		path = DefaultConfigPath
	}

	return LoadFromFile(path, os.Getenv)
}

func LoadFromFile(path string, getenv func(string) string) (Config, error) {
	if strings.TrimSpace(path) == "" {
		path = DefaultConfigPath
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read config file: %w", err)
	}

	var file fileConfig
	if err := yaml.Unmarshal(content, &file); err != nil {
		return Config{}, fmt.Errorf("parse config file: %w", err)
	}

	return normalizeConfig(Config{
		Agent: AgentConfig{
			MaxTurns: file.Agent.MaxTurns,
		},
		AppID:        file.App.ID,
		AppSecret:    file.App.Secret,
		WebSocketURL: file.App.WebSocketURL,
		LLM: LLMConfig{
			BaseURL:   file.LLM.BaseURL,
			APIKey:    file.LLM.APIKey,
			ModelName: file.LLM.ModelName,
		},
		MCP: MCPConfig{
			Servers: newMCPServerConfigs(file.MCP.Servers),
		},
	}, getenv)
}

func LoadFromEnv(getenv func(string) string) (Config, error) {
	return normalizeConfig(Config{}, getenv)
}

func normalizeConfig(cfg Config, getenv func(string) string) (Config, error) {
	cfg.Agent = normalizeAgentConfig(cfg.Agent)
	cfg.AppID = strings.TrimSpace(cfg.AppID)
	cfg.AppSecret = strings.TrimSpace(cfg.AppSecret)
	cfg.WebSocketURL = strings.TrimSpace(cfg.WebSocketURL)
	cfg.LLM = trimLLMConfig(cfg.LLM)
	cfg.MCP = trimMCPConfig(cfg.MCP)

	if value := strings.TrimSpace(getenv("MYGOD_APP_ID")); value != "" {
		cfg.AppID = value
	}
	if value := firstNonEmpty(getenv, "MYGOD_APP_SECRET", "MYGOD_AI_ASSISTANT_SECRET", "APP_SECRET"); value != "" {
		cfg.AppSecret = value
	}
	if value := strings.TrimSpace(getenv("MYGOD_WS_URL")); value != "" {
		cfg.WebSocketURL = value
	}

	if value := strings.TrimSpace(getenv("MYGOD_LLM_BASE_URL")); value != "" {
		cfg.LLM.BaseURL = value
	}
	if value := strings.TrimSpace(getenv("MYGOD_LLM_API_KEY")); value != "" {
		cfg.LLM.APIKey = value
	}
	if value := strings.TrimSpace(getenv("MYGOD_LLM_MODEL_NAME")); value != "" {
		cfg.LLM.ModelName = value
	}

	if cfg.AppID == "" {
		cfg.AppID = DefaultAppID
	}
	if cfg.AppSecret == "" {
		return Config{}, fmt.Errorf("app.secret is required")
	}
	if cfg.WebSocketURL == "" {
		cfg.WebSocketURL = DefaultWebSocketURL
	}
	if err := validateWebSocketURL(cfg.WebSocketURL, "app.websocket_url"); err != nil {
		return Config{}, err
	}
	if err := validateLLMConfig(cfg.LLM); err != nil {
		return Config{}, err
	}
	if err := validateAgentConfig(cfg.Agent); err != nil {
		return Config{}, err
	}
	if err := validateMCPConfig(cfg.MCP); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func newMCPServerConfigs(raw []mcpServerFileConfig) []MCPServerConfig {
	servers := make([]MCPServerConfig, 0, len(raw))
	for _, server := range raw {
		servers = append(servers, MCPServerConfig{
			Headers: server.Headers,
			Name:    server.Name,
			URL:     server.URL,
		})
	}

	return servers
}

func firstNonEmpty(getenv func(string) string, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(getenv(name)); value != "" {
			return value
		}
	}

	return ""
}

func trimLLMConfig(cfg LLMConfig) LLMConfig {
	return LLMConfig{
		BaseURL:   strings.TrimSpace(cfg.BaseURL),
		APIKey:    strings.TrimSpace(cfg.APIKey),
		ModelName: strings.TrimSpace(cfg.ModelName),
	}
}

func normalizeAgentConfig(cfg AgentConfig) AgentConfig {
	if cfg.MaxTurns == 0 {
		cfg.MaxTurns = DefaultAgentMaxTurns
	}

	return cfg
}

func trimMCPConfig(cfg MCPConfig) MCPConfig {
	servers := make([]MCPServerConfig, 0, len(cfg.Servers))
	for _, server := range cfg.Servers {
		servers = append(servers, MCPServerConfig{
			Headers: cloneStringMap(server.Headers),
			Name:    strings.TrimSpace(server.Name),
			URL:     strings.TrimSpace(server.URL),
		})
	}

	return MCPConfig{Servers: servers}
}

func cloneStringMap(values map[string]string) map[string]string {
	if values == nil {
		return nil
	}

	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}

	return cloned
}

func validateAgentConfig(cfg AgentConfig) error {
	if cfg.MaxTurns <= 0 {
		return fmt.Errorf("agent.max_turns must be a positive integer")
	}

	return nil
}

func validateMCPConfig(cfg MCPConfig) error {
	seen := map[string]struct{}{}
	for index, server := range cfg.Servers {
		name := server.Name
		if name == "" {
			return fmt.Errorf("mcp.servers[%d].name is required", index)
		}
		if !mcpServerNamePattern.MatchString(name) {
			return fmt.Errorf("mcp.servers[%d].name must contain only letters, numbers, and underscores", index)
		}
		if _, ok := seen[name]; ok {
			return fmt.Errorf("mcp.servers[%d].name is duplicated", index)
		}
		seen[name] = struct{}{}

		if server.URL == "" {
			return fmt.Errorf("mcp.servers[%d].url is required", index)
		}
		if err := validateHTTPURL(server.URL, fmt.Sprintf("mcp.servers[%d].url", index)); err != nil {
			return err
		}
		for headerName := range server.Headers {
			if strings.TrimSpace(headerName) == "" {
				return fmt.Errorf("mcp.servers[%d].headers contains an empty header name", index)
			}
		}
	}

	return nil
}

func validateLLMConfig(cfg LLMConfig) error {
	if cfg.BaseURL == "" || cfg.APIKey == "" || cfg.ModelName == "" {
		return fmt.Errorf("llm.base_url, llm.api_key, and llm.model_name are required")
	}
	if err := validateHTTPURL(cfg.BaseURL, "llm.base_url"); err != nil {
		return err
	}

	return nil
}

func validateWebSocketURL(value string, name string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("%s must be a ws or wss URL", name)
	}
	if parsed.Scheme != "ws" && parsed.Scheme != "wss" {
		return fmt.Errorf("%s must be a ws or wss URL", name)
	}

	return nil
}

func validateHTTPURL(value string, name string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("%s must be an http or https URL", name)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("%s must be an http or https URL", name)
	}

	return nil
}
