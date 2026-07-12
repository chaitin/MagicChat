package httpserver

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"app/internal/appregistry"
	"app/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

const (
	appConnectionStatusDisabled = "disabled"
	appConnectionStatusOffline  = "offline"
	appConnectionStatusOnline   = "online"
	appSecretBytes              = 32
	maxAppNameLength            = 120
)

type adminAppRequest struct {
	Description string `json:"description"`
	Name        string `json:"name"`
	Visibility  string `json:"visibility"`
}

type adminAppResponse struct {
	Avatar           string    `json:"avatar"`
	ConnectionSecret string    `json:"connection_secret"`
	ConnectionStatus string    `json:"connection_status"`
	CreatedAt        time.Time `json:"created_at" format:"date-time"`
	CreatorUserID    *string   `json:"creator_user_id"`
	Description      string    `json:"description"`
	Enabled          bool      `json:"enabled"`
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	System           bool      `json:"system"`
	UpdatedAt        time.Time `json:"updated_at" format:"date-time"`
	Visibility       string    `json:"visibility"`
}

type listAdminAppsResponse struct {
	Apps []adminAppResponse `json:"apps"`
}

type adminAppEnvelope struct {
	App adminAppResponse `json:"app"`
}

// listAdminApps godoc
//
// @Summary 列出应用
// @Description 管理员读取应用配置，包含连接密钥和连接状态。
// @Tags 管理员应用
// @Produce json
// @Success 200 {object} successEnvelope{data=listAdminAppsResponse}
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/apps [get]
func (s *Server) listAdminApps(c echo.Context) error {
	if _, err := appregistry.EnsureAIAssistantApp(s.db, s.cfg.Apps); err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	var apps []store.App
	if err := s.db.Find(&apps).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	sortAppsForAdmin(apps)

	responses := make([]adminAppResponse, 0, len(apps))
	for _, app := range apps {
		responses = append(responses, s.newAdminAppResponse(app))
	}

	return success(c, http.StatusOK, listAdminAppsResponse{Apps: responses})
}

// createAdminApp godoc
//
// @Summary 创建应用
// @Description 管理员创建一个应用配置。连接密钥由服务端生成。
// @Tags 管理员应用
// @Accept json
// @Produce json
// @Param body body adminAppRequest true "应用配置"
// @Success 201 {object} successEnvelope{data=adminAppEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/apps [post]
func (s *Server) createAdminApp(c echo.Context) error {
	var req adminAppRequest
	if err := c.Bind(&req); err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}

	app, err := newAdminAppFromRequest(req)
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}
	app.ID = uuid.NewString()
	app.Enabled = true
	secret, err := generateUniqueAppSecret(s.db)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	app.ConnectionSecret = secret

	if err := s.db.Create(&app).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusCreated, adminAppEnvelope{App: s.newAdminAppResponse(app)})
}

// updateAdminApp godoc
//
// @Summary 更新应用
// @Description 管理员更新一个应用配置。AI 女菩萨的可见范围固定为所有人。
// @Tags 管理员应用
// @Accept json
// @Produce json
// @Param id path string true "应用 ID"
// @Param body body adminAppRequest true "应用配置"
// @Success 200 {object} successEnvelope{data=adminAppEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/apps/{id} [put]
func (s *Server) updateAdminApp(c echo.Context) error {
	app, ok, err := s.findAdminApp(c)
	if err != nil || !ok {
		return err
	}

	var req adminAppRequest
	if err := c.Bind(&req); err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}
	updatedApp, err := newAdminAppFromRequest(req)
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}
	if appregistry.IsAIAssistantAppID(app.ID) {
		updatedApp.Visibility = store.AppVisibilityPublic
	}

	updates := map[string]any{
		"description": updatedApp.Description,
		"name":        updatedApp.Name,
		"visibility":  updatedApp.Visibility,
		"updated_at":  time.Now().UTC(),
	}
	if err := s.db.Model(&app).Updates(updates).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	if err := s.db.First(&app, "id = ?", app.ID).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusOK, adminAppEnvelope{App: s.newAdminAppResponse(app)})
}

// enableAdminApp godoc
//
// @Summary 启用应用
// @Tags 管理员应用
// @Produce json
// @Param id path string true "应用 ID"
// @Success 200 {object} successEnvelope{data=adminAppEnvelope}
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/apps/{id}/enable [post]
func (s *Server) enableAdminApp(c echo.Context) error {
	return s.updateAdminAppEnabled(c, true)
}

// disableAdminApp godoc
//
// @Summary 禁用应用
// @Tags 管理员应用
// @Produce json
// @Param id path string true "应用 ID"
// @Success 200 {object} successEnvelope{data=adminAppEnvelope}
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/apps/{id}/disable [post]
func (s *Server) disableAdminApp(c echo.Context) error {
	return s.updateAdminAppEnabled(c, false)
}

// regenerateAdminAppSecret godoc
//
// @Summary 生成应用连接密钥
// @Description 普通应用可以生成新密钥。AI 女菩萨密钥由配置管理，不能在后台生成。
// @Tags 管理员应用
// @Produce json
// @Param id path string true "应用 ID"
// @Success 200 {object} successEnvelope{data=adminAppEnvelope}
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/apps/{id}/secret/regenerate [post]
func (s *Server) regenerateAdminAppSecret(c echo.Context) error {
	app, ok, err := s.findAdminApp(c)
	if err != nil || !ok {
		return err
	}
	if appregistry.IsAIAssistantAppID(app.ID) {
		return failure(c, http.StatusForbidden, "forbidden", "AI 女菩萨密钥由配置管理")
	}

	secret, err := generateUniqueAppSecret(s.db)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	if err := s.db.Model(&app).Updates(map[string]any{
		"connection_secret": secret,
		"updated_at":        time.Now().UTC(),
	}).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	if err := s.db.First(&app, "id = ?", app.ID).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	s.appConnections.CloseApp(app.ID)

	return success(c, http.StatusOK, adminAppEnvelope{App: s.newAdminAppResponse(app)})
}

