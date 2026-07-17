package file

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Dependencies struct {
	DB                  *gorm.DB
	Storage             BlobStorage
	Now                 func() time.Time
	NewID               func() string
	TemporaryExpireDays int32
}

type Service struct {
	db                  *gorm.DB
	storage             BlobStorage
	now                 func() time.Time
	newID               func() string
	temporaryExpireDays int32
}

func NewService(deps Dependencies) *Service {
	now := deps.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	newID := deps.NewID
	if newID == nil {
		newID = uuid.NewString
	}
	expireDays := deps.TemporaryExpireDays
	if expireDays <= 0 {
		expireDays = DefaultTemporaryExpireDays
	}
	return &Service{
		db:                  deps.DB,
		storage:             deps.Storage,
		now:                 now,
		newID:               newID,
		temporaryExpireDays: expireDays,
	}
}

func (s *Service) UploadPublic(ctx context.Context, cmd UploadPublicCommand) (PublicFile, error) {
	objectKey := strings.Trim(strings.TrimSpace(cmd.ObjectKey), "/")
	if objectKey == "" || cmd.Content == nil || cmd.SizeBytes < 0 {
		return PublicFile{}, newError(CodeInvalidRequest, "文件参数错误", nil)
	}
	if s.storage == nil {
		return PublicFile{}, newError(CodeStorageUnavailable, "文件存储未配置", nil)
	}
	contentType := normalizeContentType(cmd.ContentType)
	url, err := s.storage.PutPublic(ctx, objectKey, cmd.Content, cmd.SizeBytes, contentType)
	if err != nil {
		return PublicFile{}, newError(CodeInternal, "上传文件失败", err)
	}
	if strings.TrimSpace(url) == "" {
		return PublicFile{}, newError(CodeStorageUnavailable, "文件存储未配置", nil)
	}
	return PublicFile{
		ObjectKey:   objectKey,
		URL:         url,
		ContentType: contentType,
		SizeBytes:   cmd.SizeBytes,
	}, nil
}

func (s *Service) UploadTemporary(ctx context.Context, cmd UploadTemporaryCommand) (TemporaryFile, error) {
	if cmd.Content == nil || cmd.SizeBytes < 0 {
		return TemporaryFile{}, newError(CodeInvalidRequest, "临时文件参数错误", nil)
	}
	if cmd.SizeBytes > MaxTemporaryUploadBytes {
		return TemporaryFile{}, newError(CodeRequestTooLarge, "临时文件不能超过 200MiB", nil)
	}
	if s.storage == nil {
		return TemporaryFile{}, newError(CodeStorageUnavailable, "临时文件存储未配置", nil)
	}
	if s.db == nil {
		return TemporaryFile{}, newError(CodeInternal, "保存临时文件失败", errors.New("database is not configured"))
	}

	keyTime := s.now().UTC()
	fileID := s.newID()
	if _, err := uuid.Parse(fileID); err != nil {
		return TemporaryFile{}, newError(CodeInternal, "生成临时文件 ID 失败", err)
	}
	objectKey := buildTemporaryObjectKey(keyTime, fileID, cmd.SizeBytes)
	if err := s.storage.PutTemporary(ctx, objectKey, cmd.Content, cmd.SizeBytes, normalizeContentType(cmd.ContentType)); err != nil {
		return TemporaryFile{}, newError(CodeInternal, "上传临时文件失败", err)
	}
	now := s.now().UTC()
	expiresAt := now.AddDate(0, 0, s.temporaryRetentionDays(cmd.SizeBytes))

	stored := store.TemporaryFile{
		ID:        fileID,
		ObjectKey: objectKey,
		SizeBytes: cmd.SizeBytes,
		CreatedAt: now,
		ExpiresAt: expiresAt,
	}
	if err := s.db.WithContext(ctx).Create(&stored).Error; err != nil {
		return TemporaryFile{}, newError(CodeInternal, "保存临时文件失败", err)
	}
	return newTemporaryFile(stored), nil
}

func (s *Service) ResolveTemporaryURL(ctx context.Context, fileID string) (ResolvedTemporaryURL, error) {
	resolved, err := s.ResolveTemporaryURLs(ctx, []string{fileID})
	if err != nil {
		return ResolvedTemporaryURL{}, err
	}
	return resolved[0], nil
}

