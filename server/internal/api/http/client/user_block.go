package client

import (
	"net/http"
	"time"

	userblockapp "app/internal/application/userblock"

	"github.com/labstack/echo/v4"
)

type UserBlockAPI struct {
	blocks userblockapp.ClientService
}

type userBlockStatusResponse struct {
	Blocked   bool       `json:"blocked"`
	BlockedAt *time.Time `json:"blocked_at,omitempty" format:"date-time"`
	UserID    string     `json:"user_id"`
}

func NewUserBlockAPI(blocks userblockapp.ClientService) *UserBlockAPI {
	return &UserBlockAPI{blocks: blocks}
}

func (a *UserBlockAPI) RegisterRoutes(group *echo.Group) {
	group.GET("/blocked-users/:user_id", a.getStatus)
	group.PUT("/blocked-users/:user_id", a.block)
	group.DELETE("/blocked-users/:user_id", a.unblock)
}

// getStatus godoc
//
// @Summary 查询用户黑名单状态
// @Tags 客户端黑名单
// @Produce json
// @Param user_id path string true "目标用户 ID"
// @Success 200 {object} successEnvelope{data=userBlockStatusResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security BearerAuth
// @Security CookieAuth
// @Router /api/client/blocked-users/{user_id} [get]
func (a *UserBlockAPI) getStatus(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(userblockapp.CodeInternal), "服务端错误")
	}
	status, err := a.blocks.GetStatus(c.Request().Context(), userblockapp.Command{
		AccountID: current.ID,
		UserID:    c.Param("user_id"),
	})
	if err != nil {
		return writeUserBlockError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newUserBlockStatusResponse(status))
}

// block godoc
//
// @Summary 将用户加入黑名单
// @Description 加入后，对方不能再向当前用户发送私聊消息；当前用户仍可向对方发送消息。
// @Tags 客户端黑名单
// @Produce json
// @Param user_id path string true "目标用户 ID"
// @Success 200 {object} successEnvelope{data=userBlockStatusResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security BearerAuth
// @Security CookieAuth
// @Router /api/client/blocked-users/{user_id} [put]
func (a *UserBlockAPI) block(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(userblockapp.CodeInternal), "服务端错误")
	}
	status, err := a.blocks.Block(c.Request().Context(), userblockapp.Command{
		AccountID: current.ID,
		UserID:    c.Param("user_id"),
	})
	if err != nil {
		return writeUserBlockError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newUserBlockStatusResponse(status))
}

// unblock godoc
//
// @Summary 将用户移出黑名单
// @Tags 客户端黑名单
// @Produce json
// @Param user_id path string true "目标用户 ID"
// @Success 200 {object} successEnvelope{data=userBlockStatusResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security BearerAuth
// @Security CookieAuth
// @Router /api/client/blocked-users/{user_id} [delete]
func (a *UserBlockAPI) unblock(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(userblockapp.CodeInternal), "服务端错误")
	}
	if err := a.blocks.Unblock(c.Request().Context(), userblockapp.Command{
		AccountID: current.ID,
		UserID:    c.Param("user_id"),
	}); err != nil {
		return writeUserBlockError(c, err)
	}
	return writeSuccess(c, http.StatusOK, userBlockStatusResponse{
		Blocked: false,
		UserID:  c.Param("user_id"),
	})
}

func newUserBlockStatusResponse(status userblockapp.Status) userBlockStatusResponse {
	return userBlockStatusResponse{
		Blocked: status.Blocked, BlockedAt: status.BlockedAt, UserID: status.UserID,
	}
}

func writeUserBlockError(c echo.Context, err error) error {
	switch userblockapp.ErrorCodeOf(err) {
	case userblockapp.CodeInvalidRequest:
		return writeFailure(c, http.StatusBadRequest, string(userblockapp.CodeInvalidRequest), userblockapp.ErrorMessage(err))
	case userblockapp.CodeNotFound:
		return writeFailure(c, http.StatusNotFound, string(userblockapp.CodeNotFound), userblockapp.ErrorMessage(err))
	default:
		return writeFailure(c, http.StatusInternalServerError, string(userblockapp.CodeInternal), "服务端错误")
	}
}
