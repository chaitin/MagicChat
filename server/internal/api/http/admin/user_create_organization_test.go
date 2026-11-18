package admin

import (
	"bytes"
	"net/http"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestUserCreateBindsDepartmentAndTrustedActor(t *testing.T) {
	service := &fakeUserManagementService{}
	router := echo.New()
	router.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set("admin_session_id", "create-session")
			return next(c)
		}
	})
	NewUserAPI(service).RegisterRoutes(router.Group("/api/admin"))
	response := performAdminUserRequest(router, http.MethodPost, "/api/admin/users", bytes.NewBufferString(
		`{"name":"成员","email":"member@example.test","department_id":"department-1","actor":"forged"}`))
	if response.Code != http.StatusCreated || service.createCommand.DepartmentID != "department-1" || service.createCommand.Actor != "admin:create-session" {
		t.Fatalf("create binding = %d, %+v, %s", response.Code, service.createCommand, response.Body.String())
	}
}
