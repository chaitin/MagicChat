package client

import (
	"net/http"
	"time"

	fileapp "app/internal/application/file"

	"github.com/labstack/echo/v4"
)

type FileAPI struct {
	files fileapp.ClientService
}

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
	SizeBytes int64     `json:"size_bytes" example:"123456"`
	URL       string    `json:"url"`
}

type readTemporaryFileURLsResponse struct {
	URLs []temporaryFileReadURLResponse `json:"urls"`
}

func NewFileAPI(files fileapp.ClientService) *FileAPI {
	return &FileAPI{files: files}
}

func (a *FileAPI) RegisterRoutes(group *echo.Group) {
	group.POST("/temporary-files", a.createTemporaryFile)
	group.POST("/temporary-files/read-urls", a.readTemporaryFileURLs)
	group.GET("/temporary-files/:file_id/content", a.redirectTemporaryFileContent)
}

// createTemporaryFile godoc
//
// @Summary 上传临时文件
// @Description 普通用户上传临时文件，最大 200MiB。大于 10MiB 的文件保留 30 天，其余文件保留 180 天，统一写入 temporary bucket。
// @Tags 客户端文件
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "临时文件"
// @Success 201 {object} successEnvelope{data=createTemporaryFileResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 413 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/temporary-files [post]
func (a *FileAPI) createTemporaryFile(c echo.Context) error {
	c.Request().Body = http.MaxBytesReader(c.Response().Writer, c.Request().Body, fileapp.MaxTemporaryUploadRequestBytes)
	fileHeader, err := c.FormFile("file")
	if err != nil {
		if isRequestBodyTooLarge(err) {
			return writeFailure(c, http.StatusRequestEntityTooLarge, string(fileapp.CodeRequestTooLarge), "文件不能超过 200MiB")
		}
		return writeFailure(c, http.StatusBadRequest, string(fileapp.CodeInvalidRequest), "请选择要上传的文件")
	}
	if fileHeader.Size > fileapp.MaxTemporaryUploadBytes {
		return writeFailure(c, http.StatusRequestEntityTooLarge, string(fileapp.CodeRequestTooLarge), "文件不能超过 200MiB")
	}
	if fileHeader.Size < 0 {
		return writeFailure(c, http.StatusBadRequest, string(fileapp.CodeInvalidRequest), "文件大小错误")
	}

	content, err := fileHeader.Open()
	if err != nil {
		return writeFailure(c, http.StatusBadRequest, string(fileapp.CodeInvalidRequest), "读取上传文件失败")
	}
	defer content.Close()

	value, err := a.files.UploadTemporary(c.Request().Context(), fileapp.UploadTemporaryCommand{
		Content:     content,
		ContentType: fileHeader.Header.Get("Content-Type"),
		SizeBytes:   fileHeader.Size,
	})
	if err != nil {
		return writeFileError(c, err)
	}
	return writeSuccess(c, http.StatusCreated, createTemporaryFileResponse{File: newTemporaryFileResponse(value)})
}

// readTemporaryFileURLs godoc
//
// @Summary 批量申请临时文件访问地址
// @Description 普通用户按临时文件 ID 批量申请最长 24 小时、且不超过文件剩余寿命的访问地址。
// @Tags 客户端文件
// @Accept json
// @Produce json
// @Param body body readTemporaryFileURLsRequest true "临时文件 ID 列表"
// @Success 200 {object} successEnvelope{data=readTemporaryFileURLsResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/temporary-files/read-urls [post]
func (a *FileAPI) readTemporaryFileURLs(c echo.Context) error {
	var req readTemporaryFileURLsRequest
	if err := c.Bind(&req); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(fileapp.CodeInvalidRequest), "请求格式错误")
	}
	values, err := a.files.ResolveTemporaryURLs(c.Request().Context(), req.FileIDs)
	if err != nil {
		return writeFileError(c, err)
	}
	return writeSuccess(c, http.StatusOK, readTemporaryFileURLsResponse{URLs: newTemporaryFileReadURLResponses(values)})
}

// redirectTemporaryFileContent godoc
//
// @Summary 访问临时文件内容
// @Description 普通用户通过临时文件 ID 跳转到有效的临时访问地址，适用于浏览器原生媒体播放。
// @Tags 客户端文件
// @Param file_id path string true "临时文件 ID"
// @Success 307
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/temporary-files/{file_id}/content [get]
func (a *FileAPI) redirectTemporaryFileContent(c echo.Context) error {
	value, err := a.files.ResolveTemporaryURL(c.Request().Context(), c.Param("file_id"))
	if err != nil {
		return writeFileError(c, err)
	}
	return c.Redirect(http.StatusTemporaryRedirect, value.URL)
}

func newTemporaryFileResponse(value fileapp.TemporaryFile) temporaryFileResponse {
	return temporaryFileResponse{ID: value.ID, SizeBytes: value.SizeBytes, CreatedAt: value.CreatedAt}
}

func newTemporaryFileReadURLResponses(values []fileapp.ResolvedTemporaryURL) []temporaryFileReadURLResponse {
	result := make([]temporaryFileReadURLResponse, 0, len(values))
	for _, value := range values {
		result = append(result, temporaryFileReadURLResponse{
			FileID:    value.FileID,
			SizeBytes: value.SizeBytes,
			URL:       value.URL,
			ExpiresAt: value.ExpiresAt,
		})
	}
	return result
}

func writeFileError(c echo.Context, err error) error {
	code := fileapp.ErrorCodeOf(err)
	status := http.StatusInternalServerError
	switch code {
	case fileapp.CodeInvalidRequest:
		status = http.StatusBadRequest
	case fileapp.CodeRequestTooLarge:
		status = http.StatusRequestEntityTooLarge
	case fileapp.CodeNotFound:
		status = http.StatusNotFound
	case fileapp.CodeStorageUnavailable, fileapp.CodeInternal:
		code = fileapp.CodeInternal
	}
	return writeFailure(c, status, string(code), fileapp.ErrorMessage(err))
}
