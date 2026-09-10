package account

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/mail"
	"strconv"
	"strings"
	"time"

	fileapp "app/internal/application/file"
	projectapp "app/internal/application/project"
	"app/internal/auth"
	"app/internal/media"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultSessionTTL = 7 * 24 * time.Hour
	avatarContentType = "image/webp"
	avatarSize        = 256
	maxAvatarBytes    = 1 * 1024 * 1024
)

type Dependencies struct {
	DB                   *gorm.DB
	Files                fileapp.PublicUploader
	PasswordLoginPolicy  PasswordLoginPolicy
	UserNicknamePolicy   UserNicknamePolicy
	ProfileNotifications ProfileNotifications
	Now                  func() time.Time
	GenerateSessionToken func() (string, error)
	RandomAvatar         func() string
	SessionTTL           time.Duration
}

type Service struct {
	db                   *gorm.DB
	files                fileapp.PublicUploader
	passwordLoginPolicy  PasswordLoginPolicy
	userNicknamePolicy   UserNicknamePolicy
	profileNotifications ProfileNotifications
	now                  func() time.Time
	generateSessionToken func() (string, error)
	randomAvatar         func() string
	sessionTTL           time.Duration

	profiles profileCache
	activity activityBuffer
}

func NewService(deps Dependencies) *Service {
	now := deps.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	generateSessionToken := deps.GenerateSessionToken
	if generateSessionToken == nil {
		generateSessionToken = auth.GenerateSessionToken
	}
	randomAvatar := deps.RandomAvatar
	if randomAvatar == nil {
		randomAvatar = store.RandomBuiltinAvatar
	}
	sessionTTL := deps.SessionTTL
	if sessionTTL <= 0 {
		sessionTTL = defaultSessionTTL
	}

	return &Service{
		db:                   deps.DB,
		files:                deps.Files,
		passwordLoginPolicy:  deps.PasswordLoginPolicy,
		userNicknamePolicy:   deps.UserNicknamePolicy,
		profileNotifications: deps.ProfileNotifications,
		now:                  now,
		generateSessionToken: generateSessionToken,
		randomAvatar:         randomAvatar,
		sessionTTL:           sessionTTL,
	}
}

func (s *Service) Login(ctx context.Context, cmd LoginCommand) (LoginResult, error) {
	if s.passwordLoginPolicy != nil {
		enabled, err := s.passwordLoginPolicy.PasswordLoginEnabled(ctx)
		if err != nil {
			return LoginResult{}, internalError(err)
		}
		if !enabled {
			return LoginResult{}, newError(CodeLoginUnavailable, "密码登录未启用", nil)
		}
	}
	email, err := normalizeEmail(cmd.Email)
	if err != nil {
		return LoginResult{}, invalidCredentials()
	}

	var user store.User
	err = s.db.WithContext(ctx).Where("email = ?", email).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return LoginResult{}, invalidCredentials()
	}
	if err != nil {
		return LoginResult{}, internalError(err)
	}
	if user.Status != store.UserStatusActive {
		return LoginResult{}, invalidCredentials()
	}

	valid, err := auth.VerifyPassword(cmd.Password, user.PasswordHash)
	if err != nil || !valid {
		return LoginResult{}, invalidCredentials()
	}
	return s.createLoginSession(ctx, user, cmd.UserAgent, cmd.IP)
}

func (s *Service) CanLoginWithEmail(ctx context.Context, rawEmail string, allowRegistration bool) (bool, error) {
	email, err := normalizeEmail(rawEmail)
	if err != nil {
		return false, nil
	}
	var user store.User
	err = s.db.WithContext(ctx).Where("email = ?", email).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return allowRegistration, nil
	}
	if err != nil {
		return false, internalError(err)
	}
	return user.Status == store.UserStatusActive, nil
}

