package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	reportapp "app/internal/application/report"

	"github.com/labstack/echo/v4"
)

func TestReportAPIListsReportHistory(t *testing.T) {
	service := &fakeAdminReportService{result: reportapp.ListResult{
		Page: 2, PageSize: 20, Total: 21,
		Reports: []reportapp.Report{{
			ID: "report-1", ConversationID: "conversation-1",
			Reason: reportapp.ReasonFraud, Description: "疑似诈骗",
			CreatedAt:    time.Date(2026, 9, 7, 8, 0, 0, 0, time.UTC),
			ReportedUser: reportapp.UserSummary{ID: "target-1", Name: "张三"},
			ReporterUser: reportapp.UserSummary{ID: "reporter-1", Name: "李四"},
		}},
	}}
	router := echo.New()
	NewReportAPI(service).RegisterRoutes(router.Group("/api/admin"))
	request := httptest.NewRequest(http.MethodGet, "/api/admin/reports?page=2&page_size=20", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK || service.query.Page != 2 || service.query.PageSize != 20 {
		t.Fatalf("status = %d, query = %#v, body = %s", response.Code, service.query, response.Body.String())
	}
	var payload struct {
		Data listAdminReportsResponse `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || len(payload.Data.Reports) != 1 || payload.Data.Reports[0].ReportedUser.ID != "target-1" {
		t.Fatalf("response = %s, err = %v", response.Body.String(), err)
	}
}

type fakeAdminReportService struct {
	query  reportapp.ListQuery
	result reportapp.ListResult
	err    error
}

func (f *fakeAdminReportService) List(_ context.Context, query reportapp.ListQuery) (reportapp.ListResult, error) {
	f.query = query
	return f.result, f.err
}
