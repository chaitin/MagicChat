package config

import (
	"strings"
	"testing"
)

func TestLoadFromEnvReadsConfiguration(t *testing.T) {
	values := requiredEnvironment()
	values["ASSISTANT_WEBSOCKET_URL"] = " wss://chat.example.com/api/app/ws "
	values["AGENT_MAX_TURNS"] = "75"
	values["AGENT_MAX_SESSIONS"] = "321"
	values["LLM_BASE_URL"] = " https://api.example.com/v1/ "
	values["LLM_MODEL_NAME"] = " model-name "
	values["MCP_GATEWAY_URL"] = " https://mcp.example.com/mcp/ "

	cfg, err := LoadFromEnv(mapGetenv(values))
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if cfg.AppID != AIAssistantAppID {
		t.Fatalf("AppID = %q, want %q", cfg.AppID, AIAssistantAppID)
	}
	if cfg.AppSecret != "assistant-secret" {
		t.Fatalf("AppSecret = %q", cfg.AppSecret)
	}
	if cfg.WebSocketURL != "wss://chat.example.com/api/app/ws" {
		t.Fatalf("WebSocketURL = %q", cfg.WebSocketURL)
	}
	if cfg.Agent.MaxTurns != 75 {
		t.Fatalf("Agent.MaxTurns = %d, want 75", cfg.Agent.MaxTurns)
	}
	if cfg.Agent.MaxSessions != 321 {
		t.Fatalf("Agent.MaxSessions = %d, want 321", cfg.Agent.MaxSessions)
	}
	if cfg.LLM.BaseURL != "https://api.example.com/v1" || cfg.LLM.APIKey != "llm-api-key" || cfg.LLM.ModelName != "model-name" {
		t.Fatalf("LLM = %#v", cfg.LLM)
	}
	if len(cfg.MCP.Servers) != 1 {
		t.Fatalf("MCP server count = %d, want 1", len(cfg.MCP.Servers))
	}
	server := cfg.MCP.Servers[0]
	if server.Name != mcpGatewayName || server.URL != "https://mcp.example.com/mcp" || server.Headers["Authorization"] != "Bearer mcp-key" {
		t.Fatalf("MCP server = %#v", server)
	}
}

func TestLoadFromEnvDefaultsMaxTurnsToFifty(t *testing.T) {
	values := requiredEnvironment()
	delete(values, "AGENT_MAX_TURNS")

	cfg, err := LoadFromEnv(mapGetenv(values))
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if DefaultAgentMaxTurns != 50 {
		t.Fatalf("DefaultAgentMaxTurns = %d, want 50", DefaultAgentMaxTurns)
	}
	if cfg.Agent.MaxTurns != DefaultAgentMaxTurns {
		t.Fatalf("Agent.MaxTurns = %d, want 50", cfg.Agent.MaxTurns)
	}
}

func TestLoadFromEnvDefaultsMaxSessionsToOneThousand(t *testing.T) {
	values := requiredEnvironment()
	delete(values, "AGENT_MAX_SESSIONS")

	cfg, err := LoadFromEnv(mapGetenv(values))
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if DefaultAgentMaxSessions != 1000 {
		t.Fatalf("DefaultAgentMaxSessions = %d, want 1000", DefaultAgentMaxSessions)
	}
	if cfg.Agent.MaxSessions != DefaultAgentMaxSessions {
		t.Fatalf("Agent.MaxSessions = %d, want 1000", cfg.Agent.MaxSessions)
	}
}

