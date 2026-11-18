package client

import (
	"errors"
	"net/http"
	"strconv"

	"app/internal/application/organization"

	"github.com/labstack/echo/v4"
)

type OrganizationAPI struct{ organization *organization.Service }

func NewOrganizationAPI(reader *organization.Service) *OrganizationAPI {
	return &OrganizationAPI{organization: reader}
}

func (a *OrganizationAPI) RegisterRoutes(group *echo.Group) {
	group.GET("/organization", a.snapshot)
	group.GET("/organization/departments/:id/members", a.members)
	group.GET("/organization/users/:id/assignments", a.assignments)
}

func (a *OrganizationAPI) snapshot(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	value, err := a.organization.SnapshotForViewer(c.Request().Context(), current.ID)
	if err != nil {
		return writeFailure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	return writeSuccess(c, http.StatusOK, value)
}

func (a *OrganizationAPI) members(c echo.Context) error {
	page, _ := strconv.Atoi(c.QueryParam("page"))
	pageSize, _ := strconv.Atoi(c.QueryParam("page_size"))
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	readMembers := a.organization.MembersForViewer
	if c.QueryParam("include_descendants") == "true" {
		readMembers = a.organization.NodeMembersForViewer
	}
	value, err := readMembers(c.Request().Context(), current.ID, c.Param("id"), page, pageSize)
	if err != nil {
		return organizationReadError(c, err)
	}
	return writeSuccess(c, http.StatusOK, value)
}

func (a *OrganizationAPI) assignments(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	value, err := a.organization.AssignmentsForViewer(c.Request().Context(), current.ID, c.Param("id"))
	if err != nil {
		return organizationReadError(c, err)
	}
	reporting, err := a.organization.ReportingForViewer(c.Request().Context(), current.ID, c.Param("id"))
	if err != nil {
		return organizationReadError(c, err)
	}
	return writeSuccess(c, http.StatusOK, map[string]any{"assignments": value, "reporting": reporting})
}

func organizationReadError(c echo.Context, err error) error {
	if errors.Is(err, organization.ErrInvalid) {
		return writeFailure(c, http.StatusBadRequest, "invalid_request", "组织架构参数无效")
	}
	if errors.Is(err, organization.ErrNotFound) {
		return writeFailure(c, http.StatusNotFound, "not_found", "组织架构记录不存在")
	}
	return writeFailure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
}
