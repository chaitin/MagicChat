package accountdeactivation

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"time"

	"app/internal/application/emailauth"
	settingsapp "app/internal/application/settings"
	"app/internal/store"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	CodeTTL                  = 15 * time.Minute
	SendCooldown             = 5 * time.Second
	MaxFailedAttempts        = 5
	transactionRetryAttempts = 3
)

type Code string

const (
	CodeInvalidRequest     Code = "invalid_request"
	CodeInvalidCode        Code = "invalid_code"
	CodeTooManyRequests    Code = "too_many_requests"
	CodeAccountNotActive   Code = "account_not_active"
	CodeEmailUnavailable   Code = "email_unavailable"
	CodeServiceUnavailable Code = "service_unavailable"
	CodeInternal           Code = "internal_error"
)

type Error struct {
	Code       Code
	Message    string
	RetryAfter int
	Cause      error
}

func (e *Error) Error() string { return e.Message }
func ErrorCodeOf(err error) Code {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return CodeInternal
}
func RetryAfterOf(err error) int {
	var e *Error
	if errors.As(err, &e) {
		return e.RetryAfter
	}
	return 0
}

type Result struct {
	ExpiresInSeconds  int `json:"expires_in_seconds"`
	RetryAfterSeconds int `json:"retry_after_seconds"`
}
type Settings interface {
	Get(context.Context) (settingsapp.Settings, error)
	GetEmailLogin(context.Context) (settingsapp.EmailLoginSettings, error)
}
type Mailer interface {
	SendAccountDeactivationCode(context.Context, emailauth.Mail) error
}
type Presence interface{ CloseUser(string) int }
type Dependencies struct {
	DB                *gorm.DB
	Settings          Settings
	Mailer            Mailer
	Secret            string
	Presence          Presence
	Now               func() time.Time
	GenerateCode      func() (string, error)
	InvalidateProfile func(string)
}
type Service struct {
	db                *gorm.DB
	settings          Settings
	mailer            Mailer
	key               []byte
	presence          Presence
	now               func() time.Time
	generateCode      func() (string, error)
	invalidateProfile func(string)
}

func NewService(d Dependencies) *Service {
	n := d.Now
	if n == nil {
		n = func() time.Time { return time.Now().UTC() }
	}
	g := d.GenerateCode
	if g == nil {
		g = generateCode
	}
	m := hmac.New(sha256.New, []byte(d.Secret))
	m.Write([]byte("dianbao/account-deactivation/v1"))
	return &Service{
		db: d.DB, settings: d.Settings, mailer: d.Mailer, key: m.Sum(nil),
		presence: d.Presence, now: n, generateCode: g, invalidateProfile: d.InvalidateProfile,
	}
}
func generateCode() (string, error) {
	var b [8]byte
	if _, e := rand.Read(b[:]); e != nil {
		return "", e
	}
	return fmt.Sprintf("%08d", binary.BigEndian.Uint64(b[:])%100000000), nil
}

type sqlStateError interface {
	SQLState() string
}

func retryTransaction(ctx context.Context, operation func() error) error {
	for attempt := 0; attempt < transactionRetryAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := operation()
		if err == nil || !isRetryableTransactionError(err) || attempt == transactionRetryAttempts-1 {
			return err
		}
	}
	return nil
}

func isRetryableTransactionError(err error) bool {
	var state sqlStateError
	if !errors.As(err, &state) {
		return false
	}
	return state.SQLState() == "40P01" || state.SQLState() == "40001"
}

