package httpserver

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"app/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// uploadAdminAppAvatar godoc
//
// @Summary 上传应用头像
// @Description 管理员上传裁切后的 WebP 应用头像。头像必须是 256x256，文件会写入 public bucket，并更新应用头像。
// @Tags 管理端应用
// @Accept multipart/form-data
// @Produce json
// @Param id path string true "应用 ID"
// @Param file formData file true "WebP 应用头像"
// @Success 200 {object} successEnvelope{data=adminAppEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 413 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/admin/apps/{id}/avatar [post]
func (s *Server) uploadAdminAppAvatar(c echo.Context) error {
	app, ok, err := s.findAdminApp(c)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	if !ok {
		return failure(c, http.StatusNotFound, "not_found", "应用不存在")
	}

	c.Request().Body = http.MaxBytesReader(c.Response().Writer, c.Request().Body, maxAvatarRequestBytes)
	fileHeader, err := c.FormFile("file")
	if err != nil {
		if isRequestBodyTooLarge(err) {
			return failure(c, http.StatusRequestEntityTooLarge, "request_too_large", "头像文件不能超过 1MiB")
		}
		return failure(c, http.StatusBadRequest, "invalid_request", "请选择要上传的头像")
	}
	if fileHeader.Size > maxAvatarUploadBytes {
		return failure(c, http.StatusRequestEntityTooLarge, "request_too_large", "头像文件不能超过 1MiB")
	}
	if fileHeader.Size == 0 {
		return failure(c, http.StatusBadRequest, "invalid_request", "头像文件不能为空")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "读取头像失败")
	}
	defer file.Close()

	avatarBytes, err := readAvatarUpload(file)
	if err != nil {
		if errors.Is(err, errAvatarTooLarge) {
			return failure(c, http.StatusRequestEntityTooLarge, "request_too_large", "头像文件不能超过 1MiB")
		}
		return failure(c, http.StatusBadRequest, "invalid_request", "读取头像失败")
	}
	if err := validateAvatarUpload(avatarBytes); err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "头像必须是 256x256 的 WebP 图片")
	}

	storageClient, err := s.newObjectStoreClient(c.Request().Context())
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "头像存储未配置")
	}

	objectKey := buildAdminAppAvatarObjectKey(app.ID, uuid.NewString())
	if err := storageClient.PutPublicObject(
		c.Request().Context(),
		objectKey,
		bytes.NewReader(avatarBytes),
		int64(len(avatarBytes)),
		avatarContentType,
	); err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "上传头像失败")
	}

	avatarURL, err := storageClient.PublicObjectURL(objectKey)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "头像存储未配置")
	}
	if err := s.db.Model(&store.App{}).Where("id = ?", app.ID).Update("avatar", avatarURL).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "保存头像失败")
	}
	if err := s.db.First(&app, "id = ?", app.ID).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusOK, adminAppEnvelope{App: s.newAdminAppResponse(app)})
}

func buildAdminAppAvatarObjectKey(appID string, avatarID string) string {
	return fmt.Sprintf("avatars/apps/%s/%s.webp", strings.TrimSpace(appID), strings.TrimSpace(avatarID))
}
