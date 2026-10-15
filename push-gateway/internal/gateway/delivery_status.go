package gateway

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"strings"
	"time"

	"gorm.io/gorm"
	"push-gateway/internal/model"
)

type DeliveryStatus struct {
	GrantStatus        string             `json:"grant_status"`
	InstallationStatus string             `json:"installation_status"`
	Provider           string             `json:"provider"`
	Environment        string             `json:"environment"`
	LastJob            *DeliveryJobStatus `json:"last_job"`
}

type DeliveryJobStatus struct {
	Status    string    `json:"status"`
	Reason    string    `json:"reason"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (s *Service) GetDeliveryStatus(ctx context.Context, grantID, managementToken string) (DeliveryStatus, error) {
	id, err := uuid.Parse(strings.TrimSpace(grantID))
	if err != nil {
		return DeliveryStatus{}, newFailure("invalid_request", "推送授权格式错误")
	}
	db := s.db.WithContext(ctx)
	grant, err := loadGrantForManagement(db, id.String(), managementToken)
	if err != nil {
		return DeliveryStatus{}, err
	}
	status := DeliveryStatus{GrantStatus: grant.Status, InstallationStatus: grant.Installation.Status, Provider: grant.Installation.Provider, Environment: grant.Installation.Environment}
	if grant.Status == model.GrantStatusActive && !grant.ExpiresAt.After(s.now().UTC()) {
		status.GrantStatus = model.GrantStatusExpired
	}
	var job model.Job
	err = db.Where("grant_id = ?", grant.ID).Order("created_at DESC").Order("id DESC").First(&job).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return status, nil
	}
	if err != nil {
		return status, err
	}
	status.LastJob = &DeliveryJobStatus{Status: job.Status, Reason: safeErrorCode(job.LastErrorCode), UpdatedAt: job.UpdatedAt}
	return status, nil
}
