package mcpclient

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"assistant/internal/config"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const defaultHTTPTimeout = 60 * time.Second

type SDKSource struct {
	name    string
	session *mcp.ClientSession
}

func NewSDKSource(ctx context.Context, cfg config.MCPServerConfig) (*SDKSource, error) {
	client := mcp.NewClient(&mcp.Implementation{
		Name:    "mygod-assistant",
		Version: "v0.0.0",
	}, nil)
	transport := &mcp.StreamableClientTransport{
		Endpoint:             cfg.URL,
		HTTPClient:           newHeaderHTTPClient(cfg.Headers),
		DisableStandaloneSSE: true,
		MaxRetries:           -1,
	}

	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		return nil, fmt.Errorf("connect mcp server %s: %w", cfg.Name, err)
	}

	return &SDKSource{
		name:    cfg.Name,
		session: session,
	}, nil
}

func NewSDKSources(ctx context.Context, servers []config.MCPServerConfig) ([]Source, error) {
	sources := make([]Source, 0, len(servers))
	for _, server := range servers {
		source, err := NewSDKSource(ctx, server)
		if err != nil {
			closeSources(sources)
			return nil, err
		}
		sources = append(sources, source)
	}

	return sources, nil
}

func CloseSources(sources []Source) {
	closeSources(sources)
}

func (s *SDKSource) SourceName() string {
	return s.name
}

func (s *SDKSource) ListTools(ctx context.Context) ([]Tool, error) {
	var tools []Tool
	cursor := ""
	for {
		result, err := s.session.ListTools(ctx, &mcp.ListToolsParams{Cursor: cursor})
		if err != nil {
			return nil, err
		}
		for _, tool := range result.Tools {
			if tool == nil {
				continue
			}
			tools = append(tools, Tool{
				Description: tool.Description,
				InputSchema: tool.InputSchema,
				Name:        tool.Name,
			})
		}
		if result.NextCursor == "" {
			return tools, nil
		}
		cursor = result.NextCursor
	}
}

func (s *SDKSource) CallTool(ctx context.Context, name string, input json.RawMessage) (ToolResult, error) {
	result, err := s.session.CallTool(ctx, &mcp.CallToolParams{
		Name:      name,
		Arguments: input,
	})
	if err != nil {
		return ToolResult{}, err
	}

	return ToolResult{
		Content: formatCallToolResult(result),
		IsError: result.IsError,
	}, nil
}

func (s *SDKSource) Close() error {
	if s == nil || s.session == nil {
		return nil
	}

	return s.session.Close()
}

type closeableSource interface {
	Close() error
}

func closeSources(sources []Source) {
	for _, source := range sources {
		closeable, ok := source.(closeableSource)
		if !ok {
			continue
		}
		_ = closeable.Close()
	}
}

func formatCallToolResult(result *mcp.CallToolResult) string {
	if result == nil {
		return ""
	}

	parts := make([]string, 0, len(result.Content)+1)
	for _, content := range result.Content {
		parts = append(parts, formatContent(content))
	}
	if result.StructuredContent != nil {
		parts = append(parts, formatJSONValue(result.StructuredContent))
	}

	return strings.Join(parts, "\n")
}

func formatContent(content mcp.Content) string {
	switch typed := content.(type) {
	case *mcp.TextContent:
		return typed.Text
	default:
		if content == nil {
			return ""
		}
		data, err := content.MarshalJSON()
		if err != nil {
			return fmt.Sprintf("%v", content)
		}
		return string(data)
	}
}

func formatJSONValue(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("%v", value)
	}

	return string(data)
}

type headerRoundTripper struct {
	base    http.RoundTripper
	headers map[string]string
}

func newHeaderHTTPClient(headers map[string]string) *http.Client {
	return &http.Client{
		Timeout: defaultHTTPTimeout,
		Transport: headerRoundTripper{
			base:    http.DefaultTransport,
			headers: headers,
		},
	}
}

func (t headerRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	cloned := req.Clone(req.Context())
	for name, value := range t.headers {
		cloned.Header.Set(name, value)
	}

	base := t.base
	if base == nil {
		base = http.DefaultTransport
	}
	return base.RoundTrip(cloned)
}
