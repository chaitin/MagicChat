package client

import (
	"net/http"
	"time"

	appapp "app/internal/application/app"

	"github.com/labstack/echo/v4"
)

const (
	maxClientAppAvatarRequestBytes = appapp.MaxAvatarBytes + 1*1024*1024
	maxClientAppJSONRequestBytes   = 64 * 1024
)

type AppAPI struct {
	apps appapp.ClientService
}

type createClientAppRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Visibility  string   `json:"visibility"`
	UserIDs     []string `json:"user_ids"`
}

type updateClientAppRequest struct {
	Name        *string   `json:"name"`
	Description *string   `json:"description"`
	Visibility  *string   `json:"visibility"`
	UserIDs     *[]string `json:"user_ids"`
}

type clientAppResponse struct {
	Avatar           string    `json:"avatar"`
	ConnectionStatus string    `json:"connection_status"`
	CreatedAt        time.Time `json:"created_at" format:"date-time"`
	Description      string    `json:"description"`
	Enabled          bool      `json:"enabled"`
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	UpdatedAt        time.Time `json:"updated_at" format:"date-time"`
	UserIDs          []string  `json:"user_ids"`
	Visibility       string    `json:"visibility"`
}

type clientAppEnvelope struct {
	App clientAppResponse `json:"app"`
}

type listClientAppsResponse struct {
	Apps []clientAppResponse `json:"apps"`
}

type clientAppCredentialResponse struct {
	App              clientAppResponse `json:"app"`
	ConnectionSecret string            `json:"connection_secret"`
}

func NewAppAPI(apps appapp.ClientService) *AppAPI {
	return &AppAPI{apps: apps}
}

func (a *AppAPI) RegisterRoutes(group *echo.Group) {
	group.GET("/apps", a.list)
	group.POST("/apps", a.create)
	group.GET("/apps/:app_id", a.get)
	group.PATCH("/apps/:app_id", a.update)
	group.DELETE("/apps/:app_id", a.delete)
	group.POST("/apps/:app_id/avatar", a.uploadAvatar)
	group.POST("/apps/:app_id/enable", a.enable)
	group.POST("/apps/:app_id/disable", a.disable)
	group.POST("/apps/:app_id/secret/regenerate", a.regenerateSecret)
}

// list godoc
//
// @Summary 列出当前用户创建的应用
// @Tags 客户端应用
// @Produce json
// @Success 200 {object} successEnvelope{data=listClientAppsResponse}
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/apps [get]
func (a *AppAPI) list(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(appapp.CodeInternal), "服务端错误")
	}
	values, err := a.apps.ListOwned(c.Request().Context(), current.ID)
	if err != nil {
		return writeClientAppError(c, err)
	}
	apps := make([]clientAppResponse, 0, len(values))
	for _, value := range values {
		apps = append(apps, newClientAppResponse(value))
	}
	return writeSuccess(c, http.StatusOK, listClientAppsResponse{Apps: apps})
}

// create godoc
//
// @Summary 创建用户应用
// @Description 创建应用并仅在本次响应中返回连接密钥。
// @Tags 客户端应用
// @Accept json
// @Produce json
// @Param body body createClientAppRequest true "应用配置"
// @Success 201 {object} successEnvelope{data=clientAppCredentialResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 413 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/apps [post]
func (a *AppAPI) create(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(appapp.CodeInternal), "服务端错误")
	}
	c.Request().Body = http.MaxBytesReader(c.Response().Writer, c.Request().Body, maxClientAppJSONRequestBytes)
	var req createClientAppRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		if isRequestBodyTooLarge(err) {
			return writeFailure(c, http.StatusRequestEntityTooLarge, string(appapp.CodeRequestTooLarge), "请求内容不能超过 64 KiB")
		}
		return writeFailure(c, http.StatusBadRequest, string(appapp.CodeInvalidRequest), "请求格式错误")
	}
	created, err := a.apps.CreateOwned(c.Request().Context(), appapp.CreateOwnedCommand{
		AccountID: current.ID, Name: req.Name, Description: req.Description,
		Visibility: req.Visibility, UserIDs: req.UserIDs,
	})
	if err != nil {
		return writeClientAppError(c, err)
	}
	return writeSuccess(c, http.StatusCreated, clientAppCredentialResponse{
		App: newClientAppResponse(created), ConnectionSecret: created.ConnectionSecret,
	})
}

