package client

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"app/internal/application/account"
	contactapp "app/internal/application/contact"

	"github.com/labstack/echo/v4"
)

func TestContactAPIListsUnifiedContacts(t *testing.T) {
	lastOnlineAt := time.Date(2026, 7, 15, 9, 0, 0, 0, time.UTC)
	creatorUserID := "creator-id"
	stub := &contactServiceStub{
		listResult: contactapp.ListResult{
			Apps:   []contactapp.App{{ID: "app-id", Name: "App", CreatorUserID: &creatorUserID, Type: contactapp.ContactTypeApp}},
			Groups: []contactapp.Group{{ID: "group-id", Name: "Group", Type: contactapp.ContactTypeGroup}},
			Users:  []contactapp.User{{ID: "user-id", Name: "User", Type: contactapp.ContactTypeUser, LastOnlineAt: &lastOnlineAt}},
		},
	}
	api := NewContactAPI(stub)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/contacts?keyword=Team", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(currentAccountKey, account.Account{ID: "account-id"})

	if err := api.list(c); err != nil {
		t.Fatalf("list contacts: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if stub.listCommand.AccountID != "account-id" || stub.listCommand.Keyword != "Team" {
		t.Fatalf("command = %#v", stub.listCommand)
	}
	var response struct {
		Success bool                       `json:"success"`
		Data    listClientContactsResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.Success || len(response.Data.Apps) != 1 || len(response.Data.Groups) != 1 || len(response.Data.UserIDs) != 1 {
		t.Fatalf("response = %#v", response)
	}
	if response.Data.Apps[0].CreatorUserID == nil || *response.Data.Apps[0].CreatorUserID != creatorUserID {
		t.Fatalf("app = %#v", response.Data.Apps[0])
	}
	if response.Data.UserIDs[0] != "user-id" {
		t.Fatalf("user IDs = %#v", response.Data.UserIDs)
	}
}

func TestContactAPIResolvesUsers(t *testing.T) {
	userID := "7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"
	updatedAt := time.Date(2026, 7, 15, 9, 30, 0, 0, time.UTC)
	stub := &contactServiceStub{resolveResult: contactapp.ResolveUsersResult{Users: []contactapp.User{{
		ID: userID, Name: "Alice", Type: contactapp.ContactTypeUser, UpdatedAt: updatedAt,
	}}}}
	api := NewContactAPI(stub)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/users/resolve", bytes.NewBufferString(`{"user_ids":["`+userID+`"]}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := api.resolveUsers(c); err != nil {
		t.Fatalf("resolve users: %v", err)
	}
	if rec.Code != http.StatusOK || len(stub.resolveCommand.UserIDs) != 1 || stub.resolveCommand.UserIDs[0] != userID {
		t.Fatalf("status = %d, command = %#v", rec.Code, stub.resolveCommand)
	}
	var response struct {
		Success bool                 `json:"success"`
		Data    resolveUsersResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.Success || len(response.Data.Users) != 1 || !response.Data.Users[0].UpdatedAt.Equal(updatedAt) {
		t.Fatalf("response = %#v", response)
	}
}

func TestContactAPIRejectsResolveBatchOver500(t *testing.T) {
	ids := make([]string, 501)
	for i := range ids {
		ids[i] = "7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"
	}
	body, err := json.Marshal(resolveUsersRequest{UserIDs: ids})
	if err != nil {
		t.Fatal(err)
	}
	api := NewContactAPI(contactapp.NewService(contactapp.Dependencies{}))
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/users/resolve", bytes.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	if err := api.resolveUsers(e.NewContext(req, rec)); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusBadRequest || !bytes.Contains(rec.Body.Bytes(), []byte("每次最多查询 500 个用户")) {
		t.Fatalf("status=%d, body=%s", rec.Code, rec.Body.String())
	}
}

func TestContactAPIListsUsers(t *testing.T) {
	stub := &contactServiceStub{usersResult: contactapp.ListUsersResult{Users: []contactapp.User{{ID: "user-id", Type: contactapp.ContactTypeUser}}}}
	api := NewContactAPI(stub)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/contacts/users?keyword=alice", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(currentAccountKey, account.Account{ID: "account-id"})

	if err := api.listUsers(c); err != nil {
		t.Fatalf("list users: %v", err)
	}
	if rec.Code != http.StatusOK || stub.usersCommand.AccountID != "account-id" || stub.usersCommand.Keyword != "alice" {
		t.Fatalf("status = %d, command = %#v", rec.Code, stub.usersCommand)
	}
	var response struct {
		Success bool                     `json:"success"`
		Data    listContactUsersResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.Success || len(response.Data.UserIDs) != 1 || response.Data.UserIDs[0] != "user-id" {
		t.Fatalf("response = %#v", response)
	}
}

type contactServiceStub struct {
	listCommand    contactapp.ListCommand
	listResult     contactapp.ListResult
	listErr        error
	usersCommand   contactapp.ListUsersCommand
	usersResult    contactapp.ListUsersResult
	usersErr       error
	resolveCommand contactapp.ResolveUsersCommand
	resolveResult  contactapp.ResolveUsersResult
	resolveErr     error
}

func (s *contactServiceStub) List(_ context.Context, command contactapp.ListCommand) (contactapp.ListResult, error) {
	s.listCommand = command
	return s.listResult, s.listErr
}

func (s *contactServiceStub) ListUsers(_ context.Context, command contactapp.ListUsersCommand) (contactapp.ListUsersResult, error) {
	s.usersCommand = command
	return s.usersResult, s.usersErr
}

func (s *contactServiceStub) ResolveUsers(_ context.Context, command contactapp.ResolveUsersCommand) (contactapp.ResolveUsersResult, error) {
	s.resolveCommand = command
	return s.resolveResult, s.resolveErr
}

func (*contactServiceStub) ListFriendRequests(context.Context, contactapp.ListFriendRequestsCommand) (contactapp.ListFriendRequestsResult, error) {
	return contactapp.ListFriendRequestsResult{}, nil
}
func (*contactServiceStub) CreateFriendRequest(context.Context, contactapp.CreateFriendRequestCommand) (contactapp.FriendRequest, error) {
	return contactapp.FriendRequest{}, nil
}
func (*contactServiceStub) AcceptFriendRequest(context.Context, contactapp.UpdateFriendRequestCommand) (contactapp.FriendRequest, error) {
	return contactapp.FriendRequest{}, nil
}
func (*contactServiceStub) RejectFriendRequest(context.Context, contactapp.UpdateFriendRequestCommand) (contactapp.FriendRequest, error) {
	return contactapp.FriendRequest{}, nil
}
func (*contactServiceStub) CancelFriendRequest(context.Context, contactapp.UpdateFriendRequestCommand) (contactapp.FriendRequest, error) {
	return contactapp.FriendRequest{}, nil
}
func (*contactServiceStub) DeleteFriend(context.Context, contactapp.DeleteFriendCommand) error {
	return nil
}
func (*contactServiceStub) SearchUsers(context.Context, contactapp.SearchUsersCommand) (contactapp.SearchUsersResult, error) {
	return contactapp.SearchUsersResult{}, nil
}
