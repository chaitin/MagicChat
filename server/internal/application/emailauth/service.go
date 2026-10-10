package emailauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"hash/fnv"
	"log/slog"
	"math/big"
	"net/mail"
	"strings"
	"sync"
	"time"

	"app/internal/application/account"
)

type Dependencies struct {
	Accounts     account.VerifiedEmailLoginService
	Settings     SettingsProvider
	Mailer       Mailer
	ClientOrigin string
	Now          func() time.Time
	GenerateCode func() (string, error)
	Dispatcher   Dispatcher
}

type Service struct {
	accounts     account.VerifiedEmailLoginService
	settings     SettingsProvider
	mailer       Mailer
	clientOrigin string
	now          func() time.Time
	generateCode func() (string, error)
	dispatcher   Dispatcher
	mu           sync.Mutex
	codes        map[string]codeEntry
	cooldowns    map[string]time.Time
	lastCleanup  time.Time
}

type codeEntry struct {
	hash        [32]byte
	expiresAt   time.Time
	failedCount int
	consuming   bool
}

func NewService(deps Dependencies) *Service {
	now := deps.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	generateCode := deps.GenerateCode
	if generateCode == nil {
		generateCode = generateNumericCode
	}
	dispatcher := deps.Dispatcher
	if dispatcher == nil {
		dispatcher = newShardedDispatcher(16, 64)
	}
	return &Service{
		accounts: deps.Accounts, settings: deps.Settings, mailer: deps.Mailer, dispatcher: dispatcher,
		clientOrigin: strings.TrimRight(strings.TrimSpace(deps.ClientOrigin), "/"),
		now:          now, generateCode: generateCode,
		codes: make(map[string]codeEntry), cooldowns: make(map[string]time.Time),
	}
}

func (s *Service) RequestCode(ctx context.Context, cmd RequestCodeCommand) (RequestCodeResult, error) {
	email, err := normalizeEmail(cmd.Email)
	if err != nil {
		return RequestCodeResult{}, newError(CodeInvalidRequest, "邮箱格式错误", err)
	}
	smtpSettings, err := s.settings.GetEmailLogin(ctx)
	if err != nil {
		return RequestCodeResult{}, newError(CodeInternal, "服务端错误", err)
	}
	if !smtpSettings.Enabled {
		return RequestCodeResult{}, newError(CodeUnavailable, "邮箱验证码登录未启用", nil)
	}

	now := s.now().UTC()
	if err := s.reserveSend(email, strings.TrimSpace(cmd.IP), now); err != nil {
		return RequestCodeResult{}, err
	}
	result := RequestCodeResult{ExpiresInSeconds: int(CodeTTL.Seconds()), RetryAfterSeconds: int(SendCooldown.Seconds())}
	if !s.dispatcher.Dispatch(email, func() { s.deliverCode(email) }) {
		return RequestCodeResult{}, newError(CodeUnavailable, "验证码服务繁忙，请稍后重试", nil)
	}
	return result, nil
}

