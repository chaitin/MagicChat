package admin

import (
	"net/http"
	"time"

	"app/internal/application/organization"
	"app/internal/application/usermanagement"

	"github.com/labstack/echo/v4"
)

type UserAPI struct {
	users usermanagement.AdminService
}

type createUserRequest struct {
	Assignments  *[]organization.AssignmentInput `json:"assignments"`
	JobTitle     string                          `json:"job_title"`
	DepartmentID string                          `json:"department_id"`
	Email        string                          `json:"email" example:"user@example.com"`
	Name         string                          `json:"name" example:"张三"`
	Phone        string                          `json:"phone" example:"13812345678"`
}

type updateUserRequest struct {
	JobTitle    *string                         `json:"job_title"`
	Assignments *[]organization.AssignmentInput `json:"assignments"`
	Reporting   *organization.Reporting         `json:"reporting"`
	Email       string                          `json:"email"`
	Name        string                          `json:"name"`
	Nickname    string                          `json:"nickname"`
	Phone       string                          `json:"phone"`
}

type userOrganizationResponse struct {
	UnitName       string `json:"unit_name"`
	DepartmentName string `json:"department_name"`
	Title          string `json:"title"`
}

type userResponse struct {
	JobTitle     string                    `json:"job_title"`
	Organization *userOrganizationResponse `json:"organization,omitempty"`
	ID           string                    `json:"id" example:"7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"`
	Avatar       string                    `json:"avatar" example:"/assets/avatars/builtin/07.webp"`
	Email        string                    `json:"email" example:"user@example.com"`
	LastOnlineAt *string                   `json:"last_online_at" example:"2026-07-03T01:00:00Z"`
	Name         string                    `json:"name" example:"张三"`
	Nickname     string                    `json:"nickname" example:"小张"`
	Online       *bool                     `json:"online,omitempty" example:"true"`
	Phone        string                    `json:"phone" example:"+8613812345678"`
	Status       string                    `json:"status" example:"active"`
	CreatedAt    time.Time                 `json:"created_at" format:"date-time"`
}

type createUserResponse struct {
	User            userResponse `json:"user"`
	InitialPassword string       `json:"initial_password" example:"aB3dE5gH7jK9mN2p"`
}

type listUsersResponse struct {
	Users    []userResponse `json:"users"`
	Total    int64          `json:"total" example:"12"`
	Page     int            `json:"page" example:"1"`
	PageSize int            `json:"page_size" example:"20"`
	Sort     string         `json:"sort" example:"created_at"`
	Order    string         `json:"order" example:"desc"`
}

type updateUserStatusResponse struct {
	User userResponse `json:"user"`
}

type resetUserPasswordResponse struct {
	User        userResponse `json:"user"`
	NewPassword string       `json:"new_password" example:"aB3dE5gH7jK9mN2p"`
}

func NewUserAPI(users usermanagement.AdminService) *UserAPI {
	return &UserAPI{users: users}
}

func (a *UserAPI) RegisterRoutes(group *echo.Group) {
	group.GET("/users", a.list)
	group.GET("/users/job-titles", a.jobTitles)
	group.POST("/users", a.create)
	group.PUT("/users/:id", a.update)
	group.POST("/users/:id/disable", a.disable)
	group.POST("/users/:id/enable", a.enable)
	group.POST("/users/:id/reset-password", a.resetPassword)
}

// list godoc
//
// @Summary 列出普通用户
// @Description 管理员列出普通用户。keyword 会同时搜索邮箱、名称、昵称和手机号；online 仅支持 true、false；sort 仅支持 email、created_at、status；order 仅支持 asc、desc。
// @Tags 管理员用户
// @Produce json
// @Param keyword query string false "搜索关键字，匹配邮箱、名称、昵称或手机号"
// @Param online query bool false "在线状态，true 表示在线，false 表示不在线"
// @Param department_ids query string false "部门 ID 列表，以逗号分隔，按成员组织归属筛选并去重"
// @Param include_organization query bool false "返回主归属的单位、部门和成员职务"
// @Param page query int false "页码，从 1 开始"
// @Param page_size query int false "每页数量，最大 1000"
// @Param sort query string false "排序字段：email、created_at、status"
// @Param order query string false "排序方向：asc、desc"
// @Success 200 {object} successEnvelope{data=listUsersResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/users [get]
func (a *UserAPI) list(c echo.Context) error {
	result, err := a.users.List(c.Request().Context(), usermanagement.ListCommand{
		Keyword: c.QueryParam("keyword"), Online: c.QueryParam("online"), Page: c.QueryParam("page"), PageSize: c.QueryParam("page_size"),
		Sort: c.QueryParam("sort"), Order: c.QueryParam("order"), DepartmentIDs: c.QueryParam("department_ids"),
		IncludeOrganization: c.QueryParam("include_organization") == "true",
		UserIDs:             c.QueryParam("user_ids"),
	})
	if err != nil {
		return writeUserManagementError(c, err)
	}
	return writeSuccess(c, http.StatusOK, listUsersResponse{
		Users: newUserResponses(result.Users), Total: result.Total, Page: result.Page,
		PageSize: result.PageSize, Sort: result.Sort, Order: result.Order,
	})
}

