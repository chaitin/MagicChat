package client

import (
	"net/http"
	"time"

	"app/internal/application/mobilepush"

	"github.com/labstack/echo/v4"
)

type PushAPI struct {
	push mobilepush.ClientService
}

type registerPushGrantRequest struct {
	InstallationID string    `json:"installation_id"`
	GrantID        string    `json:"grant_id"`
	SendToken      string    `json:"send_token"`
	Platform       string    `json:"platform"`
	ExpiresAt      time.Time `json:"expires_at"`
}

type pushGrantResponse struct {
	InstallationID string    `json:"installation_id"`
	GrantID        string    `json:"grant_id"`
	Platform       string    `json:"platform"`
	ExpiresAt      time.Time `json:"expires_at"`
}

type pushRouteResponse struct {
	ConversationID string `json:"conversation_id"`
	MessageID      string `json:"message_id"`
}

type pushPresenceRequest struct {
	Platform   string `json:"platform" enums:"ios,android,desktop" binding:"required"`
	Foreground *bool  `json:"foreground" binding:"required"`
}

type pushPreferencesRequest struct {
	PauseWhenDesktopActive *bool `json:"pause_when_desktop_active" binding:"required"`
}

type pushPreferencesResponse struct {
	PauseWhenDesktopActive bool `json:"pause_when_desktop_active"`
}

type pushJobStatusResponse struct {
	Status    string    `json:"status"`
	Reason    string    `json:"reason"`
	UpdatedAt time.Time `json:"updated_at"`
}

type pushStatusResponse struct {
	Enabled       bool                   `json:"enabled"`
	Registered    bool                   `json:"registered"`
	Foreground    bool                   `json:"foreground"`
	DesktopActive bool                   `json:"desktop_active"`
	DelaySeconds  int                    `json:"delay_seconds"`
	LastJob       *pushJobStatusResponse `json:"last_job"`
}

type revokePushGrantRequest struct {
	GrantID string `json:"grant_id"`
}

type resolvePushRouteRequest struct {
	RouteToken string `json:"route_token"`
}

func NewPushAPI(push mobilepush.ClientService) *PushAPI {
	return &PushAPI{push: push}
}

func (a *PushAPI) RegisterRoutes(group *echo.Group) {
	group.PUT("/push/grants", a.registerGrant)
	group.POST("/push/grants/:installation_id/revoke", a.revokeGrant)
	group.POST("/push/routes/resolve", a.resolveRoute)
	group.PUT("/push/presence", a.reportPresence)
	group.GET("/push/preferences", a.getPreferences)
	group.PUT("/push/preferences", a.setPreferences)
	group.GET("/push/status", a.pushStatus)
}

// reportPresence godoc
// @Summary 更新当前登录设备的前台活跃租约
// @Tags 客户端推送
// @Accept json
// @Produce json
// @Param request body pushPresenceRequest true "设备前台状态，不接受客户端指定用户或Session"
// @Success 200 {object} successEnvelope
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Router /api/client/push/presence [put]
func (a *PushAPI) reportPresence(c echo.Context) error {
	current, ok := CurrentAccount(c)
	session, sessionOK := CurrentAccountSession(c)
	if !ok || !sessionOK {
		return writeFailure(c, http.StatusUnauthorized, "unauthorized", "未登录")
	}
	var input pushPresenceRequest
	if err := decodeStrictJSON(c, &input); err != nil || input.Foreground == nil {
		return writeFailure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}
	if err := a.push.ReportPresence(c.Request().Context(), mobilepush.PresenceCommand{
		UserID: current.ID, SessionID: session.ID, Platform: input.Platform, Foreground: *input.Foreground,
	}); err != nil {
		return writePushError(c, err)
	}
	return writeSuccess(c, http.StatusOK, map[string]bool{"foreground": *input.Foreground})
}

// getPreferences godoc
// @Summary 读取当前账号的手机推送策略
// @Tags 客户端推送
// @Produce json
// @Success 200 {object} successEnvelope{data=pushPreferencesResponse}
// @Failure 401 {object} errorEnvelope
// @Router /api/client/push/preferences [get]
func (a *PushAPI) getPreferences(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusUnauthorized, "unauthorized", "未登录")
	}
	value, err := a.push.GetPreferences(c.Request().Context(), current.ID)
	if err != nil {
		return writePushError(c, err)
	}
	return writeSuccess(c, http.StatusOK, pushPreferencesResponse{PauseWhenDesktopActive: value.PauseWhenDesktopActive})
}

// setPreferences godoc
// @Summary 设置电脑活跃时是否暂停手机推送，默认关闭
// @Tags 客户端推送
// @Accept json
// @Produce json
// @Param request body pushPreferencesRequest true "推送策略"
// @Success 200 {object} successEnvelope{data=pushPreferencesResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Router /api/client/push/preferences [put]
func (a *PushAPI) setPreferences(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusUnauthorized, "unauthorized", "未登录")
	}
	var input pushPreferencesRequest
	if err := decodeStrictJSON(c, &input); err != nil || input.PauseWhenDesktopActive == nil {
		return writeFailure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}
	value, err := a.push.SetPreferences(c.Request().Context(), current.ID, mobilepush.PushPreferences{PauseWhenDesktopActive: *input.PauseWhenDesktopActive})
	if err != nil {
		return writePushError(c, err)
	}
	return writeSuccess(c, http.StatusOK, pushPreferencesResponse{PauseWhenDesktopActive: value.PauseWhenDesktopActive})
}