func (s *Service) ResolveTemporaryURLs(ctx context.Context, rawFileIDs []string) ([]ResolvedTemporaryURL, error) {
	fileIDs, err := normalizeTemporaryFileIDs(rawFileIDs)
	if err != nil {
		return nil, err
	}
	files, err := s.loadAvailableTemporaryFiles(ctx, fileIDs)
	if err != nil {
		return nil, err
	}
	if s.storage == nil {
		return nil, newError(CodeStorageUnavailable, "临时文件存储未配置", nil)
	}

	filesByID := make(map[string]store.TemporaryFile, len(files))
	for _, value := range files {
		filesByID[value.ID] = value
	}
	result := make([]ResolvedTemporaryURL, 0, len(fileIDs))
	now := s.now().UTC()
	for _, fileID := range fileIDs {
		value := filesByID[fileID]
		remaining := s.temporaryFileExpiresAt(value).Sub(now)
		if remaining <= 0 {
			return nil, newError(CodeNotFound, "临时文件不存在", gorm.ErrRecordNotFound)
		}
		urlTTL := min(remaining, 24*time.Hour)
		url, expiresAt, err := s.storage.PresignTemporaryReadURL(ctx, value.ObjectKey, urlTTL)
		if err != nil {
			return nil, newError(CodeInternal, "生成临时文件访问地址失败", err)
		}
		result = append(result, ResolvedTemporaryURL{
			FileID:    fileID,
			SizeBytes: value.SizeBytes,
			URL:       url,
			ExpiresAt: expiresAt,
		})
	}
	return result, nil
}

func (s *Service) ValidateTemporaryFiles(ctx context.Context, rawFileIDs []string) error {
	fileIDs, err := normalizeTemporaryFileIDs(rawFileIDs)
	if err != nil {
		return err
	}
	_, err = s.loadAvailableTemporaryFiles(ctx, fileIDs)
	return err
}

func (s *Service) loadAvailableTemporaryFiles(ctx context.Context, fileIDs []string) ([]store.TemporaryFile, error) {
	if s.db == nil {
		return nil, newError(CodeInternal, "查询临时文件失败", errors.New("database is not configured"))
	}
	var files []store.TemporaryFile
	if err := s.db.WithContext(ctx).Where("id IN ?", fileIDs).Find(&files).Error; err != nil {
		return nil, newError(CodeInternal, "查询临时文件失败", err)
	}
	if len(files) != len(fileIDs) {
		return nil, newError(CodeNotFound, "临时文件不存在", gorm.ErrRecordNotFound)
	}
	now := s.now().UTC()
	for _, value := range files {
		if s.isTemporaryFileExpired(value, now) {
			return nil, newError(CodeNotFound, "临时文件不存在", gorm.ErrRecordNotFound)
		}
	}
	return files, nil
}

func (s *Service) isTemporaryFileExpired(value store.TemporaryFile, now time.Time) bool {
	return !s.temporaryFileExpiresAt(value).After(now)
}

func (s *Service) temporaryFileExpiresAt(value store.TemporaryFile) time.Time {
	if !value.ExpiresAt.IsZero() {
		return value.ExpiresAt.UTC()
	}
	return value.CreatedAt.UTC().AddDate(0, 0, s.temporaryRetentionDays(value.SizeBytes))
}

func (s *Service) temporaryRetentionDays(sizeBytes int64) int {
	if isLargeTemporaryFile(sizeBytes) {
		return LargeTemporaryExpireDays
	}
	return int(s.temporaryExpireDays)
}

func normalizeTemporaryFileIDs(rawFileIDs []string) ([]string, error) {
	if len(rawFileIDs) == 0 {
		return nil, newError(CodeInvalidRequest, "file_ids 不能为空", nil)
	}
	if len(rawFileIDs) > MaxResolveBatchSize {
		return nil, newError(CodeInvalidRequest, "file_ids 不能超过 100 个", nil)
	}

	seen := make(map[string]struct{}, len(rawFileIDs))
	fileIDs := make([]string, 0, len(rawFileIDs))
	for _, rawFileID := range rawFileIDs {
		parsed, err := uuid.Parse(strings.TrimSpace(rawFileID))
		if err != nil {
			return nil, newError(CodeInvalidRequest, "file_ids 包含无效 ID", err)
		}
		fileID := parsed.String()
		if _, ok := seen[fileID]; ok {
			continue
		}
		seen[fileID] = struct{}{}
		fileIDs = append(fileIDs, fileID)
	}
	return fileIDs, nil
}

func buildTemporaryObjectKey(now time.Time, fileID string, sizeBytes int64) string {
	prefix := TemporaryStandardObjectPrefix
	if isLargeTemporaryFile(sizeBytes) {
		prefix = TemporaryLargeObjectPrefix
	}
	return fmt.Sprintf("%s%s/%s", prefix, now.UTC().Format("2006/01/02"), fileID)
}

func isLargeTemporaryFile(sizeBytes int64) bool {
	return sizeBytes > LargeTemporaryFileThreshold
}

func normalizeContentType(value string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return "application/octet-stream"
}

func newTemporaryFile(value store.TemporaryFile) TemporaryFile {
	return TemporaryFile{
		ID:        value.ID,
		ObjectKey: value.ObjectKey,
		SizeBytes: value.SizeBytes,
		CreatedAt: value.CreatedAt,
		ExpiresAt: value.ExpiresAt,
	}
}

var _ PublicUploader = (*Service)(nil)
var _ TemporaryFileService = (*Service)(nil)