func (s *Service) LoginWithVerifiedEmail(ctx context.Context, cmd VerifiedEmailLoginCommand) (LoginResult, error) {
	email, err := normalizeEmail(cmd.Email)
	if err != nil {
		return LoginResult{}, invalidCredentials()
	}
	var user store.User
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing store.User
		err := tx.Where("email = ?", email).First(&existing).Error
		if err == nil {
			if existing.Status != store.UserStatusActive {
				return invalidCredentials()
			}
			user = existing
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if !cmd.AllowRegistration {
			return invalidCredentials()
		}

		password, err := auth.GenerateSessionToken()
		if err != nil {
			return err
		}
		passwordHash, err := auth.HashPassword(password)
		if err != nil {
			return err
		}
		now := s.now().UTC()
		candidate := store.User{
			ID: uuid.NewString(), Email: email, Name: emailName(email), Avatar: s.randomAvatar(),
			PasswordHash: passwordHash, Status: store.UserStatusActive, CreatedAt: now, UpdatedAt: now,
		}
		created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate)
		if created.Error != nil {
			return created.Error
		}
		if created.RowsAffected == 0 {
			if err := tx.Where("email = ?", email).First(&existing).Error; err != nil {
				return err
			}
			if existing.Status != store.UserStatusActive {
				return invalidCredentials()
			}
			user = existing
			return nil
		}
		if err := projectapp.ProvisionPersonalWorkspace(tx, candidate.ID, now); err != nil {
			return err
		}
		user = candidate
		return nil
	}); err != nil {
		if ErrorCodeOf(err) == CodeInvalidCredentials {
			return LoginResult{}, err
		}
		return LoginResult{}, internalError(err)
	}
	return s.createLoginSession(ctx, user, cmd.UserAgent, cmd.IP)
}

func emailName(email string) string {
	if local, _, ok := strings.Cut(email, "@"); ok && strings.TrimSpace(local) != "" {
		return local
	}
	return email
}

func (s *Service) createLoginSession(ctx context.Context, user store.User, userAgent string, ip string) (LoginResult, error) {
	token, err := s.generateSessionToken()
	if err != nil {
		return LoginResult{}, internalError(err)
	}
	now := s.now().UTC()
	session := store.UserSession{
		ID:         uuid.NewString(),
		TokenHash:  auth.HashSessionToken(token),
		UserID:     user.ID,
		ExpiresAt:  now.Add(s.sessionTTL),
		CreatedAt:  now,
		LastSeenAt: now,
		UserAgent:  userAgent,
		IP:         ip,
	}
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var locked store.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&locked, "id = ?", user.ID).Error; err != nil {
			return err
		}
		if locked.Status != store.UserStatusActive {
			return invalidCredentials()
		}
		user = locked
		return tx.Create(&session).Error
	}); err != nil {
		if ErrorCodeOf(err) == CodeInvalidCredentials {
			return LoginResult{}, err
		}
		return LoginResult{}, internalError(err)
	}

	return LoginResult{
		Account: newAccount(user),
		Session: SessionCredential{Token: token, ExpiresAt: session.ExpiresAt},
	}, nil
}

func (s *Service) Logout(ctx context.Context, cmd LogoutCommand) error {
	token := strings.TrimSpace(cmd.Token)
	if token == "" {
		return nil
	}
	found := false
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		installationID := strings.TrimSpace(cmd.InstallationID)
		if installationID != "" {
			if err := store.LockMobilePushInstallation(tx, installationID); err != nil {
				return err
			}
		}
		var session store.UserSession
		result := tx.Where("token_hash = ?", auth.HashSessionToken(token)).Limit(1).Find(&session)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		found = true
		if installationID != "" {
			if err := tx.Where("session_id = ? AND installation_id = ?", session.ID, installationID).
				Delete(&store.UserPushGrant{}).Error; err != nil {
				return err
			}
		}
		return tx.Delete(&session).Error
	})
	if err != nil {
		return internalError(err)
	}
	if cmd.RequireExisting && !found {
		return unauthorized()
	}
	return nil
}

