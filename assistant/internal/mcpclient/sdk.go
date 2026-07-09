package mcpclient

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"assistant/internal/config"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const defaultHTTPTimeout = 60 * time.Second

type SDKSource struct {
	cfg     config.MCPServerConfig
	connect sdkSessionConnector
	mu      sync.Mutex
	name    string
	session sdkSession
}

type sdkSession interface {
	CallTool(context.Context, *mcp.CallToolParams) (*mcp.CallToolResult, error)
	Close() error
	ListTools(context.Context, *mcp.ListToolsParams) (*mcp.ListToolsResult, error)
}

type sdkSessionConnector func(context.Context, config.MCPServerConfig) (sdkSession, error)

func NewSDKSource(ctx context.Context, cfg config.MCPServerConfig) (*SDKSource, error) {
	return newSDKSource(ctx, cfg, connectSDKSession)
}

func newSDKSource(ctx context.Context, cfg config.MCPServerConfig, connect sdkSessionConnector) (*SDKSource, error) {
	session, err := connect(ctx, cfg)
	if err != nil {
		return nil, err
	}

	return &SDKSource{
		cfg:     cloneMCPServerConfig(cfg),
		connect: connect,
		name:    cfg.Name,
		session: session,
	}, nil
}

func connectSDKSession(ctx context.Context, cfg config.MCPServerConfig) (sdkSession, error) {
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

	return session, nil
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
		result, err := s.listTools(ctx, &mcp.ListToolsParams{Cursor: cursor})
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
	result, err := s.callTool(ctx, name, input)
	if err != nil {
		log.Printf("mcp server %s tool %s call failed, reconnecting: %v", s.name, name, err)
		if reconnectErr := s.reconnect(ctx); reconnectErr != nil {
			return ToolResult{}, fmt.Errorf("%w; reconnect mcp server %s failed: %v", err, s.name, reconnectErr)
		}
		log.Printf("mcp server %s reconnected after tool failure", s.name)

		var retryErr error
		result, retryErr = s.callTool(ctx, name, input)
		if retryErr != nil {
			log.Printf("mcp server %s tool %s retry failed after reconnect: %v", s.name, name, retryErr)
			return ToolResult{}, fmt.Errorf("%w; retry after reconnect failed: %v", err, retryErr)
		}
	}

	return ToolResult{
		Content: formatCallToolResult(result),
		IsError: result.IsError,
	}, nil
}

func (s *SDKSource) listTools(ctx context.Context, params *mcp.ListToolsParams) (*mcp.ListToolsResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.session.ListTools(ctx, params)
}

func (s *SDKSource) callTool(ctx context.Context, name string, input json.RawMessage) (*mcp.CallToolResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.session.CallTool(ctx, &mcp.CallToolParams{
		Name:      name,
		Arguments: input,
	})
}

func (s *SDKSource) reconnect(ctx context.Context) error {
	session, err := s.connect(ctx, s.cfg)
	if err != nil {
		return err
	}

	s.mu.Lock()
	previousSession := s.session
	s.session = session
	s.mu.Unlock()

	if previousSession != nil {
		_ = previousSession.Close()
	}

	return nil
}

func (s *SDKSource) Close() error {
	if s == nil {
		return nil
	}

	s.mu.Lock()
	session := s.session
	s.session = nil
	s.mu.Unlock()
	if session == nil {
		return nil
	}

	return session.Close()
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

func cloneMCPServerConfig(cfg config.MCPServerConfig) config.MCPServerConfig {
	return config.MCPServerConfig{
		Headers: cloneStringMap(cfg.Headers),
		Name:    cfg.Name,
		URL:     cfg.URL,
	}
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
