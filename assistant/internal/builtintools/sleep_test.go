package builtintools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

type requestCall struct {
	method  string
	payload json.RawMessage
}

type fakeRequester struct {
	calls  []requestCall
	handle func(context.Context, string, any) (json.RawMessage, error)
}

func (r *fakeRequester) Request(ctx context.Context, method string, payload any) (json.RawMessage, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	r.calls = append(r.calls, requestCall{
		method:  method,
		payload: raw,
	})
	if r.handle != nil {
		return r.handle(ctx, method, payload)
	}

	return json.RawMessage(`{"ok":true}`), nil
}

func TestSleepToolClampsDuration(t *testing.T) {
	var durations []time.Duration
	source := newSourceWithSleeper(func(ctx context.Context, duration time.Duration) error {
		durations = append(durations, duration)
		return nil
	})

	for _, input := range []json.RawMessage{
		json.RawMessage(`{"seconds":0}`),
		json.RawMessage(`{"seconds":3}`),
		json.RawMessage(`{"seconds":5}`),
		json.RawMessage(`{"seconds":30}`),
		json.RawMessage(`{"seconds":100}`),
		json.RawMessage(`{"seconds":"bad"}`),
		json.RawMessage(`not-json`),
		nil,
	} {
		if _, err := source.CallTool(context.Background(), "sleep", input); err != nil {
			t.Fatalf("CallTool(%s) error = %v", input, err)
		}
	}

	want := []time.Duration{
		5 * time.Second,
		5 * time.Second,
		5 * time.Second,
		30 * time.Second,
		30 * time.Second,
		5 * time.Second,
		5 * time.Second,
		5 * time.Second,
	}
	if len(durations) != len(want) {
		t.Fatalf("duration count = %d, want %d", len(durations), len(want))
	}
	for index := range want {
		if durations[index] != want[index] {
			t.Fatalf("duration[%d] = %s, want %s", index, durations[index], want[index])
		}
	}
}

func TestSleepToolReturnsCanceledContext(t *testing.T) {
	source := newSourceWithSleeper(func(ctx context.Context, duration time.Duration) error {
		<-ctx.Done()
		return ctx.Err()
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := source.CallTool(ctx, "sleep", json.RawMessage(`{"seconds":10}`))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("CallTool() error = %v, want context.Canceled", err)
	}
}

func TestSleepToolListMetadata(t *testing.T) {
	source := NewSource()

	tools, err := source.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools() error = %v", err)
	}
	toolNames := make(map[string]bool, len(tools))
	for _, tool := range tools {
		toolNames[tool.Name] = true
	}
	for _, name := range []string{"sleep", "contacts", "recent_conversations", "read_history", "reply", "send_as_user", "create_group", "add_group_members", "read_file_urls"} {
		if !toolNames[name] {
			t.Fatalf("tools = %+v, want %s", tools, name)
		}
	}
	for _, tool := range tools {
		if tool.Description == "" {
			t.Fatalf("tool %s description is empty", tool.Name)
		}
		if tool.InputSchema == nil {
			t.Fatalf("tool %s input schema is nil", tool.Name)
		}
	}
}

func TestSleepToolMetadataClarifiesClampingAndUsage(t *testing.T) {
	source := NewSource()

	tools, err := source.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools() error = %v", err)
	}
	toolsByName := map[string]mcpToolForTest{}
	for _, tool := range tools {
		schema, ok := tool.InputSchema.(map[string]any)
		if !ok {
			t.Fatalf("%s schema = %#v, want object schema", tool.Name, tool.InputSchema)
		}
		toolsByName[tool.Name] = mcpToolForTest{
			Description: tool.Description,
			Schema:      schema,
		}
	}

	tool := toolsByName["sleep"]
	for _, snippet := range []string{"5", "30", "异步任务", "轮询", "不用于普通回复", "不合法按 5 秒"} {
		if !strings.Contains(tool.Description, snippet) {
			t.Fatalf("sleep description = %q, want to contain %q", tool.Description, snippet)
		}
	}
	properties := tool.Schema["properties"].(map[string]any)
	seconds := properties["seconds"].(map[string]any)
	if seconds["minimum"] != minSleepSeconds || seconds["maximum"] != maxSleepSeconds {
		t.Fatalf("seconds schema = %#v, want min/max constants", seconds)
	}
}

