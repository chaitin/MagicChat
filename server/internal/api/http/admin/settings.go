package admin

import (
	"net/http"

	settingsapp "app/internal/application/settings"

	"github.com/labstack/echo/v4"
)

type SettingsAPI struct {
	settings settingsapp.AdminService
}

type infoSettingsResponse struct {
	AppName             string                             `json:"app_name" example:"即应"`
	OrganizationName    string                             `json:"organization_name" example:"长亭科技"`
	ThirdPartyProviders []publicThirdPartyProviderResponse `json:"third_party_providers"`
}

type publicThirdPartyProviderResponse struct {
	Key  string `json:"key" example:"company-sso"`
	Name string `json:"name" example:"企业 SSO"`
}

type updateInfoSettingsRequest struct {
	AppName          string `json:"app_name" example:"即应"`
	OrganizationName string `json:"organization_name" example:"长亭科技"`
}

type assistantSettingsResponse struct {
	AutoGroupNamingEnabled      bool `json:"auto_group_naming_enabled" example:"true"`
	AutoGroupNamingMessageCount int  `json:"auto_group_naming_message_count" example:"5"`
}

type updateAssistantSettingsRequest struct {
	AutoGroupNamingEnabled      *bool `json:"auto_group_naming_enabled"`
	AutoGroupNamingMessageCount int   `json:"auto_group_naming_message_count"`
}

type successEnvelope struct {
	Success bool `json:"success" example:"true"`
	Data    any  `json:"data"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorEnvelope struct {
	Success bool      `json:"success" example:"false"`
	Error   errorBody `json:"error"`
}

func NewSettingsAPI(settings settingsapp.AdminService) *SettingsAPI {
	return &SettingsAPI{settings: settings}
}

func (a *SettingsAPI) RegisterRoutes(group *echo.Group) {
	group.GET("/settings/info", a.getInfoSettings)
	group.PUT("/settings/info", a.updateInfoSettings)
	group.GET("/settings/assistant", a.getAssistantSettings)
	group.PUT("/settings/assistant", a.updateAssistantSettings)
}

// getAssistantSettings godoc
//
// @Summary 获取茉莉设置
// @Description 管理员读取群聊自动命名开关和消息条数。
// @Tags 管理员设置
// @Produce json
// @Success 200 {object} successEnvelope{data=assistantSettingsResponse}
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/settings/assistant [get]
func (a *SettingsAPI) getAssistantSettings(c echo.Context) error {
	value, err := a.settings.GetAssistant(c.Request().Context())
	if err != nil {
		return writeSettingsError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newAssistantSettingsResponse(value))
}

// updateAssistantSettings godoc
//
// @Summary 更新茉莉设置
// @Description 管理员更新群聊自动命名开关和消息条数。
// @Tags 管理员设置
// @Accept json
// @Produce json
// @Param body body updateAssistantSettingsRequest true "茉莉设置"
// @Success 200 {object} successEnvelope{data=assistantSettingsResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/settings/assistant [put]
func (a *SettingsAPI) updateAssistantSettings(c echo.Context) error {
	var req updateAssistantSettingsRequest
	if err := c.Bind(&req); err != nil || req.AutoGroupNamingEnabled == nil {
		return writeFailure(c, http.StatusBadRequest, string(settingsapp.CodeInvalidRequest), "请求格式错误")
	}
	value, err := a.settings.UpdateAssistant(c.Request().Context(), settingsapp.UpdateAssistantSettingsCommand{
		AutoGroupNamingEnabled:      *req.AutoGroupNamingEnabled,
		AutoGroupNamingMessageCount: req.AutoGroupNamingMessageCount,
	})
	if err != nil {
		return writeSettingsError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newAssistantSettingsResponse(value))
}

// getInfoSettings godoc
//
// @Summary 获取系统基础信息设置
// @Description 管理员读取 App 名称和组织名称。
// @Tags 管理员设置
// @Produce json
// @Success 200 {object} successEnvelope{data=infoSettingsResponse}
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/settings/info [get]
func (a *SettingsAPI) getInfoSettings(c echo.Context) error {
	value, err := a.settings.Get(c.Request().Context())
	if err != nil {
		return writeSettingsError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newInfoSettingsResponse(value))
}

// updateInfoSettings godoc
//
// @Summary 更新系统基础信息设置
// @Description 管理员更新 App 名称和组织名称。
// @Tags 管理员设置
// @Accept json
// @Produce json
// @Param body body updateInfoSettingsRequest true "基础信息设置"
// @Success 200 {object} successEnvelope{data=infoSettingsResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/settings/info [put]
func (a *SettingsAPI) updateInfoSettings(c echo.Context) error {
	var req updateInfoSettingsRequest
	if err := c.Bind(&req); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(settingsapp.CodeInvalidRequest), "请求格式错误")
	}
	value, err := a.settings.Update(c.Request().Context(), settingsapp.UpdateCommand{
		AppName:          req.AppName,
		OrganizationName: req.OrganizationName,
	})
	if err != nil {
		return writeSettingsError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newInfoSettingsResponse(value))
}

func newInfoSettingsResponse(value settingsapp.Settings) infoSettingsResponse {
	return infoSettingsResponse{
		AppName:             value.AppName,
		OrganizationName:    value.OrganizationName,
		ThirdPartyProviders: []publicThirdPartyProviderResponse{},
	}
}

func newAssistantSettingsResponse(value settingsapp.AssistantSettings) assistantSettingsResponse {
	return assistantSettingsResponse{
		AutoGroupNamingEnabled:      value.AutoGroupNamingEnabled,
		AutoGroupNamingMessageCount: value.AutoGroupNamingMessageCount,
	}
}

func writeSettingsError(c echo.Context, err error) error {
	code := settingsapp.ErrorCodeOf(err)
	status := http.StatusInternalServerError
	if code == settingsapp.CodeInvalidRequest {
		status = http.StatusBadRequest
	}
	return writeFailure(c, status, string(code), settingsapp.ErrorMessage(err))
}

func writeSuccess(c echo.Context, status int, data any) error {
	return c.JSON(status, successEnvelope{Success: true, Data: data})
}

func writeFailure(c echo.Context, status int, code string, message string) error {
	return c.JSON(status, errorEnvelope{
		Success: false,
		Error:   errorBody{Code: code, Message: message},
	})
}
