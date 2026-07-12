package httpserver

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// uploadProjectAvatar godoc
//
// @Summary 上传项目头像
// @Description 项目所有者上传裁切后的 WebP 项目头像。头像必须是 256x256，文件会写入 public bucket。
// @Tags 客户端项目
// @Accept multipart/form-data
// @Produce json
// @Param project_id path string true "项目 ID"
// @Param file formData file true "WebP 项目头像"
// @Success 200 {object} successEnvelope{data=projectResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 413 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/projects/{project_id}/avatar [post]
func (s *Server) uploadProjectAvatar(c echo.Context) error {
	user, ok := currentUser(c)
	if !ok {
		return projectInternalError(c)
	}
	projectID, err := parseProjectID(c.Param("project_id"))
	if err != nil {
		return projectInvalidRequest(c, err.Error())
	}
	project, role, err := s.findAccessibleProject(c.Request().Context(), projectID, user.ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return projectNotFound(c)
	}
	if err != nil {
		return projectInternalError(c)
	}
	if role != store.ProjectRoleOwner {
		return projectForbidden(c)
	}
	if project.IsPersonal {
		return projectInvalidRequest(c, "个人工作区头像不能修改")
	}

	c.Request().Body = http.MaxBytesReader(c.Response().Writer, c.Request().Body, maxAvatarRequestBytes)
	fileHeader, err := c.FormFile("file")
	if err != nil {
		if isRequestBodyTooLarge(err) {
			return failure(c, http.StatusRequestEntityTooLarge, "request_too_large", "项目头像文件不能超过 1MiB")
		}
		return projectInvalidRequest(c, "请选择要上传的项目头像")
	}
	if fileHeader.Size > maxAvatarUploadBytes {
		return failure(c, http.StatusRequestEntityTooLarge, "request_too_large", "项目头像文件不能超过 1MiB")
	}
	if fileHeader.Size == 0 {
		return projectInvalidRequest(c, "项目头像文件不能为空")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return projectInvalidRequest(c, "读取项目头像失败")
	}
	defer file.Close()

	avatarBytes, err := readAvatarUpload(file)
	if err != nil {
		if errors.Is(err, errAvatarTooLarge) {
			return failure(c, http.StatusRequestEntityTooLarge, "request_too_large", "项目头像文件不能超过 1MiB")
		}
		return projectInvalidRequest(c, "读取项目头像失败")
	}
	if err := validateAvatarUpload(avatarBytes); err != nil {
		return projectInvalidRequest(c, "项目头像必须是 256x256 的 WebP 图片")
	}

	storageClient, err := s.newObjectStoreClient(c.Request().Context())
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "项目头像存储未配置")
	}
	objectKey := buildProjectAvatarObjectKey(project.ID, uuid.NewString())
	if err := storageClient.PutPublicObject(
		c.Request().Context(),
		objectKey,
		bytes.NewReader(avatarBytes),
		int64(len(avatarBytes)),
		avatarContentType,
	); err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "上传项目头像失败")
	}
	avatarURL, err := storageClient.PublicObjectURL(objectKey)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "项目头像存储未配置")
	}

	now := time.Now().UTC()
	result := s.db.WithContext(c.Request().Context()).
		Model(&store.Project{}).
		Where("id = ? AND owner_user_id = ? AND is_personal = ?", project.ID, user.ID, false).
		Updates(map[string]any{"avatar": avatarURL, "updated_at": now})
	if result.Error != nil {
		return projectInternalError(c)
	}
	if result.RowsAffected == 0 {
		return projectNotFound(c)
	}
	project.Avatar = avatarURL
	project.UpdatedAt = now
	response, err := s.newProjectResponse(c.Request().Context(), project, store.ProjectRoleOwner)
	if err != nil {
		return projectInternalError(c)
	}
	return success(c, http.StatusOK, response)
}

func buildProjectAvatarObjectKey(projectID string, avatarID string) string {
	return fmt.Sprintf("avatars/projects/%s/%s.webp", strings.TrimSpace(projectID), strings.TrimSpace(avatarID))
}
