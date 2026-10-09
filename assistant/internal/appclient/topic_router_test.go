package appclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"testing"

	"assistant/internal/agent"
	"assistant/internal/llm"
)

type topicRouterFunc func(context.Context, agent.Request) (bool, error)

func (f topicRouterFunc) NeedsTopic(ctx context.Context, request agent.Request) (bool, error) {
	return f(ctx, request)
}

func topicRouterDecision(needsTopic bool) topicRouter {
	return topicRouterFunc(func(context.Context, agent.Request) (bool, error) {
		return needsTopic, nil
	})
}

func TestTopicRouterPromptUsesThinkingAndExecutionComplexity(t *testing.T) {
	for _, rule := range []string{
		"需要深度思考或实际执行，任一条件满足就创建独立话题",
		"需要多阶段推理、系统分析",
		"需要调用工具、查询外部或实时数据",
		"困难的问题也可以创建话题",
		"“查询今天北京的天气” => needs_topic=true",
	} {
		if !strings.Contains(topicRouterSystemPrompt, rule) {
			t.Errorf("topic router prompt missing rule %q", rule)
		}
	}
	for _, obsoleteRule := range []string{
		"单次查询或单步操作",
		"单纯问问题或展开讨论不创建话题",
	} {
		if strings.Contains(topicRouterSystemPrompt, obsoleteRule) {
			t.Errorf("topic router prompt contains obsolete rule %q", obsoleteRule)
		}
	}
}

func TestModelTopicRouterReturnsBooleanDecision(t *testing.T) {
	for _, needsTopic := range []bool{false, true} {
		t.Run(fmt.Sprintf("needs_topic=%t", needsTopic), func(t *testing.T) {
			var logs bytes.Buffer
			previous := log.Writer()
			log.SetOutput(&logs)
			t.Cleanup(func() { log.SetOutput(previous) })
			var gotRequest llm.Request
			model := llmModelFunc(func(_ context.Context, request llm.Request) (llm.Response, error) {
				gotRequest = request
				input, err := json.Marshal(map[string]bool{"needs_topic": needsTopic})
				if err != nil {
					t.Fatalf("marshal tool input: %v", err)
				}
				return llm.Response{Blocks: []llm.Block{{
					Type: llm.BlockTypeToolUse, ToolUseID: "tool-route", ToolName: decideTopicToolName, ToolInput: input,
				}}}, nil
			})
			router := newModelTopicRouter(model)
			router.timeout = 0
			history := make([]agent.HistoryMessage, 12)
			for index := range history {
				history[index] = agent.HistoryMessage{SenderName: "Alice", SenderType: "user", Summary: fmt.Sprintf("历史消息 %d", index+1)}
			}

			got, err := router.NeedsTopic(context.Background(), agent.Request{
				Conversation: agent.Conversation{ID: "conversation-1", Name: "产品群", Type: "group"},
				Content:      "帮我分析最近一个月的项目进展",
				History:      history,
			})
			if err != nil {
				t.Fatalf("NeedsTopic() error = %v", err)
			}
			if got != needsTopic {
				t.Fatalf("NeedsTopic() = %t, want %t", got, needsTopic)
			}
			if want := fmt.Sprintf("assistant topic route conversation_id=conversation-1 needs_topic=%t", needsTopic); !strings.Contains(logs.String(), want) || strings.Contains(logs.String(), "最近一个月") {
				t.Fatalf("route log = %s, want %q without request content", logs.String(), want)
			}
			if gotRequest.System != topicRouterSystemPrompt || len(gotRequest.Tools) != 1 || gotRequest.Tools[0].Name != decideTopicToolName {
				t.Fatalf("model request = %#v", gotRequest)
			}
			if len(gotRequest.Messages) != 1 {
				t.Fatalf("model messages = %#v", gotRequest.Messages)
			}
			var payload topicRoutingPayload
			if err := json.Unmarshal([]byte(gotRequest.Messages[0].Content), &payload); err != nil {
				t.Fatalf("decode routing payload: %v", err)
			}
			if payload.CurrentMessage != "帮我分析最近一个月的项目进展" || payload.Conversation.Type != "group" {
				t.Fatalf("routing payload = %#v", payload)
			}
			if len(payload.RecentHistory) != defaultTopicRouterHistory || payload.RecentHistory[0].Summary != "历史消息 3" {
				t.Fatalf("recent history = %#v", payload.RecentHistory)
			}
		})
	}
}