// get godoc
//
// @Summary 获取当前用户创建的应用
// @Tags 客户端应用
// @Produce json
// @Param app_id path string true "应用 ID"
// @Success 200 {object} successEnvelope{data=clientAppEnvelope}
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/apps/{app_id} [get]
func (a *AppAPI) get(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(appapp.CodeInternal), "服务端错误")
	}
	value, err := a.apps.GetOwned(c.Request().Context(), appapp.OwnedAppCommand{
		AccountID: current.ID, AppID: c.Param("app_id"),
	})
	if err != nil {
		return writeClientAppError(c, err)
	}
	return writeSuccess(c, http.StatusOK, clientAppEnvelope{App: newClientAppResponse(value)})
}

// update godoc
//
// @Summary 更新当前用户创建的应用
// @Description 更新名称、备注、可见范围或 restricted 授权用户。
// @Tags 客户端应用
// @Accept json
// @Produce json
// @Param app_id path string true "应用 ID"
// @Param body body updateClientAppRequest true "应用更新配置"
// @Success 200 {object} successEnvelope{data=clientAppEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 413 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/apps/{app_id} [patch]
func (a *AppAPI) update(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(appapp.CodeInternal), "服务端错误")
	}
	c.Request().Body = http.MaxBytesReader(c.Response().Writer, c.Request().Body, maxClientAppJSONRequestBytes)
	var req updateClientAppRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		if isRequestBodyTooLarge(err) {
			return writeFailure(c, http.StatusRequestEntityTooLarge, string(appapp.CodeRequestTooLarge), "请求内容不能超过 64 KiB")
		}
		return writeFailure(c, http.StatusBadRequest, string(appapp.CodeInvalidRequest), "请求格式错误")
	}
	updated, err := a.apps.UpdateOwned(c.Request().Context(), appapp.UpdateOwnedCommand{
		AccountID: current.ID, AppID: c.Param("app_id"), Name: req.Name,
		Description: req.Description, Visibility: req.Visibility, UserIDs: req.UserIDs,
	})
	if err != nil {
		return writeClientAppError(c, err)
	}
	return writeSuccess(c, http.StatusOK, clientAppEnvelope{App: newClientAppResponse(updated)})
}

// delete godoc
//
// @Summary 删除当前用户创建的应用
// @Tags 客户端应用
// @Produce json
// @Param app_id path string true "应用 ID"
// @Success 200 {object} successEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/apps/{app_id} [delete]
func (a *AppAPI) delete(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(appapp.CodeInternal), "服务端错误")
	}
	if err := a.apps.DeleteOwned(c.Request().Context(), appapp.OwnedAppCommand{
		AccountID: current.ID, AppID: c.Param("app_id"),
	}); err != nil {
		return writeClientAppError(c, err)
	}
	return writeSuccess(c, http.StatusOK, map[string]any{})
}

// enable godoc
//
// @Summary 启用应用
// @Tags 客户端应用
// @Produce json
// @Param app_id path string true "应用 ID"
// @Success 200 {object} successEnvelope{data=clientAppEnvelope}
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/apps/{app_id}/enable [post]
func (a *AppAPI) enable(c echo.Context) error { return a.setEnabled(c, true) }

// disable godoc
//
// @Summary 禁用应用
// @Description 禁用应用并关闭该应用已有连接。
// @Tags 客户端应用
// @Produce json
// @Param app_id path string true "应用 ID"
// @Success 200 {object} successEnvelope{data=clientAppEnvelope}
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/apps/{app_id}/disable [post]
func (a *AppAPI) disable(c echo.Context) error { return a.setEnabled(c, false) }