func (s *Service) deliverCode(email string) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	recipientHash := hashRecipient(email)

	settings, err := s.settings.GetEmailLogin(ctx)
	if err != nil {
		slog.Error("deliver email login code", "stage", "settings", "recipient_hash", recipientHash, "error", err)
		return
	}
	allowed, err := s.accounts.CanLoginWithEmail(ctx, email, settings.RegistrationEnabled)
	if err != nil {
		slog.Error("deliver email login code", "stage", "account_lookup", "recipient_hash", recipientHash, "error", err)
		return
	}
	if !allowed {
		return
	}
	smtpSettings, err := s.settings.GetEmailLogin(ctx)
	if err != nil {
		slog.Error("deliver email login code", "stage", "load_smtp_settings", "recipient_hash", recipientHash, "error", err)
		return
	}
	if !smtpSettings.Enabled {
		return
	}
	code, err := s.generateCode()
	if err != nil {
		slog.Error("deliver email login code", "stage", "generate_code", "recipient_hash", recipientHash, "error", err)
		return
	}
	brand, err := s.settings.Get(ctx)
	if err != nil {
		slog.Error("deliver email login code", "stage", "load_brand_settings", "recipient_hash", recipientHash, "error", err)
		return
	}
	loginURL := s.clientOrigin + "/login"
	if err := s.mailer.SendLoginCode(ctx, Mail{
		SMTP: smtpSettings, Recipient: email, AppName: brand.AppName,
		OrganizationName: brand.OrganizationName, Code: code, ExpiresIn: CodeTTL,
		ClientLoginURL: loginURL, LogoURL: s.clientOrigin + "/logo.png",
	}); err != nil {
		slog.Error("deliver email login code", "stage", "smtp_send", "recipient_hash", recipientHash,
			"smtp_host", smtpSettings.SMTPHost, "smtp_port", smtpSettings.SMTPPort, "error", err)
		return
	}

	s.mu.Lock()
	s.codes[email] = codeEntry{hash: sha256.Sum256([]byte(code)), expiresAt: s.now().UTC().Add(CodeTTL)}
	s.mu.Unlock()
}

func (s *Service) TestSMTP(ctx context.Context, rawRecipient string) error {
	recipient, err := normalizeEmail(rawRecipient)
	if err != nil {
		return newError(CodeInvalidRequest, "测试收件邮箱格式错误", err)
	}
	smtpSettings, err := s.settings.GetEmailLogin(ctx)
	if err != nil {
		return newError(CodeInternal, "服务端错误", err)
	}
	brand, err := s.settings.Get(ctx)
	if err != nil {
		return newError(CodeInternal, "服务端错误", err)
	}
	message := Mail{
		SMTP: smtpSettings, Recipient: recipient, AppName: brand.AppName,
		OrganizationName: brand.OrganizationName,
		ClientLoginURL:   s.clientOrigin + "/login", LogoURL: s.clientOrigin + "/logo.png",
	}
	if err := s.mailer.SendTestEmail(ctx, message); err != nil {
		slog.Error("test email login SMTP", "smtp_host", smtpSettings.SMTPHost,
			"smtp_port", smtpSettings.SMTPPort, "recipient_hash", hashRecipient(recipient), "error", err)
		return newError(CodeUnavailable, "SMTP 测试失败："+err.Error(), err)
	}
	return nil
}

func (s *Service) BeginNativeSession(ctx context.Context, accessToken string) (account.NativeSessionCredential, error) {
	native, ok := s.accounts.(account.NativeSessionService)
	if !ok {
		return account.NativeSessionCredential{}, newError(CodeUnavailable, "原生会话不可用", nil)
	}
	return native.BeginNativeSession(ctx, accessToken)
}

func (s *Service) Login(ctx context.Context, cmd LoginCommand) (account.LoginResult, error) {
	email, err := normalizeEmail(cmd.Email)
	if err != nil || len(cmd.Code) != CodeLength || strings.Trim(cmd.Code, "0123456789") != "" {
		return account.LoginResult{}, newError(CodeInvalidRequest, "邮箱或验证码格式错误", err)
	}
	settings, err := s.settings.GetEmailLogin(ctx)
	if err != nil {
		return account.LoginResult{}, newError(CodeInternal, "服务端错误", err)
	}
	if !settings.Enabled {
		return account.LoginResult{}, newError(CodeUnavailable, "邮箱验证码登录未启用", nil)
	}

	hash := sha256.Sum256([]byte(cmd.Code))
	if err := s.reserveCode(email, hash, s.now().UTC()); err != nil {
		return account.LoginResult{}, err
	}
	result, err := s.accounts.LoginWithVerifiedEmail(ctx, account.VerifiedEmailLoginCommand{
		Email: email, UserAgent: cmd.UserAgent, IP: cmd.IP, AllowRegistration: settings.RegistrationEnabled,
	})
	if err != nil {
		s.releaseCode(email, hash, account.ErrorCodeOf(err) == account.CodeInternal)
		if account.ErrorCodeOf(err) == account.CodeInternal {
			return account.LoginResult{}, newError(CodeInternal, "服务端错误", err)
		}
		return account.LoginResult{}, invalidCode()
	}
	s.consumeCode(email, hash)
	return result, nil
}

