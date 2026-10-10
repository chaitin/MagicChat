package account

import (
	"context"
	"errors"
	"strings"
	"time"

	"app/internal/auth"
	"app/internal/store"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	nativeAccessTTL          = time.Hour
	nativeRefreshIdleTTL     = 90 * 24 * time.Hour
	nativeRefreshAbsoluteTTL = 365 * 24 * time.Hour
)

func (s *Service) BeginNativeSession(ctx context.Context, accessToken string) (NativeSessionCredential, error) {
	return s.beginNativeSession(ctx, accessToken, false)
}

func (s *Service) ExchangeNativeSession(ctx context.Context, accessToken string) (NativeSessionCredential, error) {
	return s.beginNativeSession(ctx, accessToken, true)
}

func (s *Service) beginNativeSession(ctx context.Context, accessToken string, exchange bool) (NativeSessionCredential, error) {
	refreshToken, err := s.generateSessionToken()
	if err != nil {
		return NativeSessionCredential{}, internalError(err)
	}
	now := s.now().UTC()
	accessExpiry := now.Add(nativeAccessTTL)
	refreshExpiry := now.Add(nativeRefreshIdleTTL)
	absoluteExpiry := now.Add(nativeRefreshAbsoluteTTL)
	hash := auth.HashSessionToken(refreshToken)
	query := s.db.WithContext(ctx).Model(&store.UserSession{}).
		Where("token_hash = ? AND expires_at > ? AND refresh_token_hash IS NULL", auth.HashSessionToken(accessToken), now)
	if exchange {
		query = query.Where("native_exchange_until > ?", now)
	}
	result := query.Updates(map[string]any{"expires_at": accessExpiry, "refresh_token_hash": hash, "refresh_expires_at": refreshExpiry, "refresh_absolute_expires_at": absoluteExpiry, "native_exchange_until": nil})
	if result.Error != nil {
		return NativeSessionCredential{}, internalError(result.Error)
	}
	if result.RowsAffected != 1 {
		return NativeSessionCredential{}, unauthorized()
	}
	return NativeSessionCredential{SessionCredential: SessionCredential{Token: accessToken, ExpiresAt: accessExpiry}, RefreshToken: refreshToken, RefreshExpiresAt: refreshExpiry, RefreshAbsoluteExpiresAt: absoluteExpiry}, nil
}

func (s *Service) RefreshNativeSession(ctx context.Context, refreshToken string) (NativeSessionCredential, error) {
	if strings.TrimSpace(refreshToken) == "" || len(refreshToken) > 8192 {
		return NativeSessionCredential{}, unauthorized()
	}
	hash := auth.HashSessionToken(refreshToken)
	now := s.now().UTC()
	var credential NativeSessionCredential
	replayed := false
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var session store.UserSession
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("refresh_token_hash = ?", hash).First(&session).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			var used store.UsedNativeRefreshToken
			if err := tx.Where("token_hash = ?", hash).First(&used).Error; err == nil && now.Before(used.ExpiresAt) {
				if err := tx.Delete(&store.UserSession{}, "id = ?", used.SessionID).Error; err != nil {
					return err
				}
				replayed = true
				return nil
			} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			return unauthorized()
		}
		if err != nil {
			return err
		}
		if session.RefreshExpiresAt == nil || session.RefreshAbsoluteExpiresAt == nil || !now.Before(*session.RefreshExpiresAt) || !now.Before(*session.RefreshAbsoluteExpiresAt) {
			return unauthorized()
		}
		var user store.User
		if err := tx.Where("id = ? AND status = ?", session.UserID, store.UserStatusActive).First(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return unauthorized()
			}
			return err
		}
		accessToken, err := s.generateSessionToken()
		if err != nil {
			return err
		}
		nextRefreshToken, err := s.generateSessionToken()
		if err != nil {
			return err
		}
		accessExpiry := now.Add(nativeAccessTTL)
		refreshExpiry := now.Add(nativeRefreshIdleTTL)
		if refreshExpiry.After(*session.RefreshAbsoluteExpiresAt) {
			refreshExpiry = *session.RefreshAbsoluteExpiresAt
		}
		result := tx.Model(&store.UserSession{}).Where("id = ? AND refresh_token_hash = ?", session.ID, hash).
			Updates(map[string]any{"token_hash": auth.HashSessionToken(accessToken), "expires_at": accessExpiry, "refresh_token_hash": auth.HashSessionToken(nextRefreshToken), "refresh_expires_at": refreshExpiry})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return unauthorized()
		}
		if err := tx.Create(&store.UsedNativeRefreshToken{TokenHash: hash, SessionID: session.ID, ExpiresAt: *session.RefreshAbsoluteExpiresAt}).Error; err != nil {
			return err
		}
		credential = NativeSessionCredential{SessionCredential: SessionCredential{Token: accessToken, ExpiresAt: accessExpiry}, RefreshToken: nextRefreshToken, RefreshExpiresAt: refreshExpiry, RefreshAbsoluteExpiresAt: *session.RefreshAbsoluteExpiresAt}
		return nil
	})
	if err == nil {
		if replayed {
			return NativeSessionCredential{}, unauthorized()
		}
		return credential, nil
	}
	var accountError *Error
	if errors.As(err, &accountError) {
		return NativeSessionCredential{}, err
	}
	return NativeSessionCredential{}, internalError(err)
}

func (s *Service) RevokeNativeSession(ctx context.Context, refreshToken string) error {
	if strings.TrimSpace(refreshToken) == "" || len(refreshToken) > 8192 {
		return unauthorized()
	}
	result := s.db.WithContext(ctx).Delete(&store.UserSession{}, "refresh_token_hash = ?", auth.HashSessionToken(refreshToken))
	if result.Error != nil {
		return internalError(result.Error)
	}
	if result.RowsAffected != 1 {
		return unauthorized()
	}
	return nil
}
