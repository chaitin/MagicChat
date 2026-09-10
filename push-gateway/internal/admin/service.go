package admin

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"push-gateway/internal/model"
	"push-gateway/internal/secure"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const MaxDailyQuota int64 = 100_000_000

var beijing = time.FixedZone("Asia/Shanghai", 8*60*60)

type Options struct {
	DB           *gorm.DB
	Cipher       *secure.TokenCipher
	Username     string
	Password     string
	PasswordHash string
	Now          func() time.Time
	SessionTTL   time.Duration
}

type Service struct {
	db           *gorm.DB
	cipher       *secure.TokenCipher
	username     string
	passwordHash string
	now          func() time.Time
	sessionTTL   time.Duration
	enabled      bool
}

type Failure struct {
	Code string
}

func (f *Failure) Error() string { return f.Code }

func FailureOf(err error) (*Failure, bool) {
	var failure *Failure
	ok := errors.As(err, &failure)
	return failure, ok
}

func New(options Options) (*Service, error) {
	if options.DB == nil || options.Cipher == nil {
		return nil, fmt.Errorf("database and cipher are required")
	}
	username := strings.TrimSpace(options.Username)
	password := options.Password
	passwordHash := strings.TrimSpace(options.PasswordHash)
	if password != "" && passwordHash != "" {
		return nil, fmt.Errorf("admin plaintext password and password hash cannot both be configured")
	}
	if password != "" {
		var err error
		passwordHash, err = secure.HashArgon2id(password)
		if err != nil {
			return nil, fmt.Errorf("hash admin password: %w", err)
		}
	}
	if (username == "") != (passwordHash == "") {
		return nil, fmt.Errorf("admin username and password credential must be configured together")
	}
	if passwordHash != "" && !secure.IsArgon2idHash(passwordHash) {
		return nil, fmt.Errorf("admin password hash must be a valid Argon2id PHC string")
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	ttl := options.SessionTTL
	if ttl <= 0 {
		ttl = 12 * time.Hour
	}
	return &Service{
		db: options.DB, cipher: options.Cipher, username: username,
		passwordHash: passwordHash, now: now, sessionTTL: ttl,
		enabled: username != "",
	}, nil
}

func (s *Service) Enabled() bool { return s.enabled }

type SessionCredential struct {
	SessionToken string
	CSRFToken    string
	ExpiresAt    time.Time
}

func (s *Service) Login(ctx context.Context, username, password, clientKey string) (SessionCredential, error) {
	if !s.enabled {
		return SessionCredential{}, &Failure{Code: "admin_unavailable"}
	}
	now := s.now().UTC()
	if err := s.limitLogin(ctx, clientKey, now); err != nil {
		return SessionCredential{}, err
	}
	validPassword := secure.VerifyArgon2id(s.passwordHash, password)
	if strings.TrimSpace(username) != s.username || !validPassword {
		return SessionCredential{}, &Failure{Code: "invalid_credentials"}
	}
	sessionToken, err := secure.GenerateToken()
	if err != nil {
		return SessionCredential{}, err
	}
	csrfToken, err := secure.GenerateToken()
	if err != nil {
		return SessionCredential{}, err
	}
	session := model.AdminSession{
		ID: uuid.NewString(), TokenHash: secure.HashToken(sessionToken),
		CSRFTokenHash: secure.HashToken(csrfToken), ExpiresAt: now.Add(s.sessionTTL),
		CreatedAt: now, UpdatedAt: now,
	}
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("expires_at <= ?", now).Delete(&model.AdminSession{}).Error; err != nil {
			return err
		}
		return tx.Create(&session).Error
	}); err != nil {
		return SessionCredential{}, err
	}
	return SessionCredential{SessionToken: sessionToken, CSRFToken: csrfToken, ExpiresAt: session.ExpiresAt}, nil
}

func (s *Service) Authenticate(ctx context.Context, sessionToken string) (model.AdminSession, error) {
	if !s.enabled || strings.TrimSpace(sessionToken) == "" {
		return model.AdminSession{}, &Failure{Code: "admin_unauthorized"}
	}
	var session model.AdminSession
	now := s.now().UTC()
	err := s.db.WithContext(ctx).Where("token_hash = ?", secure.HashToken(strings.TrimSpace(sessionToken))).First(&session).Error
	if errors.Is(err, gorm.ErrRecordNotFound) || err == nil && !session.ExpiresAt.After(now) {
		return model.AdminSession{}, &Failure{Code: "admin_unauthorized"}
	}
	if err != nil {
		return model.AdminSession{}, err
	}
	return session, nil
}

