package report

import (
	"context"
	"time"
)

const (
	ReasonSexualContent        = "sexual_content"
	ReasonViolenceOrThreat     = "violence_or_threat"
	ReasonHarassmentOrAbuse    = "harassment_or_abuse"
	ReasonHateOrDiscrimination = "hate_or_discrimination"
	ReasonFraud                = "fraud"
	ReasonSpam                 = "spam"
	ReasonIllegalContent       = "illegal_content"
	ReasonPrivacyOrIPViolation = "privacy_or_ip_violation"
	ReasonOther                = "other"
)

var validReasons = map[string]struct{}{
	ReasonSexualContent: {}, ReasonViolenceOrThreat: {},
	ReasonHarassmentOrAbuse: {}, ReasonHateOrDiscrimination: {},
	ReasonFraud: {}, ReasonSpam: {}, ReasonIllegalContent: {},
	ReasonPrivacyOrIPViolation: {}, ReasonOther: {},
}

type UserSummary struct {
	Avatar   string
	Email    string
	ID       string
	Name     string
	Nickname string
	Phone    string
	Status   string
}

type Report struct {
	ConversationID string
	CreatedAt      time.Time
	Description    string
	ID             string
	Reason         string
	ReportedUser   UserSummary
	ReporterUser   UserSummary
}

type CreateCommand struct {
	AccountID      string
	ConversationID string
	Description    string
	Reason         string
}

type ListQuery struct {
	Page     int
	PageSize int
}

type ListResult struct {
	Page     int
	PageSize int
	Reports  []Report
	Total    int64
}

type ClientService interface {
	Create(context.Context, CreateCommand) (Report, error)
}

type AdminService interface {
	List(context.Context, ListQuery) (ListResult, error)
}