// create godoc
//
// @Summary 创建普通用户
// @Description 管理员创建普通用户。邮箱会规范化为小写并全局唯一，手机号可选且非空时全局唯一，初始密码只在本次响应中返回。可通过 department_id 指定所属部门，与账号原子创建。
// @Tags 管理员用户
// @Accept json
// @Produce json
// @Param body body createUserRequest true "用户信息"
// @Success 201 {object} successEnvelope{data=createUserResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/users [post]
func (a *UserAPI) create(c echo.Context) error {
	var req createUserRequest
	if err := c.Bind(&req); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(usermanagement.CodeInvalidRequest), "请求格式错误")
	}
	result, err := a.users.Create(c.Request().Context(), usermanagement.CreateCommand{
		Email: req.Email, Name: req.Name, Phone: req.Phone,
		DepartmentID: req.DepartmentID, Actor: adminActor(c), JobTitle: req.JobTitle, Assignments: req.Assignments,
	})
	if err != nil {
		return writeUserManagementError(c, err)
	}
	return writeSuccess(c, http.StatusCreated, createUserResponse{
		User: newUserResponse(result.User), InitialPassword: result.InitialPassword,
	})
}

// update godoc
//
// @Summary 编辑成员信息
// @Description 原子保存基本资料、成员职务及可选的组织归属、汇报关系，任一校验失败均不保存。邮箱及非空手机号全局唯一，修改邮箱后使用新邮箱登录。
// @Tags 管理员用户
// @Accept json
// @Produce json
// @Param id path string true "用户 ID"
// @Param body body updateUserRequest true "成员基本资料"
// @Success 200 {object} successEnvelope{data=updateUserStatusResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Router /api/admin/users/{id} [put]
func (a *UserAPI) update(c echo.Context) error {
	var req updateUserRequest
	if err := c.Bind(&req); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(usermanagement.CodeInvalidRequest), "请求格式错误")
	}
	user, err := a.users.Update(c.Request().Context(), usermanagement.UpdateCommand{
		UserID: c.Param("id"), Email: req.Email, Name: req.Name, Nickname: req.Nickname, Phone: req.Phone,
		Actor: adminActor(c), Assignments: req.Assignments, Reporting: req.Reporting, JobTitle: req.JobTitle,
	})
	if err != nil {
		return writeUserManagementError(c, err)
	}
	return writeSuccess(c, http.StatusOK, updateUserStatusResponse{User: newUserResponse(user)})
}

// disable godoc
//
// @Summary 禁用普通用户
// @Description 管理员禁用普通用户。禁用后该用户不能继续登录。
// @Tags 管理员用户
// @Produce json
// @Param id path string true "用户 ID"
// @Success 200 {object} successEnvelope{data=updateUserStatusResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/users/{id}/disable [post]
func (a *UserAPI) disable(c echo.Context) error {
	return a.setStatus(c, usermanagement.StatusDisabled)
}

// enable godoc
//
// @Summary 启用普通用户
// @Description 管理员启用普通用户。启用后该用户可以正常登录。
// @Tags 管理员用户
// @Produce json
// @Param id path string true "用户 ID"
// @Success 200 {object} successEnvelope{data=updateUserStatusResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/users/{id}/enable [post]
func (a *UserAPI) enable(c echo.Context) error {
	return a.setStatus(c, usermanagement.StatusActive)
}

// resetPassword godoc
//
// @Summary 重置普通用户密码
// @Description 管理员为普通用户重新生成随机密码。新密码只在本次响应中返回一次，并会清理该用户已有登录 session。
// @Tags 管理员用户
// @Produce json
// @Param id path string true "用户 ID"
// @Success 200 {object} successEnvelope{data=resetUserPasswordResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/users/{id}/reset-password [post]
func (a *UserAPI) resetPassword(c echo.Context) error {
	result, err := a.users.ResetPassword(c.Request().Context(), c.Param("id"))
	if err != nil {
		return writeUserManagementError(c, err)
	}
	return writeSuccess(c, http.StatusOK, resetUserPasswordResponse{
		User: newUserResponse(result.User), NewPassword: result.NewPassword,
	})
}

func (a *UserAPI) setStatus(c echo.Context, status string) error {
	user, err := a.users.SetStatus(c.Request().Context(), usermanagement.SetStatusCommand{
		UserID: c.Param("id"), Status: status,
	})
	if err != nil {
		return writeUserManagementError(c, err)
	}
	return writeSuccess(c, http.StatusOK, updateUserStatusResponse{User: newUserResponse(user)})
}

func newUserResponses(values []usermanagement.User) []userResponse {
	result := make([]userResponse, 0, len(values))
	for _, value := range values {
		result = append(result, newUserResponse(value))
	}
	return result
}

func newUserResponse(value usermanagement.User) userResponse {
	var lastOnlineAt *string
	if value.LastOnlineAt != nil {
		formatted := value.LastOnlineAt.UTC().Format(time.RFC3339)
		lastOnlineAt = &formatted
	}
	online := value.Online
	var organization *userOrganizationResponse
	if value.Organization != nil {
		organization = &userOrganizationResponse{
			UnitName: value.Organization.UnitName, DepartmentName: value.Organization.DepartmentName, Title: value.Organization.Title,
		}
	}
	return userResponse{
		Organization: organization, JobTitle: value.JobTitle,
		ID: value.ID, Avatar: value.Avatar, Email: value.Email, LastOnlineAt: lastOnlineAt,
		Name: value.Name, Nickname: value.Nickname, Online: &online, Phone: value.Phone,
		Status: value.Status, CreatedAt: value.CreatedAt,
	}
}

func writeUserManagementError(c echo.Context, err error) error {
	code := usermanagement.ErrorCodeOf(err)
	status := http.StatusInternalServerError
	switch code {
	case usermanagement.CodeInvalidRequest:
		status = http.StatusBadRequest
	case usermanagement.CodeNotFound:
		status = http.StatusNotFound
	case usermanagement.CodeConflict:
		status = http.StatusConflict
	}
	return writeFailure(c, status, string(code), usermanagement.ErrorMessage(err))
}
