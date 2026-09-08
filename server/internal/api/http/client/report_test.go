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
	reportapp "app/internal/application/report"

	"github.com/labstack/echo/v4"
)

func TestReportAPICreatesReportForCurrentAccount(t *testing.T) {
	now := time.Date(2026, 9, 7, 8, 0, 0, 0, time.UTC)
	service := &fakeClientReportService{value: reportapp.Report{
		ID: "report-1", ConversationID: "conversation-1",
		Reason: reportapp.ReasonSpam, Description: "垃圾广告", CreatedAt: now,
		ReportedUser: reportapp.UserSummary{ID: "target-1"},
	}}
	router := echo.New()
	group := router.Group("/api/client", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set(currentAccountKey, account.Account{ID: "reporter-1"})
			return next(c)
		}
	})
	NewReportAPI(service).RegisterRoutes(group)

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/client/conversations/conversation-1/reports",
		bytes.NewBufferString(`{"reason":"spam","description":"垃圾广告"}`),
	)
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if service.command.AccountID != "reporter-1" || service.command.ConversationID != "conversation-1" {
		t.Fatalf("command = %#v", service.command)
	}
	var payload struct {
		Data struct {
			Report userReportResponse `json:"report"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || payload.Data.Report.ID != "report-1" {
		t.Fatalf("response = %s, err = %v", response.Body.String(), err)
	}
}

type fakeClientReportService struct {
	command reportapp.CreateCommand
	value   reportapp.Report
	err     error
}

func (f *fakeClientReportService) Create(_ context.Context, command reportapp.CreateCommand) (reportapp.Report, error) {
	f.command = command
	return f.value, f.err
}