func TestLoadFromEnvControlsModelContentLogging(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  bool
	}{
		{value: "", want: false},
		{value: "false", want: false},
		{value: "true", want: true},
		{value: "1", want: true},
	} {
		values := requiredEnvironment()
		values["ASSISTANT_LOG_MODEL_CONTENT"] = tc.value
		cfg, err := LoadFromEnv(mapGetenv(values))
		if err != nil || cfg.Agent.LogModelContent != tc.want {
			t.Fatalf("value=%q: log model content=%t, err=%v", tc.value, cfg.Agent.LogModelContent, err)
		}
	}
	values := requiredEnvironment()
	values["ASSISTANT_LOG_MODEL_CONTENT"] = "on please"
	if _, err := LoadFromEnv(mapGetenv(values)); err == nil {
		t.Fatal("invalid logging flag must be rejected")
	}
}

func TestLoadReadsProcessEnvironment(t *testing.T) {
	for name, value := range requiredEnvironment() {
		t.Setenv(name, value)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.AppID != AIAssistantAppID || cfg.WebSocketURL != "ws://localhost:20080/api/app/ws" {
		t.Fatalf("Config = %#v", cfg)
	}
}

func TestLoadFromEnvRejectsMissingRequiredEnvironment(t *testing.T) {
	required := []string{
		"AI_ASSISTANT_SECRET",
		"ASSISTANT_WEBSOCKET_URL",
		"LLM_BASE_URL",
		"LLM_API_KEY",
		"LLM_MODEL_NAME",
		"MCP_GATEWAY_URL",
		"MCP_GATEWAY_KEY",
	}

	for _, name := range required {
		t.Run(name, func(t *testing.T) {
			values := requiredEnvironment()
			delete(values, name)

			_, err := LoadFromEnv(mapGetenv(values))
			if err == nil || !strings.Contains(err.Error(), name) {
				t.Fatalf("LoadFromEnv() error = %v, want %s", err, name)
			}
		})
	}
}

func TestLoadFromEnvRejectsInvalidEnvironment(t *testing.T) {
	tests := []struct {
		name      string
		envName   string
		envValue  string
		errorText string
	}{
		{name: "websocket scheme", envName: "ASSISTANT_WEBSOCKET_URL", envValue: "https://chat.example.com/api/app/ws", errorText: "ASSISTANT_WEBSOCKET_URL"},
		{name: "max turns zero", envName: "AGENT_MAX_TURNS", envValue: "0", errorText: "AGENT_MAX_TURNS"},
		{name: "max turns text", envName: "AGENT_MAX_TURNS", envValue: "many", errorText: "AGENT_MAX_TURNS"},
		{name: "max sessions zero", envName: "AGENT_MAX_SESSIONS", envValue: "0", errorText: "AGENT_MAX_SESSIONS"},
		{name: "max sessions text", envName: "AGENT_MAX_SESSIONS", envValue: "many", errorText: "AGENT_MAX_SESSIONS"},
		{name: "llm scheme", envName: "LLM_BASE_URL", envValue: "ws://api.example.com", errorText: "LLM_BASE_URL"},
		{name: "mcp scheme", envName: "MCP_GATEWAY_URL", envValue: "ws://mcp.example.com", errorText: "MCP_GATEWAY_URL"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			values := requiredEnvironment()
			values[test.envName] = test.envValue

			_, err := LoadFromEnv(mapGetenv(values))
			if err == nil || !strings.Contains(err.Error(), test.errorText) {
				t.Fatalf("LoadFromEnv() error = %v, want %s", err, test.errorText)
			}
		})
	}
}

func requiredEnvironment() map[string]string {
	return map[string]string{
		"AI_ASSISTANT_SECRET":     "assistant-secret",
		"ASSISTANT_WEBSOCKET_URL": "ws://localhost:20080/api/app/ws",
		"LLM_BASE_URL":            "https://api.example.com/v1",
		"LLM_API_KEY":             "llm-api-key",
		"LLM_MODEL_NAME":          "model-name",
		"MCP_GATEWAY_URL":         "https://mcp.example.com/mcp",
		"MCP_GATEWAY_KEY":         "mcp-key",
	}
}

func mapGetenv(values map[string]string) func(string) string {
	return func(name string) string {
		return values[name]
	}
}
