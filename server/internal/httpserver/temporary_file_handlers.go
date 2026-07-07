package httpserver

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"app/internal/objectstore"
	"app/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

const maxTemporaryFileUploadBytes = 20 * 1024 * 1024

type temporaryFileResponse struct {
	ID        string    `json:"id" example:"7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"`
	SizeBytes int64     `json:"size_bytes" example:"123456"`
	CreatedAt time.Time `json:"created_at" format:"date-time"`
}

type createTemporaryFileResponse struct {
	File temporaryFileResponse `json:"file"`
}

type readTemporaryFileURLsRequest struct {
	FileIDs []string `json:"file_ids"`
}

type temporaryFileReadURLResponse struct {
	ExpiresAt time.Time `json:"expires_at" format:"date-time"`
	FileID    string    `json:"file_id" example:"7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"`
	URL       string    `json:"url"`
}

type readTemporaryFileURLsResponse struct {
	URLs []temporaryFileReadURLResponse `json:"urls"`
}

// createTemporaryFile godoc
//
// @Summary 上传临时文件
// @Description 普通用户上传临时文件。文件会写入 temporary bucket，成功后返回临时文件 ID。
// @Tags 客户端文件
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "临时文件"
// @Success 201 {object} successEnvelope{data=createTemporaryFileResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 413 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/temporary-files [post]
func (s *Server) createTemporaryFile(c echo.Context) error {
	if _, ok := currentUser(c); !ok {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	c.Request().Body = http.MaxBytesReader(c.Response().Writer, c.Request().Body, maxTemporaryFileUploadBytes)
	fileHeader, err := c.FormFile("file")
	if err != nil {
		if isRequestBodyTooLarge(err) {
			return failure(c, http.StatusRequestEntityTooLarge, "request_too_large", "文件不能超过 20MiB")
		}
		return failure(c, http.StatusBadRequest, "invalid_request", "请选择要上传的文件")
	}
	if fileHeader.Size > maxTemporaryFileUploadBytes {
		return failure(c, http.StatusRequestEntityTooLarge, "request_too_large", "文件不能超过 20MiB")
	}
	if fileHeader.Size < 0 {
		return failure(c, http.StatusBadRequest, "invalid_request", "文件大小错误")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "读取上传文件失败")
	}
	defer file.Close()

	storageClient, err := s.newObjectStoreClient(c.Request().Context())
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "临时文件存储未配置")
	}

	now := time.Now().UTC()
	fileID := uuid.NewString()
	objectKey := buildTemporaryObjectKey(now, fileID)
	contentType := strings.TrimSpace(fileHeader.Header.Get("Content-Type"))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	if err := storageClient.PutTemporaryObject(c.Request().Context(), objectKey, file, fileHeader.Size, contentType); err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "上传临时文件失败")
	}

	temporaryFile := store.TemporaryFile{
		ID:        fileID,
		ObjectKey: objectKey,
		SizeBytes: fileHeader.Size,
		CreatedAt: now,
	}
	if err := s.db.Create(&temporaryFile).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "保存临时文件失败")
	}

	return success(c, http.StatusCreated, createTemporaryFileResponse{
		File: newTemporaryFileResponse(temporaryFile),
	})
}

// readTemporaryFileURLs godoc
//
// @Summary 批量申请临时文件访问地址
// @Description 普通用户按临时文件 ID 批量申请 24 小时有效的访问地址。
// @Tags 客户端文件
// @Accept json
// @Produce json
// @Param body body readTemporaryFileURLsRequest true "临时文件 ID 列表"
// @Success 200 {object} successEnvelope{data=readTemporaryFileURLsResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/temporary-files/read-urls [post]
func (s *Server) readTemporaryFileURLs(c echo.Context) error {
	if _, ok := currentUser(c); !ok {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	var req readTemporaryFileURLsRequest
	if err := c.Bind(&req); err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}
	fileIDs, err := normalizeTemporaryFileIDs(req.FileIDs)
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}

	var files []store.TemporaryFile
	if err := s.db.Where("id IN ?", fileIDs).Find(&files).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	if len(files) != len(fileIDs) {
		return failure(c, http.StatusNotFound, "not_found", "临时文件不存在")
	}

	storageClient, err := s.newObjectStoreClient(c.Request().Context())
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "临时文件存储未配置")
	}

	filesByID := make(map[string]store.TemporaryFile, len(files))
	for _, file := range files {
		filesByID[file.ID] = file
	}

	urls := make([]temporaryFileReadURLResponse, 0, len(fileIDs))
	now := time.Now().UTC()
	for _, fileID := range fileIDs {
		file := filesByID[fileID]
		if isTemporaryFileExpired(file, s.cfg.Storage.Lifecycle.TemporaryExpireDays, now) {
			return failure(c, http.StatusNotFound, "not_found", "临时文件不存在")
		}
		url, expiresAt, err := storageClient.PresignTemporaryReadURL(c.Request().Context(), file.ObjectKey)
		if err != nil {
			return failure(c, http.StatusInternalServerError, "internal_error", "生成临时文件访问地址失败")
		}
		urls = append(urls, temporaryFileReadURLResponse{
			ExpiresAt: expiresAt,
			FileID:    file.ID,
			URL:       url,
		})
	}

	return success(c, http.StatusOK, readTemporaryFileURLsResponse{
		URLs: urls,
	})
}

func (s *Server) newObjectStoreClient(ctx context.Context) (*objectstore.Client, error) {
	if s.cfg.Storage.Provider == "" {
		return nil, errors.New("storage is not configured")
	}

	return objectstore.New(ctx, s.cfg.Storage)
}

func newTemporaryFileResponse(file store.TemporaryFile) temporaryFileResponse {
	return temporaryFileResponse{
		ID:        file.ID,
		SizeBytes: file.SizeBytes,
		CreatedAt: file.CreatedAt,
	}
}

func buildTemporaryObjectKey(now time.Time, fileID string) string {
	return fmt.Sprintf("temporary-files/%s/%s", now.UTC().Format("2006/01/02"), fileID)
}

func isTemporaryFileExpired(file store.TemporaryFile, expireDays int32, now time.Time) bool {
	if expireDays <= 0 {
		expireDays = 180
	}

	return !file.CreatedAt.AddDate(0, 0, int(expireDays)).After(now)
}

func normalizeTemporaryFileIDs(rawFileIDs []string) ([]string, error) {
	if len(rawFileIDs) == 0 {
		return nil, errors.New("file_ids 不能为空")
	}
	if len(rawFileIDs) > 100 {
		return nil, errors.New("file_ids 不能超过 100 个")
	}

	seen := make(map[string]struct{}, len(rawFileIDs))
	fileIDs := make([]string, 0, len(rawFileIDs))
	for _, rawFileID := range rawFileIDs {
		fileID := strings.TrimSpace(rawFileID)
		if _, err := uuid.Parse(fileID); err != nil {
			return nil, errors.New("file_ids 包含无效 ID")
		}
		if _, ok := seen[fileID]; ok {
			continue
		}
		seen[fileID] = struct{}{}
		fileIDs = append(fileIDs, fileID)
	}

	return fileIDs, nil
}

func isRequestBodyTooLarge(err error) bool {
	return strings.Contains(err.Error(), "request body too large")
}