// deleteAdminApp godoc
//
// @Summary 删除应用
// @Description 管理员删除普通应用。AI 女菩萨不能删除。
// @Tags 管理员应用
// @Produce json
// @Param id path string true "应用 ID"
// @Success 200 {object} successEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/apps/{id} [delete]
func (s *Server) deleteAdminApp(c echo.Context) error {
	app, ok, err := s.findAdminApp(c)
	if err != nil || !ok {
		return err
	}
	if appregistry.IsAIAssistantAppID(app.ID) {
		return failure(c, http.StatusForbidden, "forbidden", "AI 女菩萨不能删除")
	}

	if err := s.db.Delete(&store.App{}, "id = ?", app.ID).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	s.appConnections.CloseApp(app.ID)

	return success(c, http.StatusOK, map[string]any{})
}

func (s *Server) updateAdminAppEnabled(c echo.Context, enabled bool) error {
	app, ok, err := s.findAdminApp(c)
	if err != nil || !ok {
		return err
	}
	if app.Enabled == enabled {
		return success(c, http.StatusOK, adminAppEnvelope{App: s.newAdminAppResponse(app)})
	}

	if err := s.db.Model(&app).Updates(map[string]any{
		"enabled":    enabled,
		"updated_at": time.Now().UTC(),
	}).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	if err := s.db.First(&app, "id = ?", app.ID).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	if !enabled {
		s.appConnections.CloseApp(app.ID)
	}

	return success(c, http.StatusOK, adminAppEnvelope{App: s.newAdminAppResponse(app)})
}

func (s *Server) findAdminApp(c echo.Context) (store.App, bool, error) {
	id, err := parseUUIDParam(c, "id", "应用 ID 格式错误")
	if err != nil {
		return store.App{}, false, err
	}

	var app store.App
	err = s.db.First(&app, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if appregistry.IsAIAssistantAppID(id) {
			app, err = appregistry.EnsureAIAssistantApp(s.db, s.cfg.Apps)
			if err == nil {
				return app, true, nil
			}
		}
		return store.App{}, false, failure(c, http.StatusNotFound, "not_found", "应用不存在")
	}
	if err != nil {
		return store.App{}, false, failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return app, true, nil
}

func newAdminAppFromRequest(req adminAppRequest) (store.App, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return store.App{}, errors.New("应用名称不能为空")
	}
	if len([]rune(name)) > maxAppNameLength {
		return store.App{}, errors.New("应用名称不能超过 120 个字符")
	}

	description := strings.TrimSpace(req.Description)
	visibility, err := normalizeAdminAppVisibility(req.Visibility)
	if err != nil {
		return store.App{}, err
	}

	now := time.Now().UTC()
	return store.App{
		Name:        name,
		Description: description,
		Visibility:  visibility,
		CreatedAt:   now,
		UpdatedAt:   now,
	}, nil
}

func normalizeAdminAppVisibility(value string) (string, error) {
	switch strings.TrimSpace(value) {
	case "", store.AppVisibilityPublic:
		return store.AppVisibilityPublic, nil
	case store.AppVisibilityCreator:
		return "", errors.New("后台创建的应用暂不支持仅创建者可见")
	default:
		return "", errors.New("可见范围不支持")
	}
}

func (s *Server) newAdminAppResponse(app store.App) adminAppResponse {
	return adminAppResponse{
		Avatar:           app.Avatar,
		ConnectionSecret: app.ConnectionSecret,
		ConnectionStatus: s.adminAppConnectionStatus(app),
		CreatedAt:        app.CreatedAt,
		CreatorUserID:    app.CreatorUserID,
		Description:      app.Description,
		Enabled:          app.Enabled,
		ID:               app.ID,
		Name:             app.Name,
		System:           appregistry.IsAIAssistantAppID(app.ID),
		UpdatedAt:        app.UpdatedAt,
		Visibility:       app.Visibility,
	}
}

func (s *Server) adminAppConnectionStatus(app store.App) string {
	if !app.Enabled {
		return appConnectionStatusDisabled
	}
	if s.appConnections != nil && s.appConnections.IsOnline(app.ID) {
		return appConnectionStatusOnline
	}

	return appConnectionStatusOffline
}

func sortAppsForAdmin(apps []store.App) {
	slices.SortFunc(apps, func(left store.App, right store.App) int {
		if appregistry.IsAIAssistantAppID(left.ID) && !appregistry.IsAIAssistantAppID(right.ID) {
			return -1
		}
		if !appregistry.IsAIAssistantAppID(left.ID) && appregistry.IsAIAssistantAppID(right.ID) {
			return 1
		}
		if strings.EqualFold(left.Name, right.Name) {
			return strings.Compare(left.ID, right.ID)
		}

		return strings.Compare(strings.ToLower(left.Name), strings.ToLower(right.Name))
	})
}

func generateUniqueAppSecret(db *gorm.DB) (string, error) {
	for attempts := 0; attempts < 5; attempts++ {
		secret, err := randomAppSecret()
		if err != nil {
			return "", err
		}

		var count int64
		if err := db.Model(&store.App{}).Where("connection_secret = ?", secret).Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return secret, nil
		}
	}

	return "", errors.New("generate unique app secret failed")
}

func randomAppSecret() (string, error) {
	value := make([]byte, appSecretBytes)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(value), nil
}
