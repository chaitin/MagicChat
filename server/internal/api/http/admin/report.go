package admin

import (
	"net/http"
	"strconv"
	"time"

	reportapp "app/internal/application/report"

	"github.com/labstack/echo/v4"
)

type ReportAPI struct {
	reports reportapp.AdminService
}

type reportUserResponse struct {
	Avatar   string `json:"avatar"`
	Email    string `json:"email"`
	ID       string `json:"id"`
	Name     string `json:"name"`
	Nickname string `json:"nickname"`
	Phone    string `json:"phone"`
	Status   string `json:"status"`
}

type adminReportResponse struct {
	ConversationID string             `json:"conversation_id"`
	CreatedAt      time.Time          `json:"created_at" format:"date-time"`
	Description    string             `json:"description"`
	ID             string             `json:"id"`
	Reason         string             `json:"reason"`
	ReportedUser   reportUserResponse `json:"reported_user"`
	ReporterUser   reportUserResponse `json:"reporter_user"`
}

type listAdminReportsResponse struct {
	Page     int                   `json:"page"`
	PageSize int                   `json:"page_size"`
	Reports  []adminReportResponse `json:"reports"`
	Total    int64                 `json:"total"`
}

func NewReportAPI(reports reportapp.AdminService) *ReportAPI {
	return &ReportAPI{reports: reports}
}

func (a *ReportAPI) RegisterRoutes(group *echo.Group) {
	group.GET("/reports", a.list)
}

// list godoc
//
// @Summary 列出用户举报
// @Description 管理员按提交时间倒序查看全部私聊用户举报记录。
// @Tags 管理员举报
// @Produce json
// @Param page query int false "页码" default(1)
// @Param page_size query int false "每页数量" default(20) maximum(100)
// @Success 200 {object} successEnvelope{data=listAdminReportsResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/reports [get]
func (a *ReportAPI) list(c echo.Context) error {
	page, err := parseReportPage(c.QueryParam("page"), 1)
	if err != nil {
		return writeFailure(c, http.StatusBadRequest, string(reportapp.CodeInvalidRequest), "页码无效")
	}
	pageSize, err := parseReportPage(c.QueryParam("page_size"), 20)
	if err != nil || pageSize > 100 {
		return writeFailure(c, http.StatusBadRequest, string(reportapp.CodeInvalidRequest), "每页数量无效")
	}
	result, err := a.reports.List(c.Request().Context(), reportapp.ListQuery{Page: page, PageSize: pageSize})
	if err != nil {
		return writeFailure(c, http.StatusInternalServerError, string(reportapp.CodeInternal), "服务端错误")
	}
	responses := make([]adminReportResponse, 0, len(result.Reports))
	for _, value := range result.Reports {
		responses = append(responses, newAdminReportResponse(value))
	}
	return writeSuccess(c, http.StatusOK, listAdminReportsResponse{
		Page: result.Page, PageSize: result.PageSize, Reports: responses, Total: result.Total,
	})
}

func parseReportPage(raw string, fallback int) (int, error) {
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return 0, strconv.ErrSyntax
	}
	return value, nil
}

func newAdminReportResponse(value reportapp.Report) adminReportResponse {
	return adminReportResponse{
		ConversationID: value.ConversationID,
		CreatedAt:      value.CreatedAt,
		Description:    value.Description,
		ID:             value.ID,
		Reason:         value.Reason,
		ReportedUser:   newReportUserResponse(value.ReportedUser),
		ReporterUser:   newReportUserResponse(value.ReporterUser),
	}
}

func newReportUserResponse(value reportapp.UserSummary) reportUserResponse {
	return reportUserResponse{
		Avatar: value.Avatar, Email: value.Email, ID: value.ID, Name: value.Name,
		Nickname: value.Nickname, Phone: value.Phone, Status: value.Status,
	}
}
