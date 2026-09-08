package client

import (
	"net/http"
	"time"

	reportapp "app/internal/application/report"

	"github.com/labstack/echo/v4"
)

const maxUserReportRequestBytes = 16 * 1024

type ReportAPI struct {
	reports reportapp.ClientService
}

type createUserReportRequest struct {
	Description string `json:"description" example:"对方持续发送辱骂内容。"`
	Reason      string `json:"reason" example:"harassment_or_abuse"`
}

type userReportResponse struct {
	ConversationID string    `json:"conversation_id"`
	CreatedAt      time.Time `json:"created_at" format:"date-time"`
	Description    string    `json:"description"`
	ID             string    `json:"id"`
	Reason         string    `json:"reason"`
	ReportedUserID string    `json:"reported_user_id"`
}

type createUserReportResponse struct {
	Report userReportResponse `json:"report"`
}

func NewReportAPI(reports reportapp.ClientService) *ReportAPI {
	return &ReportAPI{reports: reports}
}

func (a *ReportAPI) RegisterRoutes(group *echo.Group) {
	group.POST("/conversations/:conversation_id/reports", a.create)
}

// create godoc
//
// @Summary 举报私聊用户
// @Description 当前用户举报私聊中的另一名用户；被举报用户由服务端根据会话成员推导。
// @Tags 客户端举报
// @Accept json
// @Produce json
// @Param conversation_id path string true "私聊 ID"
// @Param body body createUserReportRequest true "举报信息"
// @Success 201 {object} successEnvelope{data=createUserReportResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 413 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security BearerAuth
// @Security CookieAuth
// @Router /api/client/conversations/{conversation_id}/reports [post]
func (a *ReportAPI) create(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(reportapp.CodeInternal), "服务端错误")
	}
	c.Request().Body = http.MaxBytesReader(c.Response().Writer, c.Request().Body, maxUserReportRequestBytes)
	var request createUserReportRequest
	if err := c.Bind(&request); err != nil {
		if isRequestBodyTooLarge(err) {
			return writeFailure(c, http.StatusRequestEntityTooLarge, string(reportapp.CodeInvalidRequest), "举报内容过大")
		}
		return writeFailure(c, http.StatusBadRequest, string(reportapp.CodeInvalidRequest), "请求格式错误")
	}
	value, err := a.reports.Create(c.Request().Context(), reportapp.CreateCommand{
		AccountID:      current.ID,
		ConversationID: c.Param("conversation_id"),
		Description:    request.Description,
		Reason:         request.Reason,
	})
	if err != nil {
		return writeReportError(c, err)
	}
	return writeSuccess(c, http.StatusCreated, createUserReportResponse{Report: newUserReportResponse(value)})
}

func newUserReportResponse(value reportapp.Report) userReportResponse {
	return userReportResponse{
		ConversationID: value.ConversationID,
		CreatedAt:      value.CreatedAt,
		Description:    value.Description,
		ID:             value.ID,
		Reason:         value.Reason,
		ReportedUserID: value.ReportedUser.ID,
	}
}

func writeReportError(c echo.Context, err error) error {
	switch reportapp.ErrorCodeOf(err) {
	case reportapp.CodeInvalidRequest:
		return writeFailure(c, http.StatusBadRequest, string(reportapp.CodeInvalidRequest), reportapp.ErrorMessage(err))
	case reportapp.CodeNotFound:
		return writeFailure(c, http.StatusNotFound, string(reportapp.CodeNotFound), reportapp.ErrorMessage(err))
	default:
		return writeFailure(c, http.StatusInternalServerError, string(reportapp.CodeInternal), "服务端错误")
	}
}