func (s *Service) reserveSend(email string, ip string, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupIfDue(now)
	key := ip + "\x00" + email
	if next, ok := s.cooldowns[key]; ok && next.After(now) {
		return rateLimited(max(1, int(next.Sub(now).Seconds()+0.999)))
	}
	s.cooldowns[key] = now.Add(SendCooldown)
	return nil
}

func (s *Service) cleanupIfDue(now time.Time) {
	if !s.lastCleanup.IsZero() && now.Sub(s.lastCleanup) < CleanupInterval {
		return
	}
	s.cleanup(now)
	s.lastCleanup = now
}

func (s *Service) reserveCode(email string, hash [32]byte, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.codes[email]
	if !ok || !entry.expiresAt.After(now) {
		delete(s.codes, email)
		return invalidCode()
	}
	if entry.consuming {
		return invalidCode()
	}
	if subtle.ConstantTimeCompare(entry.hash[:], hash[:]) != 1 {
		entry.failedCount++
		if entry.failedCount >= MaxFailedAttempts {
			delete(s.codes, email)
		} else {
			s.codes[email] = entry
		}
		return invalidCode()
	}
	entry.consuming = true
	s.codes[email] = entry
	return nil
}

func (s *Service) consumeCode(email string, hash [32]byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry, ok := s.codes[email]; ok && subtle.ConstantTimeCompare(entry.hash[:], hash[:]) == 1 {
		delete(s.codes, email)
	}
}

func (s *Service) releaseCode(email string, hash [32]byte, reusable bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.codes[email]
	if !ok || subtle.ConstantTimeCompare(entry.hash[:], hash[:]) != 1 {
		return
	}
	if !reusable {
		delete(s.codes, email)
		return
	}
	entry.consuming = false
	s.codes[email] = entry
}

func (s *Service) cleanup(now time.Time) {
	for email, entry := range s.codes {
		if !entry.expiresAt.After(now) {
			delete(s.codes, email)
		}
	}
	for email, next := range s.cooldowns {
		if !next.After(now) {
			delete(s.cooldowns, email)
		}
	}
}

type shardedDispatcher struct {
	queues []chan func()
}

func newShardedDispatcher(shards int, queueSize int) *shardedDispatcher {
	dispatcher := &shardedDispatcher{queues: make([]chan func(), shards)}
	for index := range dispatcher.queues {
		queue := make(chan func(), queueSize)
		dispatcher.queues[index] = queue
		go func() {
			for task := range queue {
				task()
			}
		}()
	}
	return dispatcher
}

func (d *shardedDispatcher) Dispatch(key string, task func()) bool {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(key))
	queue := d.queues[int(hash.Sum32())%len(d.queues)]
	select {
	case queue <- task:
		return true
	default:
		return false
	}
}

func hashRecipient(email string) string {
	sum := sha256.Sum256([]byte(email))
	return fmt.Sprintf("%x", sum[:6])
}

func normalizeEmail(raw string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email {
		return "", errors.New("invalid email")
	}
	return email, nil
}

func generateNumericCode() (string, error) {
	limit := big.NewInt(100000000)
	value, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return "", fmt.Errorf("generate verification code: %w", err)
	}
	return fmt.Sprintf("%08d", value.Int64()), nil
}

func invalidCode() error {
	return newError(CodeInvalidCode, "验证码错误或已失效", nil)
}

var _ ServiceAPI = (*Service)(nil)
var _ SMTPTester = (*Service)(nil)
