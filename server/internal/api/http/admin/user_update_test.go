package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"app/internal/application/usermanagement"
	"github.com/labstack/echo/v4"
)

// Complete the shared service stub for the new administrator operation.
func (s *fakeUserManagementService) Update(_ context.Context, _ usermanagement.UpdateCommand) (usermanagement.User, error) {
	return s.value, nil
}

type editingUserService struct {
	fakeUserManagementService
	command usermanagement.UpdateCommand
	err     error
}

func (s *editingUserService) Update(_ context.Context, cmd usermanagement.UpdateCommand) (usermanagement.User, error) {
	s.command = cmd
	return s.value, s.err
}

func TestAdminUserUpdateRouteAndConflict(t *testing.T) {
	service := &editingUserService{}
	service.value = usermanagement.User{ID: "user-id", Name: "张三", Email: "new@example.com"}
	router := echo.New()
	NewUserAPI(service).RegisterRoutes(router.Group("/api/admin"))
	response := performAdminUserRequest(router, http.MethodPut, "/api/admin/users/user-id", bytes.NewBufferString(`{"name":"张三","email":"new@example.com","phone":"13812345678","nickname":"小张","status":"disabled","password_hash":"ignored"}`))
	if response.Code != http.StatusOK || service.command.UserID != "user-id" || service.command.Nickname != "小张" || service.command.Phone != "13812345678" {
		t.Fatalf("update route: %d %#v %s", response.Code, service.command, response.Body.String())
	}
	var envelope struct {
		Data struct {
			User struct {
				Email string `json:"email"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || envelope.Data.User.Email != "new@example.com" {
		t.Fatalf("response: %s %v", response.Body.String(), err)
	}
	service.err = &usermanagement.Error{Code: usermanagement.CodeConflict, Message: "邮箱已存在"}
	response = performAdminUserRequest(router, http.MethodPut, "/api/admin/users/user-id", bytes.NewBufferString(`{"name":"张三","email":"new@example.com"}`))
	if response.Code != http.StatusConflict {
		t.Fatalf("conflict = %d", response.Code)
	}
	response = performAdminUserRequest(router, http.MethodPut, "/api/admin/users/user-id", bytes.NewBufferString(`{`))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid JSON = %d", response.Code)
	}
}

func TestAdminUserListForwardsOrganizationFlag(t *testing.T) {
	service := &fakeUserManagementService{}
	service.value.Organization = &usermanagement.UserOrganization{UnitName: "单位", DepartmentName: "部门", Title: "工程师"}
	router := echo.New()
	NewUserAPI(service).RegisterRoutes(router.Group("/api/admin"))
	response := performAdminUserRequest(router, http.MethodGet, "/api/admin/users?include_organization=true", nil)
	if response.Code != http.StatusOK || !service.listCommand.IncludeOrganization || !bytes.Contains(response.Body.Bytes(), []byte(`"department_name":"部门"`)) {
		t.Fatalf("organization response: %d %s", response.Code, response.Body.String())
	}
}
