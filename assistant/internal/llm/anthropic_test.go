package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"assistant/internal/config"
)

func TestAnthropicClientGenerateUsesMessagesAPI(t *testing.T) {
	var gotPath string
	var gotAPIKey string
	var gotVersion string
	var gotModel string
	var gotMaxTokens int
	var gotEffort string
	var gotThinking json.RawMessage
	var gotSystem string
	var gotRole string
	var gotContent string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAPIKey = r.Header.Get("x-api-key")
		gotVersion = r.Header.Get("anthropic-version")

		var request struct {
			Model        string `json:"model"`
			MaxTokens    int    `json:"max_tokens"`
			OutputConfig struct {
				Effort string `json:"effort"`
			} `json:"output_config"`
			Thinking json.RawMessage `json:"thinking"`
			System   []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"system"`
			Messages []struct {
				Role    string `json:"role"`
				Content []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		gotModel = request.Model
		gotMaxTokens = request.MaxTokens
		gotEffort = request.OutputConfig.Effort
		gotThinking = request.Thinking
		if len(request.System) == 1 {
			gotSystem = request.System[0].Text
		}
		if len(request.Messages) == 1 {
			gotRole = request.Messages[0].Role
			if len(request.Messages[0].Content) == 1 {
				gotContent = request.Messages[0].Content[0].Text
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "msg_test",
			"model": "claude-sonnet",
			"role": "assistant",
			"stop_reason": "end_turn",
			"stop_sequence": null,
			"type": "message",
			"usage": {"input_tokens": 10, "output_tokens": 5},
			"content": [
				{"type": "text", "text": "你好，我是模型回复"}
			]
		}`))
	}))
	defer server.Close()

	client := NewAnthropicClient(config.LLMConfig{
		BaseURL:   server.URL,
		APIKey:    "test-api-key",
		ModelName: "claude-sonnet",
	})
	client.HTTPClient = server.Client()

	reply, err := client.Generate(context.Background(), Request{
		System: "你是 MagicChat 助手",
		Messages: []Message{
			{
				Role:    "user",
				Content: "你好",
			},
		},
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if gotPath != "/v1/messages" {
		t.Fatalf("path = %q, want /v1/messages", gotPath)
	}
	if gotAPIKey != "test-api-key" {
		t.Fatalf("x-api-key = %q, want test-api-key", gotAPIKey)
	}
	if gotVersion != AnthropicVersion {
		t.Fatalf("anthropic-version = %q, want %s", gotVersion, AnthropicVersion)
	}
	if gotModel != "claude-sonnet" {
		t.Fatalf("model = %q, want claude-sonnet", gotModel)
	}
	if gotMaxTokens != 4096 {
		t.Fatalf("max_tokens = %d, want 4096", gotMaxTokens)
	}
	if gotEffort != "low" || len(gotThinking) != 0 {
		t.Fatalf("effort = %q, thinking = %s; want low effort without explicit thinking budget", gotEffort, gotThinking)
	}
	if gotSystem != "你是 MagicChat 助手" {
		t.Fatalf("system = %q, want system prompt", gotSystem)
	}
	if gotRole != "user" {
		t.Fatalf("role = %q, want user", gotRole)
	}
	if gotContent != "你好" {
		t.Fatalf("content = %q, want 你好", gotContent)
	}
	if reply != "你好，我是模型回复" {
		t.Fatalf("reply = %q, want model text", reply)
	}
}

func TestAnthropicClientDoesNotDuplicateV1Path(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "msg_test",
			"model": "claude-sonnet",
			"role": "assistant",
			"stop_reason": "end_turn",
			"stop_sequence": null,
			"type": "message",
			"usage": {"input_tokens": 1, "output_tokens": 1},
			"content":[{"type":"text","text":"ok"}]
		}`))
	}))
	defer server.Close()

	client := NewAnthropicClient(config.LLMConfig{
		BaseURL:   server.URL + "/v1",
		APIKey:    "test-api-key",
		ModelName: "claude-sonnet",
	})
	client.HTTPClient = server.Client()

	if _, err := client.Generate(context.Background(), Request{
		Messages: []Message{{Role: "user", Content: "ping"}},
	}); err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if gotPath != "/v1/messages" {
		t.Fatalf("path = %q, want /v1/messages", gotPath)
	}
}

func TestAnthropicClientCountsCompleteRequestTokens(t *testing.T) {
	var gotPath string
	var gotSystem string
	var gotToolName string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		var request struct {
			System []struct {
				Text string `json:"text"`
			} `json:"system"`
			Tools []struct {
				Name string `json:"name"`
			} `json:"tools"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if len(request.System) == 1 {
			gotSystem = request.System[0].Text
		}
		if len(request.Tools) == 1 {
			gotToolName = request.Tools[0].Name
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"input_tokens":81234}`))
	}))
	defer server.Close()

	client := NewAnthropicClient(config.LLMConfig{
		BaseURL: server.URL, APIKey: "test-api-key", ModelName: "claude-sonnet",
	})
	client.HTTPClient = server.Client()
	count, err := client.CountTokens(context.Background(), Request{
		System:   "系统提示词",
		Messages: []Message{{Role: RoleUser, Content: "你好"}},
		Tools: []Tool{{
			Name: "main__search", Description: "Search documents",
			InputSchema: map[string]any{"type": "object"},
		}},
	})
	if err != nil {
		t.Fatalf("CountTokens() error = %v", err)
	}
	if gotPath != "/v1/messages/count_tokens" || gotSystem != "系统提示词" || gotToolName != "main__search" {
		t.Fatalf("count request path/system/tool = %q/%q/%q", gotPath, gotSystem, gotToolName)
	}
	if count != 81_234 {
		t.Fatalf("count = %d, want 81234", count)
	}
}

func TestAnthropicClientCachesUnsupportedTokenCountingEndpoint(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"type":"error","error":{"type":"not_found_error","message":"not found"}}`))
	}))
	defer server.Close()

	client := NewAnthropicClient(config.LLMConfig{
		BaseURL: server.URL, APIKey: "test-api-key", ModelName: "claude-sonnet",
	})
	client.HTTPClient = server.Client()
	request := Request{Messages: []Message{{Role: RoleUser, Content: "你好"}}}
	for attempt := 0; attempt < 2; attempt++ {
		if _, err := client.CountTokens(context.Background(), request); !errors.Is(err, ErrTokenCountUnsupported) {
			t.Fatalf("CountTokens() error = %v", err)
		}
	}
	if calls != 1 {
		t.Fatalf("count endpoint calls = %d, want one compatibility probe", calls)
	}
}

