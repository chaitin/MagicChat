package httpserver

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"app/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

const (
	avatarContentType     = "image/webp"
	avatarOutputSize      = 256
	maxAvatarUploadBytes  = 1 * 1024 * 1024
	maxAvatarRequestBytes = maxAvatarUploadBytes + 1*1024*1024
)

var errAvatarTooLarge = errors.New("avatar too large")

// uploadCurrentUserAvatar godoc
//
// @Summary 上传当前用户头像
// @Description 普通用户上传裁切后的 WebP 头像。头像必须是 256x256，文件会写入 public bucket，并更新当前用户头像。
// @Tags 客户端认证
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "WebP 头像"
// @Success 200 {object} successEnvelope{data=currentUserResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 413 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/me/avatar [post]
func (s *Server) uploadCurrentUserAvatar(c echo.Context) error {
	user, ok := currentUser(c)
	if !ok {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
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

	objectKey := buildCurrentUserAvatarObjectKey(user.ID, uuid.NewString())
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
	if err := s.db.Model(&store.User{}).Where("id = ?", user.ID).Update("avatar", avatarURL).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "保存头像失败")
	}

	var updatedUser store.User
	if err := s.db.First(&updatedUser, "id = ?", user.ID).Error; err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusOK, currentUserResponse{
		User: newUserResponse(updatedUser),
	})
}

func readAvatarUpload(reader io.Reader) ([]byte, error) {
	content, err := io.ReadAll(io.LimitReader(reader, maxAvatarUploadBytes+1))
	if err != nil {
		return nil, err
	}
	if len(content) > maxAvatarUploadBytes {
		return nil, errAvatarTooLarge
	}
	if len(content) == 0 {
		return nil, errors.New("empty avatar")
	}

	return content, nil
}

func validateAvatarUpload(content []byte) error {
	width, height, err := parseWebPDimensions(content)
	if err != nil {
		return err
	}
	if width != avatarOutputSize || height != avatarOutputSize {
		return errors.New("invalid avatar dimensions")
	}

	return nil
}

func buildCurrentUserAvatarObjectKey(userID string, avatarID string) string {
	return fmt.Sprintf("avatars/users/%s/%s.webp", strings.TrimSpace(userID), strings.TrimSpace(avatarID))
}

func parseWebPDimensions(content []byte) (int, int, error) {
	if len(content) < 12 || string(content[0:4]) != "RIFF" || string(content[8:12]) != "WEBP" {
		return 0, 0, errors.New("invalid webp")
	}

	for offset := 12; offset+8 <= len(content); {
		chunkType := string(content[offset : offset+4])
		chunkSize := int(binary.LittleEndian.Uint32(content[offset+4 : offset+8]))
		payloadStart := offset + 8
		payloadEnd := payloadStart + chunkSize
		if chunkSize < 0 || payloadEnd > len(content) {
			return 0, 0, errors.New("invalid webp")
		}

		payload := content[payloadStart:payloadEnd]
		switch chunkType {
		case "VP8X":
			return parseVP8XDimensions(payload)
		case "VP8L":
			return parseVP8LDimensions(payload)
		case "VP8 ":
			return parseVP8Dimensions(payload)
		}

		offset = payloadEnd
		if chunkSize%2 == 1 {
			offset++
		}
	}

	return 0, 0, errors.New("missing webp dimensions")
}

func parseVP8XDimensions(payload []byte) (int, int, error) {
	if len(payload) < 10 {
		return 0, 0, errors.New("invalid vp8x")
	}

	width := 1 + int(payload[4]) + (int(payload[5]) << 8) + (int(payload[6]) << 16)
	height := 1 + int(payload[7]) + (int(payload[8]) << 8) + (int(payload[9]) << 16)

	return width, height, nil
}

func parseVP8LDimensions(payload []byte) (int, int, error) {
	if len(payload) < 5 || payload[0] != 0x2f {
		return 0, 0, errors.New("invalid vp8l")
	}

	width := 1 + int(payload[1]) + (int(payload[2]&0x3f) << 8)
	height := 1 + (int(payload[2]&0xc0) >> 6) + (int(payload[3]) << 2) + (int(payload[4]&0x0f) << 10)

	return width, height, nil
}

func parseVP8Dimensions(payload []byte) (int, int, error) {
	if len(payload) < 10 || payload[3] != 0x9d || payload[4] != 0x01 || payload[5] != 0x2a {
		return 0, 0, errors.New("invalid vp8")
	}

	width := int(binary.LittleEndian.Uint16(payload[6:8]) & 0x3fff)
	height := int(binary.LittleEndian.Uint16(payload[8:10]) & 0x3fff)

	return width, height, nil
}