func (a *AppAPI) setEnabled(c echo.Context, enabled bool) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(appapp.CodeInternal), "服务端错误")
	}
	value, err := a.apps.SetOwnedEnabled(c.Request().Context(), appapp.SetOwnedEnabledCommand{
		AccountID: current.ID, AppID: c.Param("app_id"), Enabled: enabled,
	})
	if err != nil {
		return writeClientAppError(c, err)
	}
	return writeSuccess(c, http.StatusOK, clientAppEnvelope{App: newClientAppResponse(value)})
}

// regenerateSecret godoc
//
// @Summary 重置应用连接密钥
// @Description 返回新密钥并关闭该应用已有连接，旧密钥立即失效。
// @Tags 客户端应用
// @Produce json
// @Param app_id path string true "应用 ID"
// @Success 200 {object} successEnvelope{data=clientAppCredentialResponse}
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/apps/{app_id}/secret/regenerate [post]
func (a *AppAPI) regenerateSecret(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(appapp.CodeInternal), "服务端错误")
	}
	value, err := a.apps.RegenerateOwnedSecret(c.Request().Context(), appapp.OwnedAppCommand{
		AccountID: current.ID, AppID: c.Param("app_id"),
	})
	if err != nil {
		return writeClientAppError(c, err)
	}
	return writeSuccess(c, http.StatusOK, clientAppCredentialResponse{
		App: newClientAppResponse(value), ConnectionSecret: value.ConnectionSecret,
	})
}

// uploadAvatar godoc
//
// @Summary 上传应用头像
// @Description 头像必须是 256x256 WebP，最大 1MiB。
// @Tags 客户端应用
// @Accept multipart/form-data
// @Produce json
// @Param app_id path string true "应用 ID"
// @Param file formData file true "应用头像"
// @Success 200 {object} successEnvelope{data=clientAppEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 413 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/apps/{app_id}/avatar [post]
func (a *AppAPI) uploadAvatar(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(appapp.CodeInternal), "服务端错误")
	}
	c.Request().Body = http.MaxBytesReader(c.Response().Writer, c.Request().Body, maxClientAppAvatarRequestBytes)
	header, err := c.FormFile("file")
	if err != nil {
		return writeFailure(c, http.StatusBadRequest, string(appapp.CodeInvalidRequest), "请选择要上传的头像")
	}
	if header.Size > appapp.MaxAvatarBytes {
		return writeFailure(c, http.StatusRequestEntityTooLarge, string(appapp.CodeRequestTooLarge), "头像文件不能超过 1MiB")
	}
	file, err := header.Open()
	if err != nil {
		return writeFailure(c, http.StatusBadRequest, string(appapp.CodeInvalidRequest), "读取头像失败")
	}
	defer file.Close()
	value, err := a.apps.UploadOwnedAvatar(c.Request().Context(), appapp.UploadOwnedAvatarCommand{
		AccountID: current.ID, AppID: c.Param("app_id"), Content: file, Size: header.Size,
	})
	if err != nil {
		return writeClientAppError(c, err)
	}
	return writeSuccess(c, http.StatusOK, clientAppEnvelope{App: newClientAppResponse(value)})
}

func newClientAppResponse(value appapp.App) clientAppResponse {
	userIDs := value.GrantedUserIDs
	if userIDs == nil {
		userIDs = []string{}
	}
	return clientAppResponse{
		Avatar: value.Avatar, ConnectionStatus: value.ConnectionStatus,
		CreatedAt: value.CreatedAt, Description: value.Description, Enabled: value.Enabled,
		ID: value.ID, Name: value.Name, UpdatedAt: value.UpdatedAt,
		UserIDs: userIDs, Visibility: value.Visibility,
	}
}

func writeClientAppError(c echo.Context, err error) error {
	status := http.StatusInternalServerError
	switch appapp.ErrorCodeOf(err) {
	case appapp.CodeInvalidRequest:
		status = http.StatusBadRequest
	case appapp.CodeNotFound:
		status = http.StatusNotFound
	case appapp.CodeForbidden:
		status = http.StatusForbidden
	case appapp.CodeRequestTooLarge:
		status = http.StatusRequestEntityTooLarge
	}
	return writeFailure(c, status, string(appapp.ErrorCodeOf(err)), appapp.ErrorMessage(err))
}
