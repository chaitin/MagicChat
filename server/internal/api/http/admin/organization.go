package admin

import (
	"errors"
	"net/http"
	"strconv"

	"app/internal/application/organization"

	"github.com/labstack/echo/v4"
)

type OrganizationAPI struct {
	organization *organization.Service
	onChanged    func()
}

func NewOrganizationAPI(service *organization.Service, onChanged func()) *OrganizationAPI {
	return &OrganizationAPI{organization: service, onChanged: onChanged}
}

func (a *OrganizationAPI) changed() {
	if a.onChanged != nil {
		a.onChanged()
	}
}

func (a *OrganizationAPI) RegisterRoutes(group *echo.Group) {
	group.GET("/organization", a.snapshot)
	group.GET("/organization/policy", a.policy)
	group.PUT("/organization/policy", a.setPolicy)
	group.POST("/organization/units", a.createUnit)
	group.PUT("/organization/units/:id", a.updateUnit)
	group.PUT("/organization/units/:id/leader", a.setUnitLeader)
	group.DELETE("/organization/units/:id", a.deleteUnit)
	group.POST("/organization/departments", a.createDepartment)
	group.PUT("/organization/departments/:id", a.updateDepartment)
	group.DELETE("/organization/departments/:id", a.deleteDepartment)
	group.PUT("/organization/departments/:id/leaders", a.setLeaders)
	group.GET("/organization/departments/:id/members", a.members)
	group.GET("/organization/users/:id/assignments", a.assignments)
	group.PUT("/organization/users/:id/assignments", a.setAssignments)
	group.PUT("/organization/users/:id/reporting", a.setReporting)
}

func (a *OrganizationAPI) setUnitLeader(c echo.Context) error {
	var input struct {
		LeaderUserID *string `json:"leader_user_id"`
	}
	if err := c.Bind(&input); err != nil {
		return organizationError(c, organization.ErrInvalid)
	}
	if err := a.organization.SetUnitLeader(c.Request().Context(), adminActor(c), c.Param("id"), input.LeaderUserID); err != nil {
		return organizationError(c, err)
	}
	a.changed()
	return a.snapshot(c)
}

func (a *OrganizationAPI) policy(c echo.Context) error {
	value, err := a.organization.Policy(c.Request().Context())
	if err != nil {
		return organizationError(c, err)
	}
	return writeSuccess(c, http.StatusOK, value)
}

func (a *OrganizationAPI) setPolicy(c echo.Context) error {
	var input organization.Policy
	if err := c.Bind(&input); err != nil {
		return organizationError(c, organization.ErrInvalid)
	}
	value, err := a.organization.SetPolicy(c.Request().Context(), adminActor(c), input)
	if err != nil {
		return organizationError(c, err)
	}
	a.changed()
	return writeSuccess(c, http.StatusOK, value)
}

func (a *OrganizationAPI) snapshot(c echo.Context) error {
	value, err := a.organization.Snapshot(c.Request().Context())
	if err != nil {
		return organizationError(c, err)
	}
	return writeSuccess(c, http.StatusOK, value)
}

func (a *OrganizationAPI) createUnit(c echo.Context) error {
	var input organization.UnitInput
	if err := c.Bind(&input); err != nil {
		return organizationError(c, organization.ErrInvalid)
	}
	value, err := a.organization.CreateUnit(c.Request().Context(), adminActor(c), input)
	if err != nil {
		return organizationError(c, err)
	}
	a.changed()
	return writeSuccess(c, http.StatusCreated, value)
}

func (a *OrganizationAPI) updateUnit(c echo.Context) error {
	var input organization.UnitInput
	if err := c.Bind(&input); err != nil {
		return organizationError(c, organization.ErrInvalid)
	}
	if err := a.organization.UpdateUnit(c.Request().Context(), adminActor(c), c.Param("id"), input); err != nil {
		return organizationError(c, err)
	}
	a.changed()
	return a.snapshot(c)
}

func (a *OrganizationAPI) deleteUnit(c echo.Context) error {
	if err := a.organization.DeleteUnit(c.Request().Context(), adminActor(c), c.Param("id")); err != nil {
		return organizationError(c, err)
	}
	a.changed()
	return a.snapshot(c)
}

