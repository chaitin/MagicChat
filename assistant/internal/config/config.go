package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

const (
	DefaultAgentMaxTurns    = 50
	DefaultAgentMaxSessions = 1000
	AIAssistantAppID        = "00000000-0000-0000-0000-000000000001"
	mcpGatewayName          = "baizhi_gateway"
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
	LogModelContent bool
	MaxSessions     int
	MaxTurns        int
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

func Load() (Config, error) {
	return LoadFromEnv(os.Getenv)
}

func LoadFromEnv(getenv func(string) string) (Config, error) {
	appSecret, err := requiredEnv(getenv, "AI_ASSISTANT_SECRET")
	if err != nil {
		return Config{}, err
	}
	webSocketURL, err := requiredEnv(getenv, "ASSISTANT_WEBSOCKET_URL")
	if err != nil {
		return Config{}, err
	}
	if err := validateWebSocketURL(webSocketURL, "ASSISTANT_WEBSOCKET_URL"); err != nil {
		return Config{}, err
	}
	maxTurns, err := positiveIntFromEnv(getenv, "AGENT_MAX_TURNS", DefaultAgentMaxTurns)
	if err != nil {
		return Config{}, err
	}
	maxSessions, err := positiveIntFromEnv(getenv, "AGENT_MAX_SESSIONS", DefaultAgentMaxSessions)
	if err != nil {
		return Config{}, err
	}
	logModelContent := false
	if value := strings.TrimSpace(getenv("ASSISTANT_LOG_MODEL_CONTENT")); value != "" {
		logModelContent, err = strconv.ParseBool(value)
		if err != nil {
			return Config{}, fmt.Errorf("ASSISTANT_LOG_MODEL_CONTENT must be a boolean: %w", err)
		}
	}

	llmBaseURL, err := requiredEnv(getenv, "LLM_BASE_URL")
	if err != nil {
		return Config{}, err
	}
	if err := validateHTTPURL(llmBaseURL, "LLM_BASE_URL"); err != nil {
		return Config{}, err
	}
	llmAPIKey, err := requiredEnv(getenv, "LLM_API_KEY")
	if err != nil {
		return Config{}, err
	}
	llmModelName, err := requiredEnv(getenv, "LLM_MODEL_NAME")
	if err != nil {
		return Config{}, err
	}

	mcpGatewayURL, err := requiredEnv(getenv, "MCP_GATEWAY_URL")
	if err != nil {
		return Config{}, err
	}
	if err := validateHTTPURL(mcpGatewayURL, "MCP_GATEWAY_URL"); err != nil {
		return Config{}, err
	}
	mcpGatewayKey, err := requiredEnv(getenv, "MCP_GATEWAY_KEY")
	if err != nil {
		return Config{}, err
	}

	return Config{
		Agent:        AgentConfig{LogModelContent: logModelContent, MaxSessions: maxSessions, MaxTurns: maxTurns},
		AppID:        AIAssistantAppID,
		AppSecret:    appSecret,
		WebSocketURL: webSocketURL,
		LLM: LLMConfig{
			BaseURL:   strings.TrimRight(llmBaseURL, "/"),
			APIKey:    llmAPIKey,
			ModelName: llmModelName,
		},
		MCP: MCPConfig{Servers: []MCPServerConfig{
			{
				Name: mcpGatewayName,
				URL:  strings.TrimRight(mcpGatewayURL, "/"),
				Headers: map[string]string{
					"Authorization": "Bearer " + mcpGatewayKey,
				},
			},
		}},
	}, nil
}

func requiredEnv(getenv func(string) string, name string) (string, error) {
	value := strings.TrimSpace(getenv(name))
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}

func positiveIntFromEnv(getenv func(string) string, name string, defaultValue int) (int, error) {
	value := strings.TrimSpace(getenv(name))
	if value == "" {
		return defaultValue, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return parsed, nil
}

func validateWebSocketURL(value string, name string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "ws" && parsed.Scheme != "wss") {
		return fmt.Errorf("%s must be a ws or wss URL", name)
	}
	return nil
}

func validateHTTPURL(value string, name string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("%s must be an http or https URL", name)
	}
	return nil
}