func TestModelTopicRouterAcceptsStrictJSONTextDecision(t *testing.T) {
	for _, needsTopic := range []bool{false, true} {
		t.Run(fmt.Sprintf("needs_topic=%t", needsTopic), func(t *testing.T) {
			response := llm.Response{Blocks: []llm.Block{
				{Type: llm.BlockTypeThinking, Thinking: "判断请求复杂度"},
				{Type: llm.BlockTypeText, Text: fmt.Sprintf(`{"needs_topic":%t}`, needsTopic)},
			}}
			got, err := parseTopicDecision(response)
			if err != nil {
				t.Fatalf("parseTopicDecision() error = %v", err)
			}
			if got != needsTopic {
				t.Fatalf("parseTopicDecision() = %t, want %t", got, needsTopic)
			}
		})
	}
}

func TestModelTopicRouterRejectsInvalidDecisions(t *testing.T) {
	tests := []struct {
		name     string
		response llm.Response
	}{
		{
			name:     "markdown JSON text",
			response: llm.Response{Blocks: []llm.Block{{Type: llm.BlockTypeText, Text: "```json\n{\"needs_topic\":false}\n```"}}},
		},
		{
			name: "missing boolean",
			response: llm.Response{Blocks: []llm.Block{{
				Type: llm.BlockTypeToolUse, ToolName: decideTopicToolName, ToolInput: json.RawMessage(`{}`),
			}}},
		},
		{
			name: "unknown property",
			response: llm.Response{Blocks: []llm.Block{{
				Type: llm.BlockTypeToolUse, ToolName: decideTopicToolName,
				ToolInput: json.RawMessage(`{"needs_topic":false,"reason":"simple"}`),
			}}},
		},
		{
			name: "wrong type",
			response: llm.Response{Blocks: []llm.Block{{
				Type: llm.BlockTypeToolUse, ToolName: decideTopicToolName, ToolInput: json.RawMessage(`{"needs_topic":"false"}`),
			}}},
		},
		{
			name: "multiple calls",
			response: llm.Response{Blocks: []llm.Block{
				{Type: llm.BlockTypeToolUse, ToolName: decideTopicToolName, ToolInput: json.RawMessage(`{"needs_topic":false}`)},
				{Type: llm.BlockTypeToolUse, ToolName: decideTopicToolName, ToolInput: json.RawMessage(`{"needs_topic":true}`)},
			}},
		},
		{
			name: "unexpected tool",
			response: llm.Response{Blocks: []llm.Block{{
				Type: llm.BlockTypeToolUse, ToolName: "reply", ToolInput: json.RawMessage(`{"needs_topic":false}`),
			}}},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := newModelTopicRouter(llmModelFunc(func(context.Context, llm.Request) (llm.Response, error) {
				return test.response, nil
			}))
			router.timeout = 0
			if _, err := router.NeedsTopic(context.Background(), agent.Request{
				Conversation: agent.Conversation{Type: "app"}, Content: "你好",
			}); err == nil {
				t.Fatal("NeedsTopic() error = nil, want invalid decision error")
			}
		})
	}
}

