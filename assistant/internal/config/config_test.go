package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadFromEnvUsesDefaults(t *testing.T) {
	cfg, err := LoadFromEnv(func(key string) string {
		switch key {
		case "AI_ASSISTANT_SECRET":
			return "secret"
		case "MYGOD_LLM_BASE_URL":
			return "https://api.example.com/v1"
		case "MYGOD_LLM_API_KEY":
			return "llm-api-key"
		case "MYGOD_LLM_MODEL_NAME":
			return "claude-sonnet-4"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if cfg.AppID != DefaultAppID {
		t.Fatalf("AppID = %q, want %q", cfg.AppID, DefaultAppID)
	}
	if cfg.AppSecret != "secret" {
		t.Fatalf("AppSecret = %q, want secret", cfg.AppSecret)
	}
	if cfg.WebSocketURL != DefaultWebSocketURL {
		t.Fatalf("WebSocketURL = %q, want %q", cfg.WebSocketURL, DefaultWebSocketURL)
	}
	if cfg.Agent.MaxTurns != DefaultAgentMaxTurns {
		t.Fatalf("Agent.MaxTurns = %d, want %d", cfg.Agent.MaxTurns, DefaultAgentMaxTurns)
	}
}

func TestLoadFromEnvReadsExplicitValues(t *testing.T) {
	cfg, err := LoadFromEnv(func(key string) string {
		switch key {
		case "MYGOD_APP_ID":
			return "app-id"
		case "AI_ASSISTANT_SECRET":
			return "app-secret"
		case "MYGOD_WS_URL":
			return "wss://mygod.example.com/api/app/ws"
		case "MYGOD_LLM_BASE_URL":
			return " https://api.example.com/v1 "
		case "MYGOD_LLM_API_KEY":
			return " llm-api-key "
		case "MYGOD_LLM_MODEL_NAME":
			return " claude-sonnet-4 "
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if cfg.AppID != "app-id" {
		t.Fatalf("AppID = %q, want app-id", cfg.AppID)
	}
	if cfg.AppSecret != "app-secret" {
		t.Fatalf("AppSecret = %q, want app-secret", cfg.AppSecret)
	}
	if cfg.WebSocketURL != "wss://mygod.example.com/api/app/ws" {
		t.Fatalf("WebSocketURL = %q, want wss://mygod.example.com/api/app/ws", cfg.WebSocketURL)
	}
	if cfg.LLM.BaseURL != "https://api.example.com/v1" {
		t.Fatalf("LLM.BaseURL = %q, want https://api.example.com/v1", cfg.LLM.BaseURL)
	}
	if cfg.LLM.APIKey != "llm-api-key" {
		t.Fatalf("LLM.APIKey = %q, want llm-api-key", cfg.LLM.APIKey)
	}
	if cfg.LLM.ModelName != "claude-sonnet-4" {
		t.Fatalf("LLM.ModelName = %q, want claude-sonnet-4", cfg.LLM.ModelName)
	}
}

func TestLoadFromFileReadsAssistantAndLLMConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(`
app:
  id: "assistant-app-id"
  secret: "assistant-secret"
  websocket_url: "wss://mygod.example.com/api/app/ws"

llm:
  base_url: "https://api.example.com/v1"
  api_key: "llm-api-key"
  model_name: "claude-sonnet-4"

agent:
  max_turns: 12

mcp:
  servers:
    - name: "main"
      url: "https://mcp.example.com/mcp"
      headers:
        Authorization: "Bearer mcp-api-key"
    - name: "internal_tools"
      url: "http://127.0.0.1:3000/mcp"
`), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	cfg, err := LoadFromFile(path, func(string) string { return "" })
	if err != nil {
		t.Fatalf("LoadFromFile() error = %v", err)
	}
	if cfg.AppID != "assistant-app-id" {
		t.Fatalf("AppID = %q, want assistant-app-id", cfg.AppID)
	}
	if cfg.AppSecret != "assistant-secret" {
		t.Fatalf("AppSecret = %q, want assistant-secret", cfg.AppSecret)
	}
	if cfg.WebSocketURL != "wss://mygod.example.com/api/app/ws" {
		t.Fatalf("WebSocketURL = %q, want wss://mygod.example.com/api/app/ws", cfg.WebSocketURL)
	}
	if cfg.LLM.BaseURL != "https://api.example.com/v1" {
		t.Fatalf("LLM.BaseURL = %q, want https://api.example.com/v1", cfg.LLM.BaseURL)
	}
	if cfg.LLM.APIKey != "llm-api-key" {
		t.Fatalf("LLM.APIKey = %q, want llm-api-key", cfg.LLM.APIKey)
	}
	if cfg.LLM.ModelName != "claude-sonnet-4" {
		t.Fatalf("LLM.ModelName = %q, want claude-sonnet-4", cfg.LLM.ModelName)
	}
	if cfg.Agent.MaxTurns != 12 {
		t.Fatalf("Agent.MaxTurns = %d, want 12", cfg.Agent.MaxTurns)
	}
	if len(cfg.MCP.Servers) != 2 {
		t.Fatalf("MCP server count = %d, want 2", len(cfg.MCP.Servers))
	}
	if cfg.MCP.Servers[0].Name != "main" {
		t.Fatalf("first MCP server name = %q, want main", cfg.MCP.Servers[0].Name)
	}
	if cfg.MCP.Servers[0].URL != "https://mcp.example.com/mcp" {
		t.Fatalf("first MCP server URL = %q, want https://mcp.example.com/mcp", cfg.MCP.Servers[0].URL)
	}
	if cfg.MCP.Servers[0].Headers["Authorization"] != "Bearer mcp-api-key" {
		t.Fatalf("first MCP Authorization header = %q, want bearer token", cfg.MCP.Servers[0].Headers["Authorization"])
	}
	if cfg.MCP.Servers[1].Name != "internal_tools" {
		t.Fatalf("second MCP server name = %q, want internal_tools", cfg.MCP.Servers[1].Name)
	}
}

func TestLoadFromFileAllowsEnvOverrides(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(`
app:
  id: "assistant-app-id"
  secret: "file-secret"
  websocket_url: "ws://server:20080/api/app/ws"

llm:
  base_url: "https://file.example.com/v1"
  api_key: "file-api-key"
  model_name: "file-model"
`), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	cfg, err := LoadFromFile(path, func(key string) string {
		switch key {
		case "AI_ASSISTANT_SECRET":
			return "env-secret"
		case "MYGOD_LLM_BASE_URL":
			return "https://env.example.com/v1"
		case "MYGOD_LLM_API_KEY":
			return "env-api-key"
		case "MYGOD_LLM_MODEL_NAME":
			return "env-model"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatalf("LoadFromFile() error = %v", err)
	}
	if cfg.AppSecret != "env-secret" {
		t.Fatalf("AppSecret = %q, want env-secret", cfg.AppSecret)
	}
	if cfg.LLM.BaseURL != "https://env.example.com/v1" {
		t.Fatalf("LLM.BaseURL = %q, want https://env.example.com/v1", cfg.LLM.BaseURL)
	}
	if cfg.LLM.APIKey != "env-api-key" {
		t.Fatalf("LLM.APIKey = %q, want env-api-key", cfg.LLM.APIKey)
	}
	if cfg.LLM.ModelName != "env-model" {
		t.Fatalf("LLM.ModelName = %q, want env-model", cfg.LLM.ModelName)
	}
}

func TestLoadReadsConfigPathFromEnv(t *testing.T) {
	path := filepath.Join(t.TempDir(), "assistant.yaml")
	if err := os.WriteFile(path, []byte(`
app:
  secret: "assistant-secret"

llm:
  base_url: "https://api.example.com/v1"
  api_key: "llm-api-key"
  model_name: "claude-sonnet-4"
`), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}
	t.Setenv("CONFIG", path)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.AppSecret != "assistant-secret" {
		t.Fatalf("AppSecret = %q, want assistant-secret", cfg.AppSecret)
	}
	if cfg.AppID != DefaultAppID {
		t.Fatalf("AppID = %q, want %s", cfg.AppID, DefaultAppID)
	}
	if cfg.WebSocketURL != DefaultWebSocketURL {
		t.Fatalf("WebSocketURL = %q, want %s", cfg.WebSocketURL, DefaultWebSocketURL)
	}
}

func TestLoadFromEnvReadsAIAssistantSecret(t *testing.T) {
	cfg, err := LoadFromEnv(func(key string) string {
		switch key {
		case "AI_ASSISTANT_SECRET":
			return "ai-assistant-secret"
		case "MYGOD_LLM_BASE_URL":
			return "https://api.example.com/v1"
		case "MYGOD_LLM_API_KEY":
			return "llm-api-key"
		case "MYGOD_LLM_MODEL_NAME":
			return "claude-sonnet-4"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatalf("LoadFromEnv() error = %v", err)
	}
	if cfg.AppSecret != "ai-assistant-secret" {
		t.Fatalf("AppSecret = %q, want ai-assistant-secret", cfg.AppSecret)
	}
}

func TestLoadFromEnvRejectsMissingSecret(t *testing.T) {
	_, err := LoadFromEnv(func(string) string { return "" })
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want missing secret error")
	}
}

func TestLoadFromEnvRejectsInvalidWebSocketURL(t *testing.T) {
	_, err := LoadFromEnv(func(key string) string {
		switch key {
		case "AI_ASSISTANT_SECRET":
			return "app-secret"
		case "MYGOD_WS_URL":
			return "https://mygod.example.com/api/app/ws"
		default:
			return ""
		}
	})
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want invalid websocket URL error")
	}
}

func TestLoadFromEnvRejectsMissingLLMConfig(t *testing.T) {
	_, err := LoadFromEnv(func(key string) string {
		if key == "AI_ASSISTANT_SECRET" {
			return "app-secret"
		}

		return ""
	})
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want missing LLM config error")
	}
}

func TestLoadFromEnvRejectsPartialLLMConfig(t *testing.T) {
	_, err := LoadFromEnv(func(key string) string {
		switch key {
		case "AI_ASSISTANT_SECRET":
			return "app-secret"
		case "MYGOD_LLM_BASE_URL":
			return "https://api.example.com/v1"
		case "MYGOD_LLM_MODEL_NAME":
			return "claude-sonnet-4"
		default:
			return ""
		}
	})
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want partial LLM config error")
	}
}

func TestLoadFromEnvRejectsInvalidLLMBaseURL(t *testing.T) {
	_, err := LoadFromEnv(func(key string) string {
		switch key {
		case "AI_ASSISTANT_SECRET":
			return "app-secret"
		case "MYGOD_LLM_BASE_URL":
			return "ws://api.example.com/v1"
		case "MYGOD_LLM_API_KEY":
			return "llm-api-key"
		case "MYGOD_LLM_MODEL_NAME":
			return "claude-sonnet-4"
		default:
			return ""
		}
	})
	if err == nil {
		t.Fatal("LoadFromEnv() error = nil, want invalid LLM base URL error")
	}
}

func TestLoadFromFileRejectsInvalidMCPServerName(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(`
app:
  secret: "assistant-secret"

llm:
  base_url: "https://api.example.com/v1"
  api_key: "llm-api-key"
  model_name: "claude-sonnet-4"

mcp:
  servers:
    - name: "main tools"
      url: "https://mcp.example.com/mcp"
`), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	if _, err := LoadFromFile(path, func(string) string { return "" }); err == nil {
		t.Fatal("LoadFromFile() error = nil, want invalid MCP server name error")
	}
}

func TestLoadFromFileRejectsInvalidMCPServerURL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(`
app:
  secret: "assistant-secret"

llm:
  base_url: "https://api.example.com/v1"
  api_key: "llm-api-key"
  model_name: "claude-sonnet-4"

mcp:
  servers:
    - name: "main"
      url: "ws://mcp.example.com/mcp"
`), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	if _, err := LoadFromFile(path, func(string) string { return "" }); err == nil {
		t.Fatal("LoadFromFile() error = nil, want invalid MCP server URL error")
	}
}