func (s *Service) VerifyCSRF(session model.AdminSession, token string) error {
	if !secure.MatchesToken(session.CSRFTokenHash, strings.TrimSpace(token)) {
		return &Failure{Code: "csrf_invalid"}
	}
	return nil
}

func (s *Service) Logout(ctx context.Context, sessionToken string) error {
	if strings.TrimSpace(sessionToken) == "" {
		return nil
	}
	return s.db.WithContext(ctx).Where("token_hash = ?", secure.HashToken(strings.TrimSpace(sessionToken))).Delete(&model.AdminSession{}).Error
}

func (s *Service) limitLogin(ctx context.Context, clientKey string, now time.Time) error {
	keyHash := secure.HashToken(strings.TrimSpace(clientKey))
	window := now.Truncate(time.Minute)
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var value model.RateLimit
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&value,
			"scope = ? AND key_hash = ? AND window_start = ?", "admin_login", keyHash, window).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return tx.Create(&model.RateLimit{Scope: "admin_login", KeyHash: keyHash, WindowStart: window, Count: 1, UpdatedAt: now}).Error
		}
		if err != nil {
			return err
		}
		if value.Count >= 10 {
			return &Failure{Code: "login_rate_limited"}
		}
		return tx.Model(&value).Updates(map[string]any{"count": value.Count + 1, "updated_at": now}).Error
	})
}

type ServerView struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Status     string    `json:"status"`
	DailyQuota int64     `json:"daily_quota"`
	TodayUsage int64     `json:"today_usage"`
	Revision   int64     `json:"revision"`
	CreatedAt  time.Time `json:"created_at"`
}

type IssuedServer struct {
	Server ServerView `json:"server"`
	Key    string     `json:"key"`
}

func (s *Service) ListServers(ctx context.Context) ([]ServerView, error) {
	date := beijingDate(s.now())
	var result []ServerView
	err := s.db.WithContext(ctx).Table("push_servers AS servers").
		Select("servers.id, servers.name, servers.status, servers.daily_quota, servers.revision, servers.created_at, COALESCE(usage.accepted_count, 0) AS today_usage").
		Joins("LEFT JOIN push_server_daily_usage AS usage ON usage.server_id = servers.id AND usage.usage_date = ?", date).
		Order("servers.created_at DESC").Scan(&result).Error
	return result, err
}

func (s *Service) CreateServer(ctx context.Context, name string, dailyQuota int64, requestID string) (IssuedServer, error) {
	name, err := validateServerInput(name, dailyQuota)
	if err != nil {
		return IssuedServer{}, err
	}
	now := s.now().UTC()
	server := model.Server{ID: uuid.NewString(), Name: name, Status: model.ServerStatusActive, DailyQuota: dailyQuota, Revision: 1, CreatedAt: now, UpdatedAt: now}
	key, plaintext, err := s.newServerKey(server.ID, now)
	if err != nil {
		return IssuedServer{}, err
	}
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&server).Error; err != nil {
			return err
		}
		if err := tx.Create(&key).Error; err != nil {
			return err
		}
		return createAudit(tx, "server.create", &server.ID, requestID, now)
	}); err != nil {
		return IssuedServer{}, err
	}
	return IssuedServer{Server: serverView(server, 0), Key: plaintext}, nil
}

func (s *Service) UpdateServer(ctx context.Context, id, name string, dailyQuota int64, requestID string) (ServerView, error) {
	name, err := validateServerInput(name, dailyQuota)
	if err != nil {
		return ServerView{}, err
	}
	now := s.now().UTC()
	var server model.Server
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := loadServerForUpdate(tx, id, &server); err != nil {
			return err
		}
		server.Name, server.DailyQuota, server.Revision, server.UpdatedAt = name, dailyQuota, server.Revision+1, now
		if err := tx.Save(&server).Error; err != nil {
			return err
		}
		return createAudit(tx, "server.update", &server.ID, requestID, now)
	})
	if err != nil {
		return ServerView{}, err
	}
	usage, err := s.todayUsage(ctx, server.ID)
	return serverView(server, usage), err
}

func (s *Service) SetServerStatus(ctx context.Context, id, status, requestID string) (ServerView, error) {
	if status != model.ServerStatusActive && status != model.ServerStatusDisabled {
		return ServerView{}, &Failure{Code: "invalid_request"}
	}
	now := s.now().UTC()
	var server model.Server
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := loadServerForUpdate(tx, id, &server); err != nil {
			return err
		}
		server.Status, server.Revision, server.UpdatedAt = status, server.Revision+1, now
		if err := tx.Save(&server).Error; err != nil {
			return err
		}
		if status == model.ServerStatusDisabled {
			if err := tx.Model(&model.Job{}).
				Where("server_id = ? AND status IN ?", server.ID, []string{model.JobStatusQueued, model.JobStatusRetry}).
				Updates(map[string]any{"status": model.JobStatusFailed, "last_error_code": "server_disabled", "updated_at": now}).Error; err != nil {
				return err
			}
		}
		return createAudit(tx, "server."+status, &server.ID, requestID, now)
	})
	if err != nil {
		return ServerView{}, err
	}
	usage, err := s.todayUsage(ctx, server.ID)
	return serverView(server, usage), err
}