func TestAnthropicClientCreateMessageSendsToolsAndParsesBlocks(t *testing.T) {
	var gotToolName string
	var gotToolDescription string
	var gotToolPropertyType string
	var gotToolChoice json.RawMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			ToolChoice json.RawMessage `json:"tool_choice"`
			Tools      []struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				InputSchema struct {
					Type       string `json:"type"`
					Properties struct {
						Query struct {
							Type string `json:"type"`
						} `json:"query"`
					} `json:"properties"`
				} `json:"input_schema"`
			} `json:"tools"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		gotToolChoice = request.ToolChoice
		if len(request.Tools) == 1 {
			gotToolName = request.Tools[0].Name
			gotToolDescription = request.Tools[0].Description
			gotToolPropertyType = request.Tools[0].InputSchema.Properties.Query.Type
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "msg_test",
			"model": "claude-sonnet",
			"role": "assistant",
			"stop_reason": "tool_use",
			"stop_sequence": null,
			"type": "message",
			"usage": {"input_tokens": 10, "output_tokens": 5},
			"content": [
				{"type": "thinking", "thinking": "需要先查资料", "signature": "sig-test"},
				{"type": "text", "text": "我先查一下。"},
				{"type": "tool_use", "id": "toolu_1", "name": "main__search", "input": {"query": "mygod"}}
			]
		}`))
	}))
	defer server.Close()

	client := NewAnthropicClient(config.LLMConfig{
		BaseURL:   server.URL,
		APIKey:    "test-api-key",
		ModelName: "claude-sonnet",
	})
	client.HTTPClient = server.Client()

	response, err := client.CreateMessage(context.Background(), Request{
		Messages: []Message{{Role: RoleUser, Blocks: []Block{{Type: BlockTypeText, Text: "查一下"}}}},
		Tools: []Tool{
			{
				Name:        "main__search",
				Description: "Search documents",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"query": map[string]any{"type": "string"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateMessage() error = %v", err)
	}

	if len(gotToolChoice) != 0 {
		t.Fatalf("tool choice = %s, want omitted for thinking compatibility", gotToolChoice)
	}
	if gotToolName != "main__search" {
		t.Fatalf("tool name = %q, want main__search", gotToolName)
	}
	if gotToolDescription != "Search documents" {
		t.Fatalf("tool description = %q, want Search documents", gotToolDescription)
	}
	if gotToolPropertyType != "string" {
		t.Fatalf("tool query type = %q, want string", gotToolPropertyType)
	}
	if len(response.Blocks) != 3 {
		t.Fatalf("block count = %d, want 3", len(response.Blocks))
	}
	if response.StopReason != "tool_use" || response.InputTokens != 10 || response.OutputTokens != 5 {
		t.Fatalf("response metadata = %#v", response)
	}
	if response.Blocks[0].Type != BlockTypeThinking || response.Blocks[0].Thinking != "需要先查资料" || response.Blocks[0].ThinkingSignature != "sig-test" {
		t.Fatalf("thinking block = %+v, want parsed thinking", response.Blocks[0])
	}
	if response.Blocks[1].Type != BlockTypeText || response.Blocks[1].Text != "我先查一下。" {
		t.Fatalf("text block = %+v, want parsed text", response.Blocks[1])
	}
	var toolInput struct {
		Query string `json:"query"`
	}
	if err := json.Unmarshal(response.Blocks[2].ToolInput, &toolInput); err != nil {
		t.Fatalf("unmarshal tool input: %v", err)
	}
	if response.Blocks[2].Type != BlockTypeToolUse || response.Blocks[2].ToolUseID != "toolu_1" || response.Blocks[2].ToolName != "main__search" || toolInput.Query != "mygod" {
		t.Fatalf("tool use block = %+v, want parsed tool use", response.Blocks[2])
	}
}

func TestAnthropicClientCreateMessageSendsToolUseAndToolResultBlocks(t *testing.T) {
	var gotAssistantToolUseID string
	var gotAssistantToolName string
	var gotAssistantToolInput string
	var gotUserToolResultID string
	var gotUserToolResultContent string
	var gotUserToolResultIsError bool

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Messages []struct {
				Role    string `json:"role"`
				Content []struct {
					Type      string          `json:"type"`
					ID        string          `json:"id"`
					Name      string          `json:"name"`
					Input     json.RawMessage `json:"input"`
					ToolUseID string          `json:"tool_use_id"`
					Content   json.RawMessage `json:"content"`
					IsError   bool            `json:"is_error"`
				} `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if len(request.Messages) == 2 {
			gotAssistantToolUseID = request.Messages[0].Content[0].ID
			gotAssistantToolName = request.Messages[0].Content[0].Name
			gotAssistantToolInput = string(request.Messages[0].Content[0].Input)
			gotUserToolResultID = request.Messages[1].Content[0].ToolUseID
			gotUserToolResultContent = decodeTestToolResultContent(t, request.Messages[1].Content[0].Content)
			gotUserToolResultIsError = request.Messages[1].Content[0].IsError
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "msg_test",
			"model": "claude-sonnet",
			"role": "assistant",
			"stop_reason": "end_turn",
			"stop_sequence": null,
			"type": "message",
			"usage": {"input_tokens": 1, "output_tokens": 1},
			"content":[{"type":"text","text":"ok"}]
		}`))
	}))
	defer server.Close()

	client := NewAnthropicClient(config.LLMConfig{
		BaseURL:   server.URL,
		APIKey:    "test-api-key",
		ModelName: "claude-sonnet",
	})
	client.HTTPClient = server.Client()

	_, err := client.CreateMessage(context.Background(), Request{
		Messages: []Message{
			{
				Role: RoleAssistant,
				Blocks: []Block{
					{
						Type:      BlockTypeToolUse,
						ToolUseID: "toolu_1",
						ToolName:  "main__search",
						ToolInput: json.RawMessage(`{"query":"mygod"}`),
					},
				},
			},
			{
				Role: RoleUser,
				Blocks: []Block{
					{
						Type:      BlockTypeToolResult,
						ToolUseID: "toolu_1",
						Text:      "tool failed",
						IsError:   true,
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateMessage() error = %v", err)
	}

	if gotAssistantToolUseID != "toolu_1" {
		t.Fatalf("assistant tool use id = %q, want toolu_1", gotAssistantToolUseID)
	}
	if gotAssistantToolName != "main__search" {
		t.Fatalf("assistant tool name = %q, want main__search", gotAssistantToolName)
	}
	if gotAssistantToolInput != `{"query":"mygod"}` {
		t.Fatalf("assistant tool input = %s, want original JSON", gotAssistantToolInput)
	}
	if gotUserToolResultID != "toolu_1" {
		t.Fatalf("tool result id = %q, want toolu_1", gotUserToolResultID)
	}
	if gotUserToolResultContent != "tool failed" {
		t.Fatalf("tool result content = %q, want tool failed", gotUserToolResultContent)
	}
	if !gotUserToolResultIsError {
		t.Fatal("tool result is_error = false, want true")
	}
}

func TestAnthropicStreamMessageAggregatesAndObservesBlocks(t *testing.T) {
	events := []string{
		`{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-test","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":7,"output_tokens":0}}}`,
		`{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"secret thought"}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"signed"}}`,
		`{"type":"content_block_stop","index":0}`,
		`{"type":"ping"}`,
		`{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_1","name":"lookup","input":{}}}`,
		`{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"city\":"}}`,
		`{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"Paris\"}"}}`,
		`{"type":"content_block_stop","index":1}`,
		`{"type":"content_block_start","index":2,"content_block":{"type":"text","text":"","citations":[]}}`,
		`{"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"hello "}}`,
		`{"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"world"}}`,
		`{"type":"content_block_stop","index":2}`,
		`{"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":12}}`,
		`{"type":"message_stop"}`,
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			OutputConfig struct {
				Effort string `json:"effort"`
			} `json:"output_config"`
			Thinking json.RawMessage `json:"thinking"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode streaming request: %v", err)
			return
		}
		if request.OutputConfig.Effort != "low" || len(request.Thinking) != 0 {
			t.Errorf("streaming effort = %q, thinking = %s; want low effort without explicit thinking budget", request.OutputConfig.Effort, request.Thinking)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, event := range events {
			var envelope struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal([]byte(event), &envelope); err != nil {
				t.Fatal(err)
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", envelope.Type, event)
		}
	}))
	defer server.Close()
	client := &AnthropicClient{BaseURL: server.URL, APIKey: "key", ModelName: "claude-test", HTTPClient: server.Client()}
	var observed []StreamEvent
	response, err := client.StreamMessage(context.Background(), Request{Messages: []Message{{Role: RoleUser, Content: "hi"}}}, func(event StreamEvent) error { observed = append(observed, event); return nil })
	if err != nil {
		t.Fatalf("StreamMessage: %v", err)
	}
	if len(response.Blocks) != 3 || response.Blocks[0].Type != BlockTypeThinking || response.Blocks[1].Type != BlockTypeToolUse || response.Blocks[2].Type != BlockTypeText {
		t.Fatalf("blocks/order = %#v", response.Blocks)
	}
	if response.Blocks[0].Thinking != "secret thought" || response.Blocks[0].ThinkingSignature != "signed" {
		t.Fatalf("thinking = %#v", response.Blocks[0])
	}
	if response.Blocks[1].ToolUseID != "tool_1" || response.Blocks[1].ToolName != "lookup" || string(response.Blocks[1].ToolInput) != `{"city":"Paris"}` {
		t.Fatalf("tool = %#v", response.Blocks[1])
	}
	if response.Blocks[2].Text != "hello world" || response.InputTokens != 7 || response.OutputTokens != 12 || response.StopReason != "tool_use" {
		t.Fatalf("response = %#v", response)
	}
	if len(observed) != 6 {
		t.Fatalf("observed = %#v", observed)
	}
	for i, event := range observed {
		want := StreamEventBlockStart
		if i%2 == 1 {
			want = StreamEventBlockStop
		}
		if event.Type != want || strings.Contains(fmt.Sprintf("%#v", event), "secret") {
			t.Fatalf("observer event %d = %#v", i, event)
		}
	}
}

func TestAnthropicStreamMessageObserverError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"m\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"model\":\"x\",\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\nevent: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\",\"citations\":[]}}\n\n")
	}))
	defer server.Close()
	want := errors.New("observer stopped")
	client := &AnthropicClient{BaseURL: server.URL, APIKey: "key", ModelName: "x", HTTPClient: server.Client()}
	_, err := client.StreamMessage(context.Background(), Request{Messages: []Message{{Role: RoleUser, Content: "hi"}}}, func(StreamEvent) error { return want })
	if !errors.Is(err, want) {
		t.Fatalf("error = %v, want %v", err, want)
	}
}

func TestAnthropicStreamMessageErrorAndCancellation(t *testing.T) {
	t.Run("API error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"type":"error","error":{"type":"invalid_request_error","message":"bad request"}}`, http.StatusBadRequest)
		}))
		defer server.Close()
		client := &AnthropicClient{BaseURL: server.URL, APIKey: "key", ModelName: "x", HTTPClient: server.Client()}
		response, err := client.StreamMessage(context.Background(), Request{Messages: []Message{{Role: RoleUser, Content: "hi"}}}, nil)
		if err == nil || len(response.Blocks) != 0 {
			t.Fatalf("response=%#v error=%v", response, err)
		}
	})

	t.Run("context cancellation", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"m\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"model\":\"x\",\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\n")
			w.(http.Flusher).Flush()
			<-r.Context().Done()
		}))
		defer server.Close()
		client := &AnthropicClient{BaseURL: server.URL, APIKey: "key", ModelName: "x", HTTPClient: server.Client()}
		ctx, cancel := context.WithCancel(context.Background())
		time.AfterFunc(10*time.Millisecond, cancel)
		response, err := client.StreamMessage(ctx, Request{Messages: []Message{{Role: RoleUser, Content: "hi"}}}, nil)
		if !errors.Is(err, context.Canceled) || len(response.Blocks) != 0 {
			t.Fatalf("response=%#v error=%v", response, err)
		}
	})
}

