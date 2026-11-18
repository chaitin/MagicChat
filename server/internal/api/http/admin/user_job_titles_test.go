package admin

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
)

func (s *fakeUserManagementService) JobTitles(_ context.Context, keyword string) ([]string, error) {
	return []string{"工程师"}, nil
}

func TestUserJobTitlesRoute(t *testing.T) {
	router := echo.New()
	NewUserAPI(&fakeUserManagementService{}).RegisterRoutes(router.Group("/api/admin"))
	response := performAdminUserRequest(router, http.MethodGet, "/api/admin/users/job-titles?keyword=工程", nil)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"titles":["工程师"]`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