func (s *Service) RevealServerKey(ctx context.Context, id, requestID string) (string, error) {
	var plaintext string
	now := s.now().UTC()
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var key model.ServerKey
		if err := tx.Where("server_id = ? AND status = ?", strings.TrimSpace(id), model.ServerKeyStatusActive).First(&key).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return &Failure{Code: "server_not_found"}
			}
			return err
		}
		value, err := s.cipher.Decrypt(key.KeyCiphertext, []byte(key.ID))
		if err != nil {
			return err
		}
		plaintext = value
		if s.cipher.NeedsRotation(key.KeyCiphertext) {
			rotated, err := s.cipher.Encrypt(value, []byte(key.ID))
			if err != nil {
				return err
			}
			if err := tx.Model(&model.ServerKey{}).Where("id = ?", key.ID).Update("key_ciphertext", rotated).Error; err != nil {
				return err
			}
		}
		return createAudit(tx, "server.key.reveal", &key.ServerID, requestID, now)
	})
	return plaintext, err
}

func (s *Service) RotateServerKey(ctx context.Context, id, requestID string) (IssuedServer, error) {
	now := s.now().UTC()
	var server model.Server
	var plaintext string
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := loadServerForUpdate(tx, id, &server); err != nil {
			return err
		}
		if err := tx.Model(&model.ServerKey{}).Where("server_id = ? AND status = ?", server.ID, model.ServerKeyStatusActive).Updates(map[string]any{
			"status": model.ServerKeyStatusRevoked, "key_ciphertext": nil, "revoked_at": now,
		}).Error; err != nil {
			return err
		}
		key, value, err := s.newServerKey(server.ID, now)
		if err != nil {
			return err
		}
		plaintext = value
		if err := tx.Create(&key).Error; err != nil {
			return err
		}
		server.Revision, server.UpdatedAt = server.Revision+1, now
		if err := tx.Save(&server).Error; err != nil {
			return err
		}
		return createAudit(tx, "server.key.rotate", &server.ID, requestID, now)
	})
	if err != nil {
		return IssuedServer{}, err
	}
	usage, err := s.todayUsage(ctx, server.ID)
	return IssuedServer{Server: serverView(server, usage), Key: plaintext}, err
}

func (s *Service) newServerKey(serverID string, now time.Time) (model.ServerKey, string, error) {
	publicID, plaintext, err := secure.GenerateServerKey()
	if err != nil {
		return model.ServerKey{}, "", err
	}
	key := model.ServerKey{ID: uuid.NewString(), ServerID: serverID, PublicID: publicID, KeyHash: secure.HashToken(plaintext), Status: model.ServerKeyStatusActive, CreatedAt: now}
	key.KeyCiphertext, err = s.cipher.Encrypt(plaintext, []byte(key.ID))
	return key, plaintext, err
}

func (s *Service) todayUsage(ctx context.Context, serverID string) (int64, error) {
	var usage model.ServerDailyUsage
	err := s.db.WithContext(ctx).First(&usage, "server_id = ? AND usage_date = ?", serverID, beijingDate(s.now())).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	return usage.AcceptedCount, err
}

func validateServerInput(name string, dailyQuota int64) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 64 || dailyQuota < 1 || dailyQuota > MaxDailyQuota {
		return "", &Failure{Code: "invalid_request"}
	}
	return name, nil
}

func loadServerForUpdate(tx *gorm.DB, id string, server *model.Server) error {
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(server, "id = ?", strings.TrimSpace(id)).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &Failure{Code: "server_not_found"}
	}
	return err
}

func createAudit(tx *gorm.DB, action string, serverID *string, requestID string, now time.Time) error {
	return tx.Create(&model.AdminAuditEvent{ID: uuid.NewString(), Action: action, ServerID: serverID, RequestID: strings.TrimSpace(requestID), CreatedAt: now}).Error
}

func serverView(server model.Server, usage int64) ServerView {
	return ServerView{ID: server.ID, Name: server.Name, Status: server.Status, DailyQuota: server.DailyQuota, TodayUsage: usage, Revision: server.Revision, CreatedAt: server.CreatedAt}
}

func beijingDate(now time.Time) string {
	return now.In(beijing).Format("2006-01-02")
}