func (s *Service) AuthenticateSession(ctx context.Context, token string) (AuthenticatedSession, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return AuthenticatedSession{}, unauthorized()
	}

	var session struct {
		ID               string
		UserID           string
		ProfileUpdatedAt time.Time
		AllowNickname    bool
	}
	// Always check revocation, expiry and account status in the database.
	// Only the full profile is cached, with its database version checked here.
	err := s.db.WithContext(ctx).Table("user_sessions AS sessions").
		Select("sessions.id, sessions.user_id, users.updated_at AS profile_updated_at, COALESCE(nickname_policy.allow_user_nickname_editing, TRUE) AS allow_nickname").
		Joins("JOIN users ON users.id = sessions.user_id").
		Joins("LEFT JOIN app_settings nickname_policy ON nickname_policy.id = ?", store.AppSettingsID).
		Where("sessions.token_hash = ? AND sessions.expires_at > ? AND users.status = ?",
			auth.HashSessionToken(token), s.now().UTC(), store.UserStatusActive).
		Take(&session).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return AuthenticatedSession{}, unauthorized()
	}
	if err != nil {
		return AuthenticatedSession{}, internalError(err)
	}
	profile, err := s.getProfile(ctx, session.UserID, &session.ProfileUpdatedAt)
	if ErrorCodeOf(err) == CodeNotFound {
		return AuthenticatedSession{}, unauthorized()
	}
	if err != nil {
		return AuthenticatedSession{}, err
	}
	if profile.Status != store.UserStatusActive {
		return AuthenticatedSession{}, unauthorized()
	}

	s.recordSessionActivity(session.ID, s.now().UTC())
	return AuthenticatedSession{ID: session.ID, Account: applyProfileNicknamePolicy(profile, session.AllowNickname)}, nil
}

func (s *Service) GetProfile(ctx context.Context, accountID string) (Account, error) {
	profile, err := s.getProfile(ctx, strings.TrimSpace(accountID), nil)
	if err != nil {
		return Account{}, err
	}
	allowNickname, err := s.profileNicknameAllowed(ctx)
	if err != nil {
		return Account{}, err
	}
	return applyProfileNicknamePolicy(profile, allowNickname), nil
}

func (s *Service) UpdateProfile(ctx context.Context, cmd UpdateProfileCommand) (Account, error) {
	updates := map[string]any{}
	if cmd.Avatar != nil {
		avatar, err := normalizeBuiltinAvatar(*cmd.Avatar)
		if err != nil {
			return Account{}, newError(CodeInvalidRequest, "头像格式错误", err)
		}
		updates["avatar"] = avatar
	}
	if cmd.Nickname != nil {
		updates["nickname"] = strings.TrimSpace(*cmd.Nickname)
	}
	if len(updates) == 0 {
		return Account{}, newError(CodeInvalidRequest, "至少需要修改一个字段", nil)
	}

	updateProfile := func(db *gorm.DB) error {
		return db.Model(&store.User{}).
			Where("id = ?", strings.TrimSpace(cmd.AccountID)).
			Updates(updates).Error
	}
	var err error
	if cmd.Nickname != nil && s.userNicknamePolicy != nil {
		err = s.userNicknamePolicy.WithUserNicknameEditingPolicy(ctx, func(tx *gorm.DB, allowed bool) error {
			if !allowed {
				return newError(CodeNicknameDisabled, "当前服务器禁止修改昵称", nil)
			}
			return updateProfile(tx)
		})
	} else {
		err = updateProfile(s.db.WithContext(ctx))
	}
	if err != nil {
		var accountErr *Error
		if errors.As(err, &accountErr) {
			return Account{}, err
		}
		return Account{}, internalError(err)
	}
	s.InvalidateProfile(cmd.AccountID)
	profile, err := s.GetProfile(ctx, cmd.AccountID)
	if err == nil && s.profileNotifications != nil {
		s.profileNotifications.PublishUserProfileUpdated(ctx, profile.ID, profile.UpdatedAt)
	}
	return profile, err
}

