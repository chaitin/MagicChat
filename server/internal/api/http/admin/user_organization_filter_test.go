package admin

import (
	"net/http"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestUserAPIForwardsDepartmentScope(t *testing.T) {
	service := &fakeUserManagementService{}
	router := echo.New()
	NewUserAPI(service).RegisterRoutes(router.Group("/api/admin"))
	ids := "00000000-0000-0000-0000-000000000001,00000000-0000-0000-0000-000000000002"
	response := performAdminUserRequest(router, http.MethodGet, "/api/admin/users?department_ids="+ids, nil)
	if response.Code != http.StatusOK || service.listCommand.DepartmentIDs != ids {
		t.Fatalf("scope not forwarded: %d %#v", response.Code, service.listCommand)
	}
}
