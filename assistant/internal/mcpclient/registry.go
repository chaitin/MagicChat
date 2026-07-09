package mcpclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"
)

const toolInputLogMaxLength = 2048

type Tool struct {
	Description  string
	InputSchema  any
	Name         string
	OriginalName string
	ServerName   string
}

type ToolResult struct {
	Content string
	Final   bool
	IsError bool
}

type Source interface {
	SourceName() string
	ListTools(context.Context) ([]Tool, error)
	CallTool(context.Context, string, json.RawMessage) (ToolResult, error)
}

type Registry struct {
	tools  []Tool
	routes map[string]toolRoute
}

type toolRoute struct {
	originalName string
	source       Source
}

func NewRegistry(ctx context.Context, sources []Source) (*Registry, error) {
	registry := &Registry{
		routes: make(map[string]toolRoute),
	}

	for _, source := range sources {
		if source == nil {
			return nil, fmt.Errorf("mcp source is nil")
		}
		sourceName := source.SourceName()
		tools, err := source.ListTools(ctx)
		if err != nil {
			return nil, fmt.Errorf("list mcp tools for %s: %w", sourceName, err)
		}
		for _, tool := range tools {
			originalName := tool.Name
			exposedName := sourceName + "__" + sanitizeToolName(originalName)
			if _, ok := registry.routes[exposedName]; ok {
				return nil, fmt.Errorf("duplicate mcp tool name %q", exposedName)
			}

			tool.Name = exposedName
			tool.OriginalName = originalName
			tool.ServerName = sourceName
			registry.tools = append(registry.tools, tool)
			registry.routes[exposedName] = toolRoute{
				originalName: originalName,
				source:       source,
			}
		}
	}

	return registry, nil
}

func (r *Registry) Tools() []Tool {
	if r == nil {
		return nil
	}

	tools := make([]Tool, len(r.tools))
	copy(tools, r.tools)
	return tools
}

func (r *Registry) CallTool(ctx context.Context, name string, input json.RawMessage) (ToolResult, error) {
	if r == nil {
		return ToolResult{}, fmt.Errorf("mcp registry is nil")
	}

	route, ok := r.routes[name]
	if !ok {
		return ToolResult{}, fmt.Errorf("unknown mcp tool %q", name)
	}

	startedAt := time.Now()
	result, err := route.source.CallTool(ctx, route.originalName, input)
	duration := time.Since(startedAt)
	sourceName := route.source.SourceName()
	if err != nil {
		log.Printf(
			"mcp tool call failed server=%s exposed_tool=%s original_tool=%s duration=%s error=%q input=%s",
			sourceName,
			name,
			route.originalName,
			duration,
			err.Error(),
			formatToolInputForLog(input),
		)
		return ToolResult{}, err
	}
	if result.IsError {
		log.Printf(
			"mcp tool returned error server=%s exposed_tool=%s original_tool=%s duration=%s content=%q input=%s",
			sourceName,
			name,
			route.originalName,
			duration,
			truncateLogValue(result.Content, toolInputLogMaxLength),
			formatToolInputForLog(input),
		)
	}

	return result, nil
}

func formatToolInputForLog(input json.RawMessage) string {
	trimmed := strings.TrimSpace(string(input))
	if trimmed == "" {
		return "{}"
	}

	var compacted bytes.Buffer
	if err := json.Compact(&compacted, []byte(trimmed)); err == nil {
		return truncateLogValue(compacted.String(), toolInputLogMaxLength)
	}

	return truncateLogValue(trimmed, toolInputLogMaxLength)
}

func truncateLogValue(value string, maxLength int) string {
	if maxLength <= 0 || len(value) <= maxLength {
		return value
	}

	return value[:maxLength] + "...(truncated)"
}

func sanitizeToolName(name string) string {
	if name == "" {
		return "tool"
	}

	result := make([]rune, 0, len(name))
	for _, r := range name {
		if isAllowedToolNameRune(r) {
			result = append(result, r)
			continue
		}
		result = append(result, '_')
	}

	if len(result) == 0 {
		return "tool"
	}
	return string(result)
}

func isAllowedToolNameRune(r rune) bool {
	return r == '_' ||
		r == '-' ||
		(r >= 'A' && r <= 'Z') ||
		(r >= 'a' && r <= 'z') ||
		(r >= '0' && r <= '9')
}