func (a *OrganizationAPI) createDepartment(c echo.Context) error {
	var input organization.DepartmentInput
	if err := c.Bind(&input); err != nil {
		return organizationError(c, organization.ErrInvalid)
	}
	value, err := a.organization.CreateDepartment(c.Request().Context(), adminActor(c), input)
	if err != nil {
		return organizationError(c, err)
	}
	a.changed()
	return writeSuccess(c, http.StatusCreated, value)
}

func (a *OrganizationAPI) updateDepartment(c echo.Context) error {
	var input organization.DepartmentInput
	if err := c.Bind(&input); err != nil {
		return organizationError(c, organization.ErrInvalid)
	}
	if err := a.organization.UpdateDepartment(c.Request().Context(), adminActor(c), c.Param("id"), input); err != nil {
		return organizationError(c, err)
	}
	a.changed()
	return a.snapshot(c)
}

func (a *OrganizationAPI) deleteDepartment(c echo.Context) error {
	if err := a.organization.DeleteDepartment(c.Request().Context(), adminActor(c), c.Param("id")); err != nil {
		return organizationError(c, err)
	}
	a.changed()
	return a.snapshot(c)
}

func (a *OrganizationAPI) setLeaders(c echo.Context) error {
	var input struct {
		Leaders []organization.Leader `json:"leaders"`
	}
	if err := c.Bind(&input); err != nil {
		return organizationError(c, organization.ErrInvalid)
	}
	if err := a.organization.SetDepartmentLeaders(c.Request().Context(), adminActor(c), c.Param("id"), input.Leaders); err != nil {
		return organizationError(c, err)
	}
	a.changed()
	return a.snapshot(c)
}

func (a *OrganizationAPI) members(c echo.Context) error {
	page, _ := strconv.Atoi(c.QueryParam("page"))
	pageSize, _ := strconv.Atoi(c.QueryParam("page_size"))
	value, err := a.organization.Members(c.Request().Context(), c.Param("id"), page, pageSize)
	if err != nil {
		return organizationError(c, err)
	}
	return writeSuccess(c, http.StatusOK, value)
}

func (a *OrganizationAPI) assignments(c echo.Context) error {
	value, err := a.organization.Assignments(c.Request().Context(), c.Param("id"))
	if err != nil {
		return organizationError(c, err)
	}
	reporting, err := a.organization.Reporting(c.Request().Context(), c.Param("id"))
	if err != nil {
		return organizationError(c, err)
	}
	return writeSuccess(c, http.StatusOK, map[string]any{"assignments": value, "reporting": reporting})
}

func (a *OrganizationAPI) setAssignments(c echo.Context) error {
	var input struct {
		Assignments []organization.AssignmentInput `json:"assignments"`
	}
	if err := c.Bind(&input); err != nil {
		return organizationError(c, organization.ErrInvalid)
	}
	value, err := a.organization.SetAssignments(c.Request().Context(), adminActor(c), c.Param("id"), input.Assignments)
	if err != nil {
		return organizationError(c, err)
	}
	a.changed()
	return writeSuccess(c, http.StatusOK, map[string]any{"assignments": value})
}

func (a *OrganizationAPI) setReporting(c echo.Context) error {
	var input organization.Reporting
	if err := c.Bind(&input); err != nil {
		return organizationError(c, organization.ErrInvalid)
	}
	value, err := a.organization.SetReporting(c.Request().Context(), adminActor(c), c.Param("id"), input)
	if err != nil {
		return organizationError(c, err)
	}
	a.changed()
	return writeSuccess(c, http.StatusOK, value)
}

func organizationError(c echo.Context, err error) error {
	status, code, message := http.StatusInternalServerError, "internal_error", "服务端错误"
	switch {
	case errors.Is(err, organization.ErrInvalid):
		status, code, message = http.StatusBadRequest, "invalid_request", "组织架构参数无效"
	case errors.Is(err, organization.ErrNotFound):
		status, code, message = http.StatusNotFound, "not_found", "组织架构记录不存在"
	case errors.Is(err, organization.ErrConflict):
		status, code, message = http.StatusConflict, "conflict", "组织架构关系冲突，或记录仍有关联数据"
	}
	return writeFailure(c, status, code, message)
}
