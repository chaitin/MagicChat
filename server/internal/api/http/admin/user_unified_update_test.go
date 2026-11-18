package admin

import (
	"bytes"
	"net/http"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestUnifiedUserUpdateBindsOrganizationAndTrustedActor(t *testing.T) {
	service := &editingUserService{}
	router := echo.New()
	router.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set("admin_session_id", "session-1")
			return next(c)
		}
	})
	NewUserAPI(service).RegisterRoutes(router.Group("/api/admin"))
	response := performAdminUserRequest(router, http.MethodPut, "/api/admin/users/user-1", bytes.NewBufferString(
		`{"name":"成员","email":"member@example.test","actor":"forged","job_title":"工程师","assignments":[{"department_id":"dept-1","is_primary":true}],"reporting":{"direct_manager_user_id":"manager-1","dotted_manager_user_ids":["manager-2"]}}`))
	cmd := service.command
	if response.Code != http.StatusOK || cmd.Actor != "admin:session-1" || cmd.Assignments == nil || len(*cmd.Assignments) != 1 ||
		cmd.JobTitle == nil || *cmd.JobTitle != "工程师" || cmd.Reporting == nil || cmd.Reporting.DirectManagerUserID == nil ||
		*cmd.Reporting.DirectManagerUserID != "manager-1" || len(cmd.Reporting.DottedManagerUserIDs) != 1 {
		t.Fatalf("request not forwarded: %d %#v %s", response.Code, cmd, response.Body.String())
	}
}