func TestGroupToolMetadataClarifiesUsageScenarios(t *testing.T) {
	source := NewSource()
	tools, err := source.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools() error = %v", err)
	}
	toolsByName := map[string]string{}
	for _, tool := range tools {
		toolsByName[tool.Name] = tool.Description
	}

	for _, snippet := range []string{"明确要求创建新群聊", "不要用它发送消息", "不要用它回复", "已有群聊", "先追问"} {
		if !strings.Contains(toolsByName["create_group"], snippet) {
			t.Fatalf("create_group description = %q, want to contain %q", toolsByName["create_group"], snippet)
		}
	}
	for _, snippet := range []string{"明确要求把人加入已有群聊", "不要用它创建群聊", "目标群聊不明确", "先追问", "当前会话是目标群聊"} {
		if !strings.Contains(toolsByName["add_group_members"], snippet) {
			t.Fatalf("add_group_members description = %q, want to contain %q", toolsByName["add_group_members"], snippet)
		}
	}
}

func TestSendAsUserToolMetadataClarifiesGroupUsageScenarios(t *testing.T) {
	source := NewSource()
	tools, err := source.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools() error = %v", err)
	}
	toolsByName := map[string]string{}
	for _, tool := range tools {
		toolsByName[tool.Name] = tool.Description
	}

	for _, snippet := range []string{"私聊或已有群聊", "target_type", "recent_conversations", "目标群聊不明确", "不要用它回复当前会话"} {
		if !strings.Contains(toolsByName["send_as_user"], snippet) {
			t.Fatalf("send_as_user description = %q, want to contain %q", toolsByName["send_as_user"], snippet)
		}
	}
}

func TestMessageToolMetadataClarifiesFileUsageScenarios(t *testing.T) {
	source := NewSource()
	tools, err := source.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools() error = %v", err)
	}
	toolsByName := map[string]mcpToolForTest{}
	for _, tool := range tools {
		schema, ok := tool.InputSchema.(map[string]any)
		if !ok {
			t.Fatalf("%s schema = %#v, want object schema", tool.Name, tool.InputSchema)
		}
		toolsByName[tool.Name] = mcpToolForTest{
			Description: tool.Description,
			Schema:      schema,
		}
	}

	for _, toolName := range []string{"reply", "send_as_user"} {
		for _, snippet := range []string{"file", "name", "url", "content", "小文件", "不要猜文件名", "先追问"} {
			if !strings.Contains(toolsByName[toolName].Description, snippet) {
				t.Fatalf("%s description = %q, want to contain %q", toolName, toolsByName[toolName].Description, snippet)
			}
		}
		properties := toolsByName[toolName].Schema["properties"].(map[string]any)
		for _, property := range []string{"name", "url", "content"} {
			if _, ok := properties[property]; !ok {
				t.Fatalf("%s schema properties = %#v, want %s", toolName, properties, property)
			}
		}
	}
}

type mcpToolForTest struct {
	Description string
	Schema      map[string]any
}