func TestHandleParsedServerMessageRepliesInCurrentConversationWhenTopicIsNotNeeded(t *testing.T) {
	appID := "00000000-0000-0000-0000-000000000001"
	var agentRequests []agent.Request
	var sent []envelope
	requester := appRequestFunc(func(_ context.Context, method string, _ any) (json.RawMessage, error) {
		if method != methodConversationMessagesList {
			t.Fatalf("unexpected app request method %q", method)
		}
		return json.Marshal(appListConversationMessagesResponsePayload{
			Messages: []historyMessagePayload{
				historyTextMessage("message-1", 1, "user-1", "Alice", "你好 {(@app/"+appID+")}"),
			},
		})
	})
	router := topicRouterFunc(func(_ context.Context, request agent.Request) (bool, error) {
		if request.Conversation.ID != "conversation-group-1" || !strings.Contains(request.Content, "你好") {
			t.Fatalf("routing request = %#v", request)
		}
		return false, nil
	})
	replyAgent := replyAgentFunc(func(ctx context.Context, request agent.Request, sink agent.OutputSink) error {
		agentRequests = append(agentRequests, request)
		return sink.SendMarkdown(ctx, "你好")
	})

	handled := handleParsedServerMessageWithTopicRouter(
		context.Background(),
		testGroupMessageCreatedEnvelope(t, appID, "user-1", "message-1", 1, "你好 {(@app/"+appID+")}"),
		appID,
		requester,
		replyAgent,
		router,
		directAgentRunner{},
		func(_ context.Context, message envelope) error {
			sent = append(sent, message)
			return nil
		},
	)

	if !handled {
		t.Fatal("handleParsedServerMessageWithTopicRouter() = false, want true")
	}
	if len(agentRequests) != 1 || agentRequests[0].Conversation.ID != "conversation-group-1" || agentRequests[0].Conversation.Type != "group" {
		t.Fatalf("agent requests = %#v", agentRequests)
	}
	if len(sent) != 1 {
		t.Fatalf("sent messages = %d, want 1", len(sent))
	}
	var reply sendMessageRequestPayload
	if err := json.Unmarshal(sent[0].Payload, &reply); err != nil {
		t.Fatalf("decode reply: %v", err)
	}
	if reply.Target.Type != "group" || reply.Target.ConversationID != "conversation-group-1" {
		t.Fatalf("reply target = %#v", reply.Target)
	}
}

func TestHandleParsedServerMessageDefaultsToCurrentConversationWhenRoutingFails(t *testing.T) {
	appID := "00000000-0000-0000-0000-000000000001"
	var sent []envelope
	requester := appRequestFunc(func(_ context.Context, method string, _ any) (json.RawMessage, error) {
		if method != methodConversationMessagesList {
			t.Fatalf("unexpected app request method %q", method)
		}
		return json.Marshal(appListConversationMessagesResponsePayload{
			Messages: []historyMessagePayload{
				historyTextMessage("message-1", 1, "user-1", "Alice", "请处理 {(@app/"+appID+")}"),
			},
		})
	})
	router := topicRouterFunc(func(context.Context, agent.Request) (bool, error) {
		return false, errors.New("invalid model response")
	})
	replyAgent := replyAgentFunc(func(ctx context.Context, _ agent.Request, sink agent.OutputSink) error {
		return sink.SendMarkdown(ctx, "直接回复")
	})

	handled := handleParsedServerMessageWithTopicRouter(
		context.Background(),
		testGroupMessageCreatedEnvelope(t, appID, "user-1", "message-1", 1, "请处理 {(@app/"+appID+")}"),
		appID,
		requester,
		replyAgent,
		router,
		directAgentRunner{},
		func(_ context.Context, message envelope) error {
			sent = append(sent, message)
			return nil
		},
	)

	if !handled || len(sent) != 1 {
		t.Fatalf("handled = %t, sent = %d", handled, len(sent))
	}
	var reply sendMessageRequestPayload
	if err := json.Unmarshal(sent[0].Payload, &reply); err != nil {
		t.Fatalf("decode reply: %v", err)
	}
	if reply.Target.Type != "group" || reply.Target.ConversationID != "conversation-group-1" {
		t.Fatalf("reply target = %#v, want original group conversation", reply.Target)
	}
	if reply.Message.Content != "直接回复" {
		t.Fatalf("reply content = %q, want direct reply", reply.Message.Content)
	}
}
