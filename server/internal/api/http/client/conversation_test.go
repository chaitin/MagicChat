package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"app/internal/application/account"
	conversationapp "app/internal/application/conversation"

	"github.com/labstack/echo/v4"
)

func TestConversationAPIListsTopicsWithPagination(t *testing.T) {
	nextCursor := "next-topic-cursor"
	service := &conversationClientServiceStub{listTopicsResult: conversationapp.ListTopicsResult{
		NextCursor: &nextCursor,
		Topics: []conversationapp.Item{{
			ID: "topic-1", Name: "发布计划讨论", Type: "topic",
			Topic: &conversationapp.TopicMetadata{
				Archived: false, ParentConversationID: "parent-1", ParentConversationName: "产品群",
				ParentConversationType: "group", SourceMessageID: "message-1", SourceMessageSeq: 8,
			},
		}},
	}}
	router := echo.New()
	group := router.Group("/api/client", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set(currentAccountKey, account.Account{ID: "user-1"})
			return next(c)
		}
	})
	NewConversationAPI(service, nil).RegisterRoutes(group)
	request := httptest.NewRequest(http.MethodGet, "/api/client/conversations/parent-1/topics?status=archived&cursor=cursor-1&limit=20", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if service.listTopicsCommand != (conversationapp.ListTopicsCommand{
		AccountID: "user-1", ParentConversationID: "parent-1", Status: "archived", Cursor: "cursor-1", Limit: 20,
	}) {
		t.Fatalf("command = %#v", service.listTopicsCommand)
	}
	body := recorder.Body.String()
	if body == "" || !containsAll(body, `"next_cursor":"next-topic-cursor"`, `"id":"topic-1"`, `"archived":false`) {
		t.Fatalf("body = %s", body)
	}
}

func TestConversationAPIUpdatesGroupMemberRole(t *testing.T) {
	service := &conversationClientServiceStub{}
	router := echo.New()
	group := router.Group("/api/client", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set(currentAccountKey, account.Account{ID: "actor-id"})
			return next(c)
		}
	})
	NewConversationAPI(service, nil).RegisterRoutes(group)
	request := httptest.NewRequest(http.MethodPatch, "/api/client/conversations/groups/group-id/members/user/member-id/role", strings.NewReader(`{"role":"admin"}`))
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	cmd := service.setMemberRoleCommand
	if cmd.Actor.ID != "actor-id" || cmd.ConversationID != "group-id" || cmd.MemberType != "user" || cmd.MemberID != "member-id" || cmd.Role != "admin" {
		t.Fatalf("command = %#v", cmd)
	}
}

func TestNewConversationItemResponseIncludesLastMessageSender(t *testing.T) {
	response := newConversationItemResponse(conversationapp.Item{
		LastMessageSender: &conversationapp.LastMessageSender{
			ID: "user-id", Name: "Alice", Nickname: "小艾", Type: "user",
		},
	})
	if response.LastMessageSender == nil {
		t.Fatal("last message sender is nil")
	}
	if response.LastMessageSender.ID != "user-id" || response.LastMessageSender.Name != "Alice" || response.LastMessageSender.Nickname != "小艾" || response.LastMessageSender.Type != "user" {
		t.Fatalf("last message sender = %#v", response.LastMessageSender)
	}

	empty := newConversationItemResponse(conversationapp.Item{})
	if empty.LastMessageSender != nil {
		t.Fatalf("empty last message sender = %#v, want nil", empty.LastMessageSender)
	}
}

func TestNewGroupResponseIncludesLastMessageSender(t *testing.T) {
	response := newGroupResponse(conversationapp.Group{
		LastMessageSender: &conversationapp.LastMessageSender{
			Name: "系统", Type: "system",
		},
	})
	if response.LastMessageSender == nil || response.LastMessageSender.Name != "系统" || response.LastMessageSender.Type != "system" {
		t.Fatalf("last message sender = %#v", response.LastMessageSender)
	}
}

type conversationClientServiceStub struct {
	conversationapp.ClientService
	listTopicsCommand    conversationapp.ListTopicsCommand
	listTopicsResult     conversationapp.ListTopicsResult
	setMemberRoleCommand conversationapp.SetMemberRoleCommand
}

func (s *conversationClientServiceStub) ListTopics(_ context.Context, cmd conversationapp.ListTopicsCommand) (conversationapp.ListTopicsResult, error) {
	s.listTopicsCommand = cmd
	return s.listTopicsResult, nil
}

func (s *conversationClientServiceStub) SetMemberRole(_ context.Context, cmd conversationapp.SetMemberRoleCommand) (conversationapp.ConversationMutationResult, error) {
	s.setMemberRoleCommand = cmd
	return conversationapp.ConversationMutationResult{}, nil
}

func containsAll(value string, snippets ...string) bool {
	for _, snippet := range snippets {
		if !strings.Contains(value, snippet) {
			return false
		}
	}
	return true
}