func TestReadFileURLsToolMetadataClarifiesOnDemandUsage(t *testing.T) {
	source := NewSource()
	tools, err := source.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools() error = %v", err)
	}
	toolsByName := map[string]mcpToolForTest{}
	for _, tool := range tools {
		schema, ok := tool.InputSchema.(map[string]any)
		if !ok {
			t.Fatalf("%s schema = %#v, want object schema", tool.Name, tool.InputSchema)
		}
		toolsByName[tool.Name] = mcpToolForTest{
			Description: tool.Description,
			Schema:      schema,
		}
	}

	tool, ok := toolsByName["read_file_urls"]
	if !ok {
		t.Fatalf("tools = %+v, want read_file_urls", tools)
	}
	for _, snippet := range []string{"按需", "file_id", "历史消息", "当前消息", "部分失败", "不需要会话 ID"} {
		if !strings.Contains(tool.Description, snippet) {
			t.Fatalf("read_file_urls description = %q, want to contain %q", tool.Description, snippet)
		}
	}
	properties := tool.Schema["properties"].(map[string]any)
	if _, ok := properties["file_ids"]; !ok {
		t.Fatalf("read_file_urls schema properties = %#v, want file_ids", properties)
	}
}

func TestContactsToolCallsAppRequest(t *testing.T) {
	requester := &fakeRequester{}
	ctx := WithScope(context.Background(), Scope{Requester: requester})
	source := NewSource()

	result, err := source.CallTool(ctx, "contacts", json.RawMessage(`{"keyword":"ali"}`))
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	if result.Content != `{"ok":true}` {
		t.Fatalf("result = %q, want app response JSON", result.Content)
	}
	if len(requester.calls) != 1 {
		t.Fatalf("request call count = %d, want 1", len(requester.calls))
	}
	if requester.calls[0].method != methodContactsUsersList {
		t.Fatalf("method = %q, want %s", requester.calls[0].method, methodContactsUsersList)
	}
	var payload map[string]any
	if err := json.Unmarshal(requester.calls[0].payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload["keyword"] != "ali" {
		t.Fatalf("keyword = %v, want ali", payload["keyword"])
	}
}

func TestRecentConversationsToolMetadataClarifiesResultShape(t *testing.T) {
	source := NewSource()
	tools, err := source.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools() error = %v", err)
	}
	toolsByName := map[string]mcpToolForTest{}
	for _, tool := range tools {
		schema, ok := tool.InputSchema.(map[string]any)
		if !ok {
			t.Fatalf("%s schema = %#v, want object schema", tool.Name, tool.InputSchema)
		}
		toolsByName[tool.Name] = mcpToolForTest{
			Description: tool.Description,
			Schema:      schema,
		}
	}

	tool, ok := toolsByName["recent_conversations"]
	if !ok {
		t.Fatalf("tools = %+v, want recent_conversations", tools)
	}
	for _, snippet := range []string{"最近使用的会话", "私聊", "群聊", "应用", "会话名称", "私聊对象", "姓名", "昵称", "成员数量", "最近活动时间"} {
		if !strings.Contains(tool.Description, snippet) {
			t.Fatalf("recent_conversations description = %q, want to contain %q", tool.Description, snippet)
		}
	}
	properties := tool.Schema["properties"].(map[string]any)
	for _, property := range []string{"keyword", "limit"} {
		if _, ok := properties[property]; !ok {
			t.Fatalf("recent_conversations schema properties = %#v, want %s", properties, property)
		}
	}
}

