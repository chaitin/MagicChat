package gateway

import (
	"errors"
	"strings"
	"time"

	"push-gateway/internal/model"
	"push-gateway/internal/secure"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var beijing = time.FixedZone("Asia/Shanghai", 8*60*60)

func authenticateServer(tx *gorm.DB, rawKey string) (model.Server, error) {
	serverKey := strings.TrimSpace(rawKey)
	if !secure.ValidServerKey(serverKey) {
		return model.Server{}, newFailure("server_unauthorized", "服务器认证失败")
	}
	var server model.Server
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&server, "server_key = ?", serverKey).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Server{}, newFailure("server_unauthorized", "服务器认证失败")
	}
	if err != nil {
		return model.Server{}, err
	}
	return server, nil
}

func chargeServerQuota(tx *gorm.DB, server model.Server, now time.Time) (string, error) {
	date := now.In(beijing).Format("2006-01-02")
	var usage model.ServerDailyUsage
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&usage,
		"server_id = ? AND usage_date = ?", server.ID, date).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		usage = model.ServerDailyUsage{ServerID: server.ID, UsageDate: date, AcceptedCount: 0, UpdatedAt: now}
		if err := tx.Create(&usage).Error; err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	}
	if usage.AcceptedCount >= server.DailyQuota {
		return "", newFailure("daily_quota_exceeded", "服务器今日推送额度已用完")
	}
	if err := tx.Model(&model.ServerDailyUsage{}).
		Where("server_id = ? AND usage_date = ?", server.ID, date).
		Updates(map[string]any{"accepted_count": usage.AcceptedCount + 1, "updated_at": now}).Error; err != nil {
		return "", err
	}
	return date, nil
}