func (s *Service) RequestCode(ctx context.Context, userID string) (Result, error) {
	now := s.now().UTC()
	smtp, err := s.settings.GetEmailLogin(ctx)
	if err != nil || s.mailer == nil {
		return Result{}, &Error{Code: CodeServiceUnavailable, Message: "邮件服务不可用", Cause: err}
	}
	brand, err := s.settings.Get(ctx)
	if err != nil {
		return Result{}, &Error{Code: CodeServiceUnavailable, Message: "邮件服务不可用", Cause: err}
	}
	var user store.User
	var challengeID, code string
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if e := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", userID).Error; e != nil {
			return e
		}
		if user.Status != store.UserStatusActive {
			return &Error{Code: CodeAccountNotActive, Message: "账号不可注销"}
		}
		if strings.TrimSpace(user.Email) == "" {
			return &Error{Code: CodeEmailUnavailable, Message: "账号邮箱不可用"}
		}
		var latest store.AccountDeactivationChallenge
		r := tx.Where("user_id = ?", userID).Order("created_at DESC").Limit(1).Find(&latest)
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected > 0 {
			next := latest.CreatedAt.Add(SendCooldown)
			if next.After(now) {
				return &Error{Code: CodeTooManyRequests, Message: "请求过于频繁", RetryAfter: int(next.Sub(now).Seconds() + .999)}
			}
		}
		generated, e := s.generateCode()
		if e != nil {
			return e
		}
		code = generated
		challengeID = uuid.NewString()
		if e = tx.Model(&store.AccountDeactivationChallenge{}).Where("user_id = ? AND consumed_at IS NULL", userID).Update("consumed_at", now).Error; e != nil {
			return e
		}
		ch := store.AccountDeactivationChallenge{ID: challengeID, UserID: user.ID, Email: user.Email, CodeMAC: s.mac(challengeID, user.ID, user.Email, code), ExpiresAt: now.Add(CodeTTL), CreatedAt: now, UpdatedAt: now}
		if e = tx.Create(&ch).Error; e != nil {
			return e
		}
		return nil
	})
	if err != nil {
		var e *Error
		if errors.As(err, &e) {
			return Result{}, e
		}
		return Result{}, &Error{Code: CodeInternal, Message: "服务端错误", Cause: err}
	}
	if err := s.mailer.SendAccountDeactivationCode(ctx, emailauth.Mail{SMTP: smtp, Recipient: user.Email, AppName: brand.AppName, OrganizationName: brand.OrganizationName, Code: code, ExpiresIn: CodeTTL}); err != nil {
		consumedAt := s.now().UTC()
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		invalidateErr := s.db.WithContext(cleanupCtx).Model(&store.AccountDeactivationChallenge{}).
			Where("id = ? AND consumed_at IS NULL", challengeID).
			Updates(map[string]any{"consumed_at": consumedAt, "updated_at": consumedAt}).Error
		if invalidateErr != nil {
			return Result{}, &Error{Code: CodeInternal, Message: "服务端错误", Cause: invalidateErr}
		}
		return Result{}, &Error{Code: CodeServiceUnavailable, Message: "邮件服务不可用", Cause: err}
	}
	return Result{ExpiresInSeconds: 900, RetryAfterSeconds: 5}, nil
}
func (s *Service) Deactivate(ctx context.Context, userID, code string) error {
	if len(code) != 8 || strings.Trim(code, "0123456789") != "" {
		return &Error{Code: CodeInvalidRequest, Message: "验证码格式错误"}
	}
	now := s.now().UTC()
	invalidCode := false
	err := retryTransaction(ctx, func() error {
		invalidCode = false
		return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var user store.User
			if e := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", userID).Error; e != nil {
				return e
			}
			if user.Status != store.UserStatusActive {
				return &Error{Code: CodeAccountNotActive, Message: "账号不可注销"}
			}
			var ch store.AccountDeactivationChallenge
			r := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND consumed_at IS NULL", userID).Order("created_at DESC").Limit(1).Find(&ch)
			if r.Error != nil {
				return r.Error
			}
			invalid := r.RowsAffected == 0 || ch.Email != user.Email || !ch.ExpiresAt.After(now) || ch.FailedAttempts >= MaxFailedAttempts
			if !invalid && !hmac.Equal(ch.CodeMAC, s.mac(ch.ID, user.ID, user.Email, code)) {
				ch.FailedAttempts++
				if e := tx.Model(&ch).Updates(map[string]any{"failed_attempts": ch.FailedAttempts, "updated_at": now}).Error; e != nil {
					return e
				}
				invalid = true
			}
			if invalid {
				invalidCode = true
				return nil
			}
			if e := tx.Model(&ch).Updates(map[string]any{"consumed_at": now, "updated_at": now}).Error; e != nil {
				return e
			}
			if e := tx.Model(&user).Updates(map[string]any{"status": store.UserStatusDisabled, "updated_at": now}).Error; e != nil {
				return e
			}
			// Push registration uses grant-before-child ordering. Match it here; the
			// outer transaction retry handles deadlocks with workers that already own a child row.
			var grants []store.UserPushGrant
			if e := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").Where("user_id = ?", userID).Find(&grants).Error; e != nil {
				return e
			}
			if e := tx.Where("user_id = ?", userID).Delete(&store.MobilePushRoute{}).Error; e != nil {
				return e
			}
			if e := tx.Where("user_id = ?", userID).Delete(&store.MobilePushJob{}).Error; e != nil {
				return e
			}
			if e := tx.Where("user_id = ?", userID).Delete(&store.UserPushGrant{}).Error; e != nil {
				return e
			}
			return tx.Where("user_id = ?", userID).Delete(&store.UserSession{}).Error
		})
	})
	if err != nil {
		var e *Error
		if errors.As(err, &e) {
			return e
		}
		return &Error{Code: CodeInternal, Message: "服务端错误", Cause: err}
	}
	if invalidCode {
		return &Error{Code: CodeInvalidCode, Message: "验证码无效"}
	}
	if s.invalidateProfile != nil {
		s.invalidateProfile(userID)
	}
	if s.presence != nil {
		s.presence.CloseUser(userID)
	}
	return nil
}
func (s *Service) mac(id, uid, email, code string) []byte {
	m := hmac.New(sha256.New, s.key)
	m.Write([]byte(id + "\x00" + uid + "\x00" + strings.ToLower(strings.TrimSpace(email)) + "\x00account_deactivation\x00" + code))
	return m.Sum(nil)
}