func TestRecentConversationsToolCallsAppRequestWithTriggerContext(t *testing.T) {
	requester := &fakeRequester{}
	ctx := WithScope(context.Background(), Scope{
		CurrentUserID:    "user-1",
		Requester:        requester,
		TriggerMessageID: "message-1",
	})
	source := NewSource()

	result, err := source.CallTool(ctx, "recent_conversations", json.RawMessage(`{"keyword":" 项目 ","limit":200}`))
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	if result.Content != `{"ok":true}` {
		t.Fatalf("result = %q, want app response JSON", result.Content)
	}
	if len(requester.calls) != 1 {
		t.Fatalf("request call count = %d, want 1", len(requester.calls))
	}
	if requester.calls[0].method != methodConversationsList {
		t.Fatalf("method = %q, want %s", requester.calls[0].method, methodConversationsList)
	}
	var payload struct {
		ActorUserID      string `json:"actor_user_id"`
		Keyword          string `json:"keyword"`
		Limit            int    `json:"limit"`
		TriggerMessageID string `json:"trigger_message_id"`
	}
	if err := json.Unmarshal(requester.calls[0].payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.ActorUserID != "user-1" || payload.TriggerMessageID != "message-1" || payload.Keyword != "项目" || payload.Limit != 200 {
		t.Fatalf("payload = %#v, want scoped actor/trigger, trimmed keyword, and limit", payload)
	}
}

func TestReadHistoryToolCallsAppRequestWithConversationID(t *testing.T) {
	requester := &fakeRequester{}
	ctx := WithScope(context.Background(), Scope{
		CurrentUserID:    "user-1",
		Requester:        requester,
		TriggerMessageID: "message-1",
	})
	source := NewSource()

	result, err := source.CallTool(ctx, "read_history", json.RawMessage(`{"conversation_id":" conversation-1 ","before_seq":9,"limit":200}`))
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	if result.Content != `{"ok":true}` {
		t.Fatalf("result = %q, want app response JSON", result.Content)
	}
	if len(requester.calls) != 1 {
		t.Fatalf("request call count = %d, want 1", len(requester.calls))
	}
	if requester.calls[0].method != methodConversationHistoryRead {
		t.Fatalf("method = %q, want %s", requester.calls[0].method, methodConversationHistoryRead)
	}
	var payload struct {
		ActorUserID      string `json:"actor_user_id"`
		BeforeSeq        int64  `json:"before_seq"`
		ConversationID   string `json:"conversation_id"`
		Limit            int    `json:"limit"`
		TriggerMessageID string `json:"trigger_message_id"`
	}
	if err := json.Unmarshal(requester.calls[0].payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.ActorUserID != "user-1" ||
		payload.TriggerMessageID != "message-1" ||
		payload.ConversationID != "conversation-1" ||
		payload.BeforeSeq != 9 ||
		payload.Limit != 200 {
		t.Fatalf("payload = %#v, want conversation history request", payload)
	}
}

func TestReadHistoryToolCallsAppRequestWithUserIDOrAppID(t *testing.T) {
	for _, tt := range []struct {
		name     string
		input    string
		wantUser string
		wantApp  string
	}{
		{
			name:     "user id",
			input:    `{"user_id":" user-2 "}`,
			wantUser: "user-2",
		},
		{
			name:    "app id",
			input:   `{"app_id":" app-1 "}`,
			wantApp: "app-1",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			requester := &fakeRequester{}
			ctx := WithScope(context.Background(), Scope{
				CurrentUserID:    "user-1",
				Requester:        requester,
				TriggerMessageID: "message-1",
			})
			source := NewSource()

			if _, err := source.CallTool(ctx, "read_history", json.RawMessage(tt.input)); err != nil {
				t.Fatalf("CallTool() error = %v", err)
			}
			if len(requester.calls) != 1 {
				t.Fatalf("request call count = %d, want 1", len(requester.calls))
			}
			if requester.calls[0].method != methodConversationHistoryRead {
				t.Fatalf("method = %q, want %s", requester.calls[0].method, methodConversationHistoryRead)
			}
			var payload struct {
				AppID            string `json:"app_id"`
				ActorUserID      string `json:"actor_user_id"`
				Limit            int    `json:"limit"`
				TriggerMessageID string `json:"trigger_message_id"`
				UserID           string `json:"user_id"`
			}
			if err := json.Unmarshal(requester.calls[0].payload, &payload); err != nil {
				t.Fatalf("unmarshal payload: %v", err)
			}
			if payload.ActorUserID != "user-1" || payload.TriggerMessageID != "message-1" {
				t.Fatalf("payload context = %#v, want actor and trigger", payload)
			}
			if payload.UserID != tt.wantUser || payload.AppID != tt.wantApp {
				t.Fatalf("payload target = %#v, want user=%q app=%q", payload, tt.wantUser, tt.wantApp)
			}
			if payload.Limit != 0 {
				t.Fatalf("limit = %d, want omitted default 0", payload.Limit)
			}
		})
	}
}

func TestReadHistoryToolRejectsAmbiguousSelector(t *testing.T) {
	ctx := WithScope(context.Background(), Scope{
		CurrentUserID:    "user-1",
		Requester:        &fakeRequester{},
		TriggerMessageID: "message-1",
	})
	source := NewSource()

	if _, err := source.CallTool(ctx, "read_history", json.RawMessage(`{"conversation_id":"conversation-1","user_id":"user-2"}`)); err == nil {
		t.Fatal("CallTool() error = nil, want ambiguous selector error")
	}
}

func TestReadFileURLsToolCallsAppRequestWithFileIDsOnly(t *testing.T) {
	requester := &fakeRequester{
		handle: func(ctx context.Context, method string, payload any) (json.RawMessage, error) {
			var readPayload struct {
				FileIDs []string `json:"file_ids"`
			}
			rawPayload, err := json.Marshal(payload)
			if err != nil {
				t.Fatalf("marshal payload: %v", err)
			}
			var payloadMap map[string]any
			if err := json.Unmarshal(rawPayload, &payloadMap); err != nil {
				t.Fatalf("unmarshal payload map: %v", err)
			}
			if _, ok := payloadMap["conversation_id"]; ok {
				t.Fatalf("payload = %s, want file_ids only", rawPayload)
			}
			if err := json.Unmarshal(rawPayload, &readPayload); err != nil {
				t.Fatalf("unmarshal payload: %v", err)
			}
			if len(readPayload.FileIDs) > 1 {
				return nil, errors.New("not_found: temporary file not found")
			}
			if readPayload.FileIDs[0] == "file-missing" {
				return nil, errors.New("not_found: temporary file not found")
			}
			return json.Marshal(map[string]any{
				"urls": []map[string]any{
					{
						"file_id":    readPayload.FileIDs[0],
						"url":        "https://assets.example.test/" + readPayload.FileIDs[0],
						"expires_at": "2026-07-08T12:00:00Z",
					},
				},
			})
		},
	}
	ctx := WithScope(context.Background(), Scope{
		Requester: requester,
	})
	source := NewSource()

	result, err := source.CallTool(ctx, "read_file_urls", json.RawMessage(`{"file_ids":[" file-ok ","file-missing","file-ok"]}`))
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	if len(requester.calls) != 3 {
		t.Fatalf("request call count = %d, want batch plus individual fallbacks", len(requester.calls))
	}
	for _, call := range requester.calls {
		if call.method != methodTemporaryFilesReadURLs {
			t.Fatalf("method = %q, want %s", call.method, methodTemporaryFilesReadURLs)
		}
		var payload struct {
			FileIDs []string `json:"file_ids"`
		}
		if err := json.Unmarshal(call.payload, &payload); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		var payloadMap map[string]any
		if err := json.Unmarshal(call.payload, &payloadMap); err != nil {
			t.Fatalf("unmarshal payload map: %v", err)
		}
		if _, ok := payloadMap["conversation_id"]; ok {
			t.Fatalf("payload = %s, want file_ids only", call.payload)
		}
	}

	var payload struct {
		URLs []struct {
			FileID string `json:"file_id"`
			URL    string `json:"url"`
		} `json:"urls"`
		Errors []struct {
			FileID string `json:"file_id"`
			Error  string `json:"error"`
		} `json:"errors"`
	}
	if err := json.Unmarshal([]byte(result.Content), &payload); err != nil {
		t.Fatalf("unmarshal result: %v; content=%q", err, result.Content)
	}
	if len(payload.URLs) != 1 || payload.URLs[0].FileID != "file-ok" || payload.URLs[0].URL != "https://assets.example.test/file-ok" {
		t.Fatalf("urls = %#v, want resolved file-ok", payload.URLs)
	}
	if len(payload.Errors) != 1 || payload.Errors[0].FileID != "file-missing" || payload.Errors[0].Error == "" {
		t.Fatalf("errors = %#v, want file-missing error", payload.Errors)
	}
}

func TestReplyToolCallsMessageSendForCurrentConversation(t *testing.T) {
	requester := &fakeRequester{}
	ctx := WithScope(context.Background(), Scope{
		ConversationID:   "conversation-1",
		ConversationType: "app",
		Requester:        requester,
	})
	source := NewSource()

	_, err := source.CallTool(ctx, "reply", json.RawMessage(`{"type":"image","content":"https://example.com/a.png"}`))
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	if len(requester.calls) != 1 {
		t.Fatalf("request call count = %d, want 1", len(requester.calls))
	}
	if requester.calls[0].method != methodMessageSend {
		t.Fatalf("method = %q, want %s", requester.calls[0].method, methodMessageSend)
	}
	var payload struct {
		Target struct {
			Type           string `json:"type"`
			ConversationID string `json:"conversation_id"`
		} `json:"target"`
		Message struct {
			Type    string `json:"type"`
			Content string `json:"content"`
		} `json:"message"`
	}
	if err := json.Unmarshal(requester.calls[0].payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.Target.Type != "app" || payload.Target.ConversationID != "conversation-1" {
		t.Fatalf("target = %#v, want current app conversation", payload.Target)
	}
	if payload.Message.Type != "image" || payload.Message.Content != "https://example.com/a.png" {
		t.Fatalf("message = %#v, want image URL", payload.Message)
	}
}

func TestReplyToolCallsMessageSendForFileURLWithSpecifiedName(t *testing.T) {
	requester := &fakeRequester{}
	ctx := WithScope(context.Background(), Scope{
		ConversationID:   "conversation-1",
		ConversationType: "app",
		Requester:        requester,
	})
	source := NewSource()

	_, err := source.CallTool(ctx, "reply", json.RawMessage(`{"type":"file","name":"report.md","url":"https://example.com/report.md"}`))
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	if len(requester.calls) != 1 {
		t.Fatalf("request call count = %d, want 1", len(requester.calls))
	}
	var payload struct {
		Message struct {
			Type    string `json:"type"`
			Name    string `json:"name"`
			URL     string `json:"url"`
			Content string `json:"content"`
		} `json:"message"`
	}
	if err := json.Unmarshal(requester.calls[0].payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.Message.Type != "file" || payload.Message.Name != "report.md" || payload.Message.URL != "https://example.com/report.md" {
		t.Fatalf("message = %#v, want file URL with specified name", payload.Message)
	}
	if payload.Message.Content != "" {
		t.Fatalf("message content = %q, want empty for URL file", payload.Message.Content)
	}
}

func TestReplyToolCallsMessageSendForInlineFileContentWithSpecifiedName(t *testing.T) {
	requester := &fakeRequester{}
	ctx := WithScope(context.Background(), Scope{
		ConversationID:   "conversation-1",
		ConversationType: "app",
		Requester:        requester,
	})
	source := NewSource()

	fileContent := "  # 报告\n\n正文\n"
	input, err := json.Marshal(map[string]any{
		"type":    "file",
		"name":    "assistant-report.md",
		"content": fileContent,
	})
	if err != nil {
		t.Fatalf("marshal input: %v", err)
	}
	_, err = source.CallTool(ctx, "reply", input)
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	var payload struct {
		Message struct {
			Type    string `json:"type"`
			Name    string `json:"name"`
			URL     string `json:"url"`
			Content string `json:"content"`
		} `json:"message"`
	}
	if err := json.Unmarshal(requester.calls[0].payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.Message.Type != "file" || payload.Message.Name != "assistant-report.md" || payload.Message.Content != fileContent {
		t.Fatalf("message = %#v, want inline file content with specified name", payload.Message)
	}
	if payload.Message.URL != "" {
		t.Fatalf("message url = %q, want empty for inline file", payload.Message.URL)
	}
}

func TestReplyToolRejectsInvalidFileInputs(t *testing.T) {
	source := NewSource()
	ctx := WithScope(context.Background(), Scope{
		ConversationID:   "conversation-1",
		ConversationType: "app",
		Requester:        &fakeRequester{},
	})

	for _, tt := range []struct {
		name  string
		input string
	}{
		{
			name:  "missing file name",
			input: `{"type":"file","content":"hello"}`,
		},
		{
			name:  "path file name",
			input: `{"type":"file","name":"reports/report.md","content":"hello"}`,
		},
		{
			name:  "url and content",
			input: `{"type":"file","name":"report.md","url":"https://example.com/report.md","content":"hello"}`,
		},
		{
			name:  "missing source",
			input: `{"type":"file","name":"report.md"}`,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := source.CallTool(ctx, "reply", json.RawMessage(tt.input)); err == nil {
				t.Fatal("CallTool() error = nil, want invalid file input error")
			}
		})
	}
}

func TestSendAsUserToolCallsMessageSendAsUserWithTriggerContext(t *testing.T) {
	requester := &fakeRequester{}
	ctx := WithScope(context.Background(), Scope{
		CurrentUserID:    "user-1",
		Requester:        requester,
		TriggerMessageID: "message-1",
	})
	source := NewSource()

	_, err := source.CallTool(ctx, "send_as_user", json.RawMessage(`{"contact_id":"user-2","type":"markdown","content":"**收到**"}`))
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	if len(requester.calls) != 1 {
		t.Fatalf("request call count = %d, want 1", len(requester.calls))
	}
	if requester.calls[0].method != methodMessageSendAsUser {
		t.Fatalf("method = %q, want %s", requester.calls[0].method, methodMessageSendAsUser)
	}
	var payload struct {
		ActorUserID      string `json:"actor_user_id"`
		TargetUserID     string `json:"target_user_id"`
		TriggerMessageID string `json:"trigger_message_id"`
		Message          struct {
			Type    string `json:"type"`
			Content string `json:"content"`
		} `json:"message"`
	}
	if err := json.Unmarshal(requester.calls[0].payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.ActorUserID != "user-1" || payload.TargetUserID != "user-2" || payload.TriggerMessageID != "message-1" {
		t.Fatalf("payload context = %#v, want scoped actor/target/trigger", payload)
	}
	if payload.Message.Type != "markdown" || payload.Message.Content != "**收到**" {
		t.Fatalf("message = %#v, want markdown content", payload.Message)
	}
}

func TestSendAsUserToolCallsMessageSendAsUserForGroupConversation(t *testing.T) {
	requester := &fakeRequester{}
	ctx := WithScope(context.Background(), Scope{
		CurrentUserID:    "user-1",
		Requester:        requester,
		TriggerMessageID: "message-1",
	})
	source := NewSource()

	_, err := source.CallTool(ctx, "send_as_user", json.RawMessage(`{"target_type":"group","conversation_id":"group-1","type":"text","content":"群里同步一下"}`))
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	if len(requester.calls) != 1 {
		t.Fatalf("request call count = %d, want 1", len(requester.calls))
	}
	if requester.calls[0].method != methodMessageSendAsUser {
		t.Fatalf("method = %q, want %s", requester.calls[0].method, methodMessageSendAsUser)
	}
	var payload struct {
		ActorUserID      string `json:"actor_user_id"`
		TriggerMessageID string `json:"trigger_message_id"`
		Target           struct {
			ConversationID string `json:"conversation_id"`
			Type           string `json:"type"`
		} `json:"target"`
		Message struct {
			Type    string `json:"type"`
			Content string `json:"content"`
		} `json:"message"`
	}
	if err := json.Unmarshal(requester.calls[0].payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.ActorUserID != "user-1" || payload.TriggerMessageID != "message-1" {
		t.Fatalf("payload context = %#v, want scoped actor/trigger", payload)
	}
	if payload.Target.Type != "group" || payload.Target.ConversationID != "group-1" {
		t.Fatalf("target = %#v, want group conversation", payload.Target)
	}
	if payload.Message.Type != "text" || payload.Message.Content != "群里同步一下" {
		t.Fatalf("message = %#v, want text content", payload.Message)
	}
}

func TestCreateGroupToolCallsAppRequestWithTriggerContext(t *testing.T) {
	requester := &fakeRequester{}
	ctx := WithScope(context.Background(), Scope{
		CurrentUserID:    "user-1",
		Requester:        requester,
		TriggerMessageID: "message-1",
	})
	source := NewSource()

	_, err := source.CallTool(ctx, "create_group", json.RawMessage(`{"name":"项目讨论组","member_ids":["user-2","user-3"]}`))
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	if len(requester.calls) != 1 {
		t.Fatalf("request call count = %d, want 1", len(requester.calls))
	}
	if requester.calls[0].method != "group_conversations.create" {
		t.Fatalf("method = %q, want group_conversations.create", requester.calls[0].method)
	}
	var payload struct {
		ActorUserID      string   `json:"actor_user_id"`
		TriggerMessageID string   `json:"trigger_message_id"`
		Name             string   `json:"name"`
		MemberIDs        []string `json:"member_ids"`
	}
	if err := json.Unmarshal(requester.calls[0].payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.ActorUserID != "user-1" || payload.TriggerMessageID != "message-1" {
		t.Fatalf("payload context = %#v, want scoped actor/trigger", payload)
	}
	if payload.Name != "项目讨论组" {
		t.Fatalf("payload name = %q, want 项目讨论组", payload.Name)
	}
	if len(payload.MemberIDs) != 2 || payload.MemberIDs[0] != "user-2" || payload.MemberIDs[1] != "user-3" {
		t.Fatalf("payload member_ids = %#v, want user-2,user-3", payload.MemberIDs)
	}
}

func TestAddGroupMembersToolDefaultsToCurrentGroupConversation(t *testing.T) {
	requester := &fakeRequester{}
	ctx := WithScope(context.Background(), Scope{
		ConversationID:   "group-1",
		ConversationType: "group",
		CurrentUserID:    "user-1",
		Requester:        requester,
		TriggerMessageID: "message-1",
	})
	source := NewSource()

	_, err := source.CallTool(ctx, "add_group_members", json.RawMessage(`{"member_ids":["user-2","user-3"]}`))
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	if len(requester.calls) != 1 {
		t.Fatalf("request call count = %d, want 1", len(requester.calls))
	}
	if requester.calls[0].method != "group_conversations.members.add" {
		t.Fatalf("method = %q, want group_conversations.members.add", requester.calls[0].method)
	}
	var payload struct {
		ActorUserID      string   `json:"actor_user_id"`
		ConversationID   string   `json:"conversation_id"`
		TriggerMessageID string   `json:"trigger_message_id"`
		MemberIDs        []string `json:"member_ids"`
	}
	if err := json.Unmarshal(requester.calls[0].payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.ActorUserID != "user-1" || payload.TriggerMessageID != "message-1" || payload.ConversationID != "group-1" {
		t.Fatalf("payload context = %#v, want scoped actor/trigger/current group", payload)
	}
	if len(payload.MemberIDs) != 2 || payload.MemberIDs[0] != "user-2" || payload.MemberIDs[1] != "user-3" {
		t.Fatalf("payload member_ids = %#v, want user-2,user-3", payload.MemberIDs)
	}
}

func TestScopedToolsRequireScope(t *testing.T) {
	source := NewSource()

	_, err := source.CallTool(context.Background(), "reply", json.RawMessage(`{"type":"text","content":"hi"}`))
	if err == nil {
		t.Fatal("CallTool() error = nil, want missing scope error")
	}
}
