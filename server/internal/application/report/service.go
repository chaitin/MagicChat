package report

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	defaultPageSize = 20
	maxPageSize     = 100
)

type Dependencies struct {
	DB  *gorm.DB
	Now func() time.Time
}

type Service struct {
	db  *gorm.DB
	now func() time.Time
}

func NewService(deps Dependencies) *Service {
	now := deps.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{db: deps.DB, now: now}
}

func (s *Service) Create(ctx context.Context, command CreateCommand) (Report, error) {
	accountID, conversationID, reason, description, err := normalizeCreateCommand(command)
	if err != nil {
		return Report{}, err
	}

	var conversation store.Conversation
	if err := s.db.WithContext(ctx).
		Where("id = ? AND kind = ?", conversationID, store.ConversationKindDirect).
		First(&conversation).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return Report{}, notFoundError()
		}
		return Report{}, internalError(err)
	}

	var members []store.ConversationMember
	if err := s.db.WithContext(ctx).
		Where("conversation_id = ? AND member_type = ? AND left_at IS NULL", conversationID, store.ConversationMemberTypeUser).
		Find(&members).Error; err != nil {
		return Report{}, internalError(err)
	}
	if len(members) != 2 {
		return Report{}, notFoundError()
	}

	reporterFound := false
	reportedUserID := ""
	for _, member := range members {
		if idsMatch(member.MemberID, accountID) {
			reporterFound = true
			continue
		}
		if reportedUserID != "" {
			return Report{}, notFoundError()
		}
		reportedUserID = member.MemberID
	}
	if !reporterFound || reportedUserID == "" || idsMatch(reportedUserID, accountID) {
		return Report{}, notFoundError()
	}

	value := store.UserReport{
		ID:             uuid.NewString(),
		ReporterUserID: accountID,
		ReportedUserID: reportedUserID,
		ConversationID: conversationID,
		Reason:         reason,
		Description:    description,
		CreatedAt:      s.now().UTC(),
	}
	if err := s.db.WithContext(ctx).Create(&value).Error; err != nil {
		return Report{}, internalError(err)
	}
	value.ReporterUser.ID = value.ReporterUserID
	value.ReportedUser.ID = value.ReportedUserID
	return newReport(value), nil
}

func (s *Service) List(ctx context.Context, query ListQuery) (ListResult, error) {
	page, pageSize := normalizePagination(query.Page, query.PageSize)
	var total int64
	if err := s.db.WithContext(ctx).Model(&store.UserReport{}).Count(&total).Error; err != nil {
		return ListResult{}, internalError(err)
	}

	values := make([]store.UserReport, 0)
	if err := s.db.WithContext(ctx).
		Preload("ReporterUser").
		Preload("ReportedUser").
		Order("created_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&values).Error; err != nil {
		return ListResult{}, internalError(err)
	}

	reports := make([]Report, 0, len(values))
	for _, value := range values {
		reports = append(reports, newReport(value))
	}
	return ListResult{Page: page, PageSize: pageSize, Reports: reports, Total: total}, nil
}

func normalizeCreateCommand(command CreateCommand) (string, string, string, string, error) {
	accountID := strings.ToLower(strings.TrimSpace(command.AccountID))
	conversationID := strings.ToLower(strings.TrimSpace(command.ConversationID))
	if _, err := uuid.Parse(accountID); err != nil {
		return "", "", "", "", invalidError("当前用户无效", err)
	}
	if _, err := uuid.Parse(conversationID); err != nil {
		return "", "", "", "", invalidError("会话 ID 无效", err)
	}
	reason := strings.TrimSpace(command.Reason)
	if _, ok := validReasons[reason]; !ok {
		return "", "", "", "", invalidError("请选择有效的举报原因", nil)
	}
	description := strings.TrimSpace(command.Description)
	if count := utf8.RuneCountInString(description); count < 1 || count > 500 {
		return "", "", "", "", invalidError("举报描述须为 1 至 500 个字符", nil)
	}
	return accountID, conversationID, reason, description, nil
}

func normalizePagination(page int, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = defaultPageSize
	}
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}
	return page, pageSize
}

func idsMatch(left string, right string) bool {
	return strings.EqualFold(strings.TrimSpace(left), strings.TrimSpace(right))
}

func newReport(value store.UserReport) Report {
	return Report{
		ConversationID: value.ConversationID,
		CreatedAt:      value.CreatedAt,
		Description:    value.Description,
		ID:             value.ID,
		Reason:         value.Reason,
		ReportedUser:   newUserSummary(value.ReportedUser),
		ReporterUser:   newUserSummary(value.ReporterUser),
	}
}

func newUserSummary(value store.User) UserSummary {
	phone := ""
	if value.Phone != nil {
		phone = *value.Phone
	}
	return UserSummary{
		Avatar: value.Avatar, Email: value.Email, ID: value.ID,
		Name: value.Name, Nickname: value.Nickname, Phone: phone, Status: value.Status,
	}
}

var _ ClientService = (*Service)(nil)
var _ AdminService = (*Service)(nil)