func (s *Service) UploadAvatar(ctx context.Context, cmd UploadAvatarCommand) (Account, error) {
	if cmd.Size > maxAvatarBytes {
		return Account{}, newError(CodeRequestTooLarge, "头像文件不能超过 1MiB", nil)
	}
	if cmd.Size == 0 || cmd.Content == nil {
		return Account{}, newError(CodeInvalidRequest, "头像文件不能为空", nil)
	}

	content, err := io.ReadAll(io.LimitReader(cmd.Content, maxAvatarBytes+1))
	if err != nil {
		return Account{}, newError(CodeInvalidRequest, "读取头像失败", err)
	}
	if len(content) > maxAvatarBytes {
		return Account{}, newError(CodeRequestTooLarge, "头像文件不能超过 1MiB", nil)
	}
	if len(content) == 0 {
		return Account{}, newError(CodeInvalidRequest, "头像文件不能为空", nil)
	}
	width, height, err := media.WebPDimensions(content)
	if err != nil || width != avatarSize || height != avatarSize {
		return Account{}, newError(CodeInvalidRequest, "头像必须是 256x256 的 WebP 图片", err)
	}
	if s.files == nil {
		return Account{}, wrapInternal("头像存储未配置", nil)
	}

	accountID := strings.TrimSpace(cmd.AccountID)
	objectKey := fmt.Sprintf("avatars/users/%s/%s.webp", accountID, uuid.NewString())
	uploaded, err := s.files.UploadPublic(ctx, fileapp.UploadPublicCommand{
		ObjectKey:   objectKey,
		Content:     bytes.NewReader(content),
		ContentType: avatarContentType,
		SizeBytes:   int64(len(content)),
	})
	if err != nil {
		if fileapp.ErrorCodeOf(err) == fileapp.CodeStorageUnavailable {
			return Account{}, wrapInternal("头像存储未配置", err)
		}
		return Account{}, wrapInternal("上传头像失败", err)
	}
	avatarURL := uploaded.URL
	if strings.TrimSpace(avatarURL) == "" {
		return Account{}, wrapInternal("头像存储未配置", nil)
	}
	if err := s.db.WithContext(ctx).Model(&store.User{}).
		Where("id = ?", accountID).
		Update("avatar", avatarURL).Error; err != nil {
		return Account{}, wrapInternal("保存头像失败", err)
	}
	s.InvalidateProfile(accountID)
	profile, err := s.GetProfile(ctx, accountID)
	if err == nil && s.profileNotifications != nil {
		s.profileNotifications.PublishUserProfileUpdated(ctx, profile.ID, profile.UpdatedAt)
	}
	return profile, err
}

func newAccount(user store.User) Account {
	phone := ""
	if user.Phone != nil {
		phone = *user.Phone
	}
	avatar := user.Avatar
	if avatar == "" {
		avatar = store.DefaultUserAvatar
	}
	return Account{
		ID:           user.ID,
		Avatar:       avatar,
		Email:        user.Email,
		LastOnlineAt: user.LastOnlineAt,
		Name:         user.Name,
		Nickname:     user.Nickname,
		Phone:        phone,
		Status:       user.Status,
		CreatedAt:    user.CreatedAt,
		UpdatedAt:    user.UpdatedAt,
	}
}

func normalizeEmail(raw string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email {
		return "", errors.New("invalid email")
	}
	return email, nil
}

func normalizeBuiltinAvatar(raw string) (string, error) {
	avatar := strings.TrimSpace(raw)
	const prefix = "/assets/avatars/builtin/"
	const suffix = ".webp"
	if !strings.HasPrefix(avatar, prefix) || !strings.HasSuffix(avatar, suffix) {
		return "", errors.New("invalid avatar")
	}

	id := strings.TrimSuffix(strings.TrimPrefix(avatar, prefix), suffix)
	if len(id) != 2 {
		return "", errors.New("invalid avatar")
	}
	index, err := strconv.Atoi(id)
	if err != nil || index < 1 || index > 64 || fmt.Sprintf("%02d", index) != id {
		return "", errors.New("invalid avatar")
	}
	return avatar, nil
}

func invalidCredentials() error {
	return newError(CodeInvalidCredentials, "邮箱或密码错误", nil)
}

func unauthorized() error {
	return newError(CodeUnauthorized, "未登录", nil)
}

var _ ClientService = (*Service)(nil)
var _ SessionAuthenticator = (*Service)(nil)
var _ ActivityRecorder = (*Service)(nil)
var _ VerifiedEmailLoginService = (*Service)(nil)