func decodeTestToolResultContent(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	var content string
	if err := json.Unmarshal(raw, &content); err == nil {
		return content
	}

	var blocks []struct {
		Text string `json:"text"`
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &blocks); err != nil {
		t.Fatalf("decode tool result content: %v; raw=%s", err, raw)
	}
	if len(blocks) == 0 {
		return ""
	}
	return blocks[0].Text
}

func TestAnthropicStreamMessageUnsupportedClassification(t *testing.T) {
	tests := []struct {
		name         string
		status       int
		body         string
		wantSentinel bool
	}{
		{"explicit unsupported", http.StatusBadRequest, `{"type":"error","error":{"type":"invalid_request_error","message":"streaming is unsupported"}}`, true},
		{"unauthorized", http.StatusUnauthorized, `{"type":"error","error":{"message":"streaming is unsupported"}}`, false},
		{"rate limited", http.StatusTooManyRequests, `{"type":"error","error":{"message":"streaming is unsupported"}}`, false},
		{"server error", http.StatusInternalServerError, `{"type":"error","error":{"message":"streaming is unsupported"}}`, false},
		{"unrelated bad request", http.StatusBadRequest, `{"type":"error","error":{"message":"invalid model name"}}`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request map[string]any
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Fatal(err)
				}
				if stream, _ := request["stream"].(bool); !stream {
					t.Fatalf("stream = %v", request["stream"])
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer server.Close()
			client := NewAnthropicClient(config.LLMConfig{BaseURL: server.URL, APIKey: "test", ModelName: "test"})
			_, err := client.StreamMessage(context.Background(), Request{Messages: []Message{{Role: RoleUser, Content: "hi"}}}, nil)
			if got := errors.Is(err, ErrStreamingUnsupported); got != tt.wantSentinel {
				t.Fatalf("errors.Is(..., ErrStreamingUnsupported) = %v, err = %v", got, err)
			}
		})
	}
}

func TestAnthropicStreamMessageDoesNotFallbackAfterSSEEvent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"model\":\"test\",\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\n")
		_, _ = fmt.Fprint(w, "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"streaming is unsupported\"}}\n\n")
	}))
	defer server.Close()
	client := NewAnthropicClient(config.LLMConfig{BaseURL: server.URL, APIKey: "test", ModelName: "test"})
	_, err := client.StreamMessage(context.Background(), Request{Messages: []Message{{Role: RoleUser, Content: "hi"}}}, nil)
	if err == nil {
		t.Fatal("StreamMessage() error = nil")
	}
	if errors.Is(err, ErrStreamingUnsupported) {
		t.Fatalf("partial stream error unexpectedly matched sentinel: %v", err)
	}
}
