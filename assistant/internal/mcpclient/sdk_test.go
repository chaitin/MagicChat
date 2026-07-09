package mcpclient

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"assistant/internal/config"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestSDKSourceUsesConfiguredHeadersAndCallsTool(t *testing.T) {
	var authorizations []string
	var gotArguments string

	server := mcp.NewServer(&mcp.Implementation{Name: "test-server", Version: "v0.0.1"}, nil)
	server.AddTool(&mcp.Tool{
		Name:        "search",
		Description: "Search documents",
		InputSchema: json.RawMessage(`{"type":"object","properties":{"q":{"type":"string"}}}`),
	}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		gotArguments = string(req.Params.Arguments)
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: "found result"}},
		}, nil
	})

	httpServer := httptest.NewServer(mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		if authorization := r.Header.Get("Authorization"); authorization != "" {
			authorizations = append(authorizations, authorization)
		}
		return server
	}, &mcp.StreamableHTTPOptions{JSONResponse: true}))
	defer httpServer.Close()

	source, err := NewSDKSource(context.Background(), config.MCPServerConfig{
		Name: "main",
		URL:  httpServer.URL,
		Headers: map[string]string{
			"Authorization": "Bearer test-key",
		},
	})
	if err != nil {
		t.Fatalf("NewSDKSource() error = %v", err)
	}
	defer source.Close()

	tools, err := source.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools() error = %v", err)
	}
	if len(tools) != 1 {
		t.Fatalf("tool count = %d, want 1", len(tools))
	}
	if tools[0].Name != "search" {
		t.Fatalf("tool name = %q, want search", tools[0].Name)
	}
	if tools[0].Description != "Search documents" {
		t.Fatalf("tool description = %q, want Search documents", tools[0].Description)
	}

	result, err := source.CallTool(context.Background(), "search", json.RawMessage(`{"q":"hello"}`))
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	if result.Content != "found result" {
		t.Fatalf("result content = %q, want found result", result.Content)
	}
	if gotArguments != `{"q":"hello"}` {
		t.Fatalf("tool arguments = %s, want original JSON", gotArguments)
	}
	if !slices.Contains(authorizations, "Bearer test-key") {
		t.Fatalf("authorization headers = %v, want Bearer test-key", authorizations)
	}
}

func TestSDKSourceReconnectsAndRetriesToolCallAfterFailure(t *testing.T) {
	firstSession := &fakeSDKSession{
		callErr: errors.New("connection is closed"),
	}
	secondSession := &fakeSDKSession{
		callResult: &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: "retried result"}},
		},
	}
	sessions := []sdkSession{firstSession, secondSession}
	connectCount := 0

	source, err := newSDKSource(
		context.Background(),
		config.MCPServerConfig{Name: "main", URL: "https://mcp.example.com/mcp"},
		func(ctx context.Context, cfg config.MCPServerConfig) (sdkSession, error) {
			if connectCount >= len(sessions) {
				t.Fatalf("unexpected reconnect count %d", connectCount)
			}
			session := sessions[connectCount]
			connectCount++
			return session, nil
		},
	)
	if err != nil {
		t.Fatalf("newSDKSource() error = %v", err)
	}
	defer source.Close()

	result, err := source.CallTool(context.Background(), "search", json.RawMessage(`{"q":"hello"}`))
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	if result.Content != "retried result" {
		t.Fatalf("result content = %q, want retried result", result.Content)
	}
	if connectCount != 2 {
		t.Fatalf("connect count = %d, want 2", connectCount)
	}
	if firstSession.callCount != 1 || secondSession.callCount != 1 {
		t.Fatalf("call counts = %d, %d; want 1, 1", firstSession.callCount, secondSession.callCount)
	}
	if !firstSession.closed {
		t.Fatal("first session closed = false, want true")
	}
}

func TestFormatToolResultIncludesStructuredContent(t *testing.T) {
	content := formatCallToolResult(&mcp.CallToolResult{
		Content:           []mcp.Content{&mcp.TextContent{Text: "plain result"}},
		StructuredContent: map[string]any{"answer": "structured"},
	})

	if content != "plain result\n{\"answer\":\"structured\"}" {
		t.Fatalf("content = %q, want text and structured JSON", content)
	}
}

type fakeSDKSession struct {
	callCount  int
	callErr    error
	callResult *mcp.CallToolResult
	closed     bool
}

func (s *fakeSDKSession) CallTool(ctx context.Context, params *mcp.CallToolParams) (*mcp.CallToolResult, error) {
	s.callCount++
	if s.callErr != nil {
		return nil, s.callErr
	}
	if s.callResult != nil {
		return s.callResult, nil
	}

	return &mcp.CallToolResult{}, nil
}

func (s *fakeSDKSession) Close() error {
	s.closed = true
	return nil
}

func (s *fakeSDKSession) ListTools(ctx context.Context, params *mcp.ListToolsParams) (*mcp.ListToolsResult, error) {
	return &mcp.ListToolsResult{}, nil
}