// pushStatus godoc
// @Summary 查询当前登录设备的推送授权和最近任务状态，不代表手机送达回执
// @Tags 客户端推送
// @Produce json
// @Success 200 {object} successEnvelope{data=pushStatusResponse}
// @Failure 401 {object} errorEnvelope
// @Router /api/client/push/status [get]
func (a *PushAPI) pushStatus(c echo.Context) error {
	current, ok := CurrentAccount(c)
	session, sessionOK := CurrentAccountSession(c)
	if !ok || !sessionOK {
		return writeFailure(c, http.StatusUnauthorized, "unauthorized", "未登录")
	}
	value, err := a.push.GetStatus(c.Request().Context(), current.ID, session.ID)
	if err != nil {
		return writePushError(c, err)
	}
	response := pushStatusResponse{Enabled: value.Enabled, Registered: value.Registered, Foreground: value.Foreground, DesktopActive: value.DesktopActive, DelaySeconds: value.DelaySeconds}
	if value.LastJob != nil {
		response.LastJob = &pushJobStatusResponse{Status: value.LastJob.Status, Reason: value.LastJob.Reason, UpdatedAt: value.LastJob.UpdatedAt}
	}
	return writeSuccess(c, http.StatusOK, response)
}

// registerGrant godoc
//
// @Summary 注册当前手机的公共推送授权
// @Tags 客户端推送
// @Accept json
// @Produce json
// @Param request body registerPushGrantRequest true "推送授权"
// @Success 200 {object} successEnvelope{data=pushGrantResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Failure 429 {object} errorEnvelope
// @Failure 503 {object} errorEnvelope
// @Router /api/client/push/grants [put]
func (a *PushAPI) registerGrant(c echo.Context) error {
	current, ok := CurrentAccount(c)
	currentSession, sessionOK := CurrentAccountSession(c)
	if !ok || !sessionOK {
		return writeFailure(c, http.StatusUnauthorized, "unauthorized", "未登录")
	}
	var request registerPushGrantRequest
	if err := decodeStrictJSON(c, &request); err != nil {
		return writeFailure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}
	grant, err := a.push.RegisterGrant(c.Request().Context(), mobilepush.RegisterGrantCommand{
		UserID: current.ID, SessionID: currentSession.ID, InstallationID: request.InstallationID,
		GatewayGrantID: request.GrantID, SendToken: request.SendToken,
		Platform: request.Platform, ExpiresAt: request.ExpiresAt,
	})
	if err != nil {
		return writePushError(c, err)
	}
	return writeSuccess(c, http.StatusOK, pushGrantResponse{
		InstallationID: grant.InstallationID, GrantID: grant.GatewayGrantID,
		Platform: grant.Platform, ExpiresAt: grant.ExpiresAt,
	})
}

// revokeGrant godoc
//
// @Summary 删除当前手机的本地推送授权
// @Tags 客户端推送
// @Accept json
// @Param installation_id path string true "安装实例 ID"
// @Param request body revokePushGrantRequest true "待撤销的公共授权"
// @Success 204
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Router /api/client/push/grants/{installation_id}/revoke [post]
func (a *PushAPI) revokeGrant(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusUnauthorized, "unauthorized", "未登录")
	}
	var request revokePushGrantRequest
	if err := decodeStrictJSON(c, &request); err != nil {
		return writeFailure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}
	if err := a.push.RevokeGrant(c.Request().Context(), current.ID, c.Param("installation_id"), request.GrantID); err != nil {
		return writePushError(c, err)
	}
	return c.NoContent(http.StatusNoContent)
}

// resolveRoute godoc
//
// @Summary 解析通知点击路由
// @Tags 客户端推送
// @Accept json
// @Param request body resolvePushRouteRequest true "匿名路由 Token"
// @Success 200 {object} successEnvelope{data=pushRouteResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Router /api/client/push/routes/resolve [post]
func (a *PushAPI) resolveRoute(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusUnauthorized, "unauthorized", "未登录")
	}
	var request resolvePushRouteRequest
	if err := decodeStrictJSON(c, &request); err != nil {
		return writeFailure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}
	route, err := a.push.ResolveRoute(c.Request().Context(), current.ID, request.RouteToken)
	if err != nil {
		return writePushError(c, err)
	}
	return writeSuccess(c, http.StatusOK, pushRouteResponse{
		ConversationID: route.ConversationID, MessageID: route.MessageID,
	})
}

func writePushError(c echo.Context, err error) error {
	code := mobilepush.ErrorCodeOf(err)
	status := http.StatusInternalServerError
	switch code {
	case "unauthorized":
		status = http.StatusUnauthorized
	case "invalid_request":
		status = http.StatusBadRequest
	case "route_not_found":
		status = http.StatusNotFound
	case "grant_conflict":
		status = http.StatusConflict
	case "grant_limit_reached":
		status = http.StatusTooManyRequests
	case "push_disabled":
		status = http.StatusServiceUnavailable
	}
	return writeFailure(c, status, code, mobilepush.ErrorMessage(err))
}
