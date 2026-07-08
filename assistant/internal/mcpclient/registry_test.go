package mcpclient

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"testing"
)

type fakeSource struct {
	callInputs []json.RawMessage
	callNames  []string
	listErr    error
	name       string
	result     ToolResult
	tools      []Tool
}

func (s *fakeSource) SourceName() string {
	return s.name
}

func (s *fakeSource) ListTools(ctx context.Context) ([]Tool, error) {
	if s.listErr != nil {
		return nil, s.listErr
	}

	return s.tools, nil
}

func (s *fakeSource) CallTool(ctx context.Context, name string, input json.RawMessage) (ToolResult, error) {
	s.callNames = append(s.callNames, name)
	s.callInputs = append(s.callInputs, input)
	return s.result, nil
}

func TestRegistryLoadsToolsWithServerNamespace(t *testing.T) {
	source := &fakeSource{
		name: "main",
		tools: []Tool{
			{
				Description: "Search documents",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"q": map[string]any{"type": "string"},
					},
				},
				Name: "search",
			},
		},
	}

	registry, err := NewRegistry(context.Background(), []Source{source})
	if err != nil {
		t.Fatalf("NewRegistry() error = %v", err)
	}
	tools := registry.Tools()
	if len(tools) != 1 {
		t.Fatalf("tool count = %d, want 1", len(tools))
	}
	if tools[0].Name != "main__search" {
		t.Fatalf("tool name = %q, want main__search", tools[0].Name)
	}
	if tools[0].OriginalName != "search" {
		t.Fatalf("original name = %q, want search", tools[0].OriginalName)
	}
	if tools[0].ServerName != "main" {
		t.Fatalf("server name = %q, want main", tools[0].ServerName)
	}
	if tools[0].Description != "Search documents" {
		t.Fatalf("description = %q, want Search documents", tools[0].Description)
	}
}

func TestRegistryCallsOriginalToolName(t *testing.T) {
	source := &fakeSource{
		name:   "main",
		result: ToolResult{Content: "result text"},
		tools:  []Tool{{Name: "search"}},
	}
	registry, err := NewRegistry(context.Background(), []Source{source})
	if err != nil {
		t.Fatalf("NewRegistry() error = %v", err)
	}

	result, err := registry.CallTool(context.Background(), "main__search", json.RawMessage(`{"q":"hello"}`))
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	if result.Content != "result text" {
		t.Fatalf("result content = %q, want result text", result.Content)
	}
	if !slices.Equal(source.callNames, []string{"search"}) {
		t.Fatalf("call names = %v, want [search]", source.callNames)
	}
	if string(source.callInputs[0]) != `{"q":"hello"}` {
		t.Fatalf("call input = %s, want original JSON", source.callInputs[0])
	}
}

func TestRegistryReturnsListToolsError(t *testing.T) {
	_, err := NewRegistry(context.Background(), []Source{
		&fakeSource{name: "main", listErr: errors.New("connect failed")},
	})
	if err == nil {
		t.Fatal("NewRegistry() error = nil, want list tools error")
	}
}

func TestRegistryRejectsDuplicateExposedToolNames(t *testing.T) {
	_, err := NewRegistry(context.Background(), []Source{
		&fakeSource{name: "main", tools: []Tool{{Name: "search"}, {Name: "search"}}},
	})
	if err == nil {
		t.Fatal("NewRegistry() error = nil, want duplicate tool name error")
	}
}

func TestRegistrySanitizesToolNames(t *testing.T) {
	registry, err := NewRegistry(context.Background(), []Source{
		&fakeSource{name: "main", tools: []Tool{{Name: "doc.search-v1"}}},
	})
	if err != nil {
		t.Fatalf("NewRegistry() error = %v", err)
	}
	if got := registry.Tools()[0].Name; got != "main__doc_search-v1" {
		t.Fatalf("tool name = %q, want main__doc_search-v1", got)
	}
}

func TestRegistrySanitizesToolNamesToASCII(t *testing.T) {
	registry, err := NewRegistry(context.Background(), []Source{
		&fakeSource{name: "main", tools: []Tool{{Name: "查询.tool"}}},
	})
	if err != nil {
		t.Fatalf("NewRegistry() error = %v", err)
	}
	if got := registry.Tools()[0].Name; got != "main_____tool" {
		t.Fatalf("tool name = %q, want main_____tool", got)
	}
}
