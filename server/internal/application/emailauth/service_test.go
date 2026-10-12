package emailauth

import (
	"context"
	"errors"
	"testing"
	"time"

	"app/internal/application/account"
	settingsapp "app/internal/application/settings"
)

func TestServiceRequestsAndConsumesOneTimeCode(t *testing.T) {
	now := time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC)
	accounts := &fakeAccounts{allowed: true, result: account.LoginResult{
		Account: account.Account{ID: "user-1", Email: "alice@example.com", Name: "Alice"},
		Session: account.SessionCredential{Token: "session-token", ExpiresAt: now.Add(time.Hour)},
	}}
	mailer := &fakeMailer{}
	service := newEmailAuthTestService(&now, accounts, mailer)

	requested, err := service.RequestCode(context.Background(), RequestCodeCommand{
		Email: " Alice@Example.com ", IP: "127.0.0.1",
	})
	if err != nil {
		t.Fatalf("request code: %v", err)
	}
	if requested.ExpiresInSeconds != 900 || requested.RetryAfterSeconds != 5 {
		t.Fatalf("request result = %#v", requested)
	}
	if accounts.checkedEmail != "alice@example.com" || len(mailer.messages) != 1 {
		t.Fatalf("checked email = %q, messages = %#v", accounts.checkedEmail, mailer.messages)
	}
	message := mailer.messages[0]
	if message.Code != "01234567" || message.ClientLoginURL != "https://chat.example.com/login" || message.LogoURL != "https://chat.example.com/favicon.png" {
		t.Fatalf("mail = %#v", message)
	}

	if _, err := service.RequestCode(context.Background(), RequestCodeCommand{Email: "alice@example.com", IP: "127.0.0.1"}); ErrorCodeOf(err) != CodeTooManyRequests || RetryAfterOf(err) != 5 {
		t.Fatalf("cooldown error = %v, code = %q, retry = %d", err, ErrorCodeOf(err), RetryAfterOf(err))
	}
	loggedIn, err := service.Login(context.Background(), LoginCommand{
		Email: "alice@example.com", Code: "01234567", UserAgent: "test", IP: "127.0.0.1",
	})
	if err != nil || loggedIn.Session.Token != "session-token" {
		t.Fatalf("login = %#v, error = %v", loggedIn, err)
	}
	if accounts.loginCommand.Email != "alice@example.com" || accounts.loginCommand.UserAgent != "test" {
		t.Fatalf("login command = %#v", accounts.loginCommand)
	}
	if _, err := service.Login(context.Background(), LoginCommand{Email: "alice@example.com", Code: "01234567"}); ErrorCodeOf(err) != CodeInvalidCode {
		t.Fatalf("reused code error = %v, code = %q", err, ErrorCodeOf(err))
	}
}

func TestServiceSendsCodeForUnknownAccountWhenRegistrationIsAllowed(t *testing.T) {
	now := time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC)
	accounts := &fakeAccounts{allowed: true}
	mailer := &fakeMailer{}
	service := newEmailAuthTestService(&now, accounts, mailer)

	result, err := service.RequestCode(context.Background(), RequestCodeCommand{Email: "missing@example.com"})
	if err != nil || result.ExpiresInSeconds != 900 {
		t.Fatalf("request missing account = %#v, error = %v", result, err)
	}
	if len(mailer.messages) != 1 || mailer.messages[0].Recipient != "missing@example.com" {
		t.Fatalf("messages = %#v", mailer.messages)
	}
}

func TestServiceDefersAccountLookupAndDeliveryUntilAfterResponseWork(t *testing.T) {
	now := time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC)
	accounts := &fakeAccounts{allowed: true}
	mailer := &fakeMailer{}
	service := newEmailAuthTestService(&now, accounts, mailer)
	var queuedTask func()
	service.dispatcher = DispatchFunc(func(_ string, task func()) bool {
		queuedTask = task
		return true
	})

	result, err := service.RequestCode(context.Background(), RequestCodeCommand{
		Email: "alice@example.com", IP: "127.0.0.1",
	})
	if err != nil || result.RetryAfterSeconds != 5 {
		t.Fatalf("request code = %#v, error = %v", result, err)
	}
	if queuedTask == nil {
		t.Fatal("delivery task was not queued")
	}
	if accounts.checkedEmail != "" || len(mailer.messages) != 0 {
		t.Fatalf("account lookup or SMTP ran inline: email = %q, messages = %#v", accounts.checkedEmail, mailer.messages)
	}

	queuedTask()
	if accounts.checkedEmail != "alice@example.com" || len(mailer.messages) != 1 {
		t.Fatalf("queued delivery: email = %q, messages = %#v", accounts.checkedEmail, mailer.messages)
	}
}

func TestServiceDoesNotExposeSMTPDeliveryFailure(t *testing.T) {
	now := time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC)
	mailer := &fakeMailer{err: errors.New("SMTP unavailable")}
	service := newEmailAuthTestService(&now, &fakeAccounts{allowed: true}, mailer)

	result, err := service.RequestCode(context.Background(), RequestCodeCommand{
		Email: "alice@example.com", IP: "127.0.0.1",
	})
	if err != nil || result.ExpiresInSeconds != 900 || result.RetryAfterSeconds != 5 {
		t.Fatalf("request with SMTP failure = %#v, error = %v", result, err)
	}
	if len(mailer.messages) != 1 {
		t.Fatalf("messages = %#v", mailer.messages)
	}
	if _, err := service.Login(context.Background(), LoginCommand{Email: "alice@example.com", Code: "01234567"}); ErrorCodeOf(err) != CodeInvalidCode {
		t.Fatalf("login after SMTP failure error = %v, code = %q", err, ErrorCodeOf(err))
	}
}

func TestServiceSendsSMTPTestEmail(t *testing.T) {
	now := time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC)
	mailer := &fakeMailer{}
	service := newEmailAuthTestService(&now, &fakeAccounts{}, mailer)

	if err := service.TestSMTP(context.Background(), " Admin@Example.com "); err != nil {
		t.Fatalf("test SMTP: %v", err)
	}
	if len(mailer.testMessages) != 1 {
		t.Fatalf("test messages = %#v", mailer.testMessages)
	}
	message := mailer.testMessages[0]
	if message.Recipient != "admin@example.com" || message.ClientLoginURL != "https://chat.example.com/login" || message.LogoURL != "https://chat.example.com/favicon.png" {
		t.Fatalf("test message = %#v", message)
	}

	mailer.err = errors.New("connection refused")
	if err := service.TestSMTP(context.Background(), "admin@example.com"); ErrorCodeOf(err) != CodeUnavailable {
		t.Fatalf("SMTP failure = %v, code = %q", err, ErrorCodeOf(err))
	}
}

func TestServiceLimitsRequestsByIPAndEmailForFiveSeconds(t *testing.T) {
	now := time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC)
	service := newEmailAuthTestService(&now, &fakeAccounts{allowed: false}, &fakeMailer{})
	if _, err := service.RequestCode(context.Background(), RequestCodeCommand{Email: "alice@example.com", IP: "127.0.0.1"}); err != nil {
		t.Fatalf("first request: %v", err)
	}
	if _, err := service.RequestCode(context.Background(), RequestCodeCommand{Email: "alice@example.com", IP: "127.0.0.1"}); ErrorCodeOf(err) != CodeTooManyRequests || RetryAfterOf(err) != 5 {
		t.Fatalf("rate-limit error = %v, code = %q", err, ErrorCodeOf(err))
	}
	if _, err := service.RequestCode(context.Background(), RequestCodeCommand{Email: "alice@example.com", IP: "127.0.0.2"}); err != nil {
		t.Fatalf("same email from another IP: %v", err)
	}
	if _, err := service.RequestCode(context.Background(), RequestCodeCommand{Email: "bob@example.com", IP: "127.0.0.1"}); err != nil {
		t.Fatalf("another email from same IP: %v", err)
	}
	now = now.Add(SendCooldown)
	if _, err := service.RequestCode(context.Background(), RequestCodeCommand{Email: "alice@example.com", IP: "127.0.0.1"}); err != nil {
		t.Fatalf("request after cooldown: %v", err)
	}
}

func TestServiceExpiresCodeAndInvalidatesAfterFailedAttempts(t *testing.T) {
	now := time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC)
	accounts := &fakeAccounts{allowed: true}
	service := newEmailAuthTestService(&now, accounts, &fakeMailer{})
	if _, err := service.RequestCode(context.Background(), RequestCodeCommand{Email: "alice@example.com"}); err != nil {
		t.Fatalf("request code: %v", err)
	}
	for attempt := 0; attempt < MaxFailedAttempts; attempt++ {
		if _, err := service.Login(context.Background(), LoginCommand{Email: "alice@example.com", Code: "99999999"}); ErrorCodeOf(err) != CodeInvalidCode {
			t.Fatalf("attempt %d error = %v", attempt+1, err)
		}
	}
	if _, err := service.Login(context.Background(), LoginCommand{Email: "alice@example.com", Code: "01234567"}); ErrorCodeOf(err) != CodeInvalidCode {
		t.Fatalf("correct code after failures error = %v", err)
	}

	now = now.Add(SendCooldown)
	if _, err := service.RequestCode(context.Background(), RequestCodeCommand{Email: "alice@example.com"}); err != nil {
		t.Fatalf("request replacement code: %v", err)
	}
	now = now.Add(CodeTTL)
	if _, err := service.Login(context.Background(), LoginCommand{Email: "alice@example.com", Code: "01234567"}); ErrorCodeOf(err) != CodeInvalidCode {
		t.Fatalf("expired code error = %v", err)
	}
}

func TestServiceReleasesReservedCodeAfterInternalAccountFailure(t *testing.T) {
	now := time.Date(2026, 7, 16, 8, 0, 0, 0, time.UTC)
	accounts := &fakeAccounts{allowed: true, loginErr: errors.New("database unavailable")}
	service := newEmailAuthTestService(&now, accounts, &fakeMailer{})
	if _, err := service.RequestCode(context.Background(), RequestCodeCommand{Email: "alice@example.com"}); err != nil {
		t.Fatalf("request code: %v", err)
	}
	if _, err := service.Login(context.Background(), LoginCommand{Email: "alice@example.com", Code: "01234567"}); ErrorCodeOf(err) != CodeInternal {
		t.Fatalf("first login error = %v", err)
	}
	accounts.loginErr = nil
	accounts.result = account.LoginResult{Session: account.SessionCredential{Token: "retry-token"}}
	if result, err := service.Login(context.Background(), LoginCommand{Email: "alice@example.com", Code: "01234567"}); err != nil || result.Session.Token != "retry-token" {
		t.Fatalf("retry login = %#v, error = %v", result, err)
	}
}

func newEmailAuthTestService(now *time.Time, accounts *fakeAccounts, mailer *fakeMailer) *Service {
	return NewService(Dependencies{
		Accounts: accounts,
		Settings: &fakeSettings{
			brand: settingsapp.Settings{AppName: "即应", OrganizationName: "长亭科技"},
			email: settingsapp.EmailLoginSettings{
				Enabled: true, SMTPHost: "smtp.example.com", SMTPPort: 587,
				SMTPSecurity: settingsapp.SMTPSecuritySTARTTLS,
				FromEmail:    "mailer@example.com", FromName: "即应",
			},
		},
		Mailer: mailer, ClientOrigin: "https://chat.example.com/",
		Now: func() time.Time { return *now }, GenerateCode: func() (string, error) { return "01234567", nil },
		Dispatcher: DispatchFunc(func(_ string, task func()) bool {
			task()
			return true
		}),
	})
}

type fakeAccounts struct {
	allowed      bool
	checkedEmail string
	loginCommand account.VerifiedEmailLoginCommand
	result       account.LoginResult
	loginErr     error
}

func (a *fakeAccounts) CanLoginWithEmail(_ context.Context, email string, _ bool) (bool, error) {
	a.checkedEmail = email
	return a.allowed, nil
}

func (a *fakeAccounts) LoginWithVerifiedEmail(_ context.Context, cmd account.VerifiedEmailLoginCommand) (account.LoginResult, error) {
	a.loginCommand = cmd
	return a.result, a.loginErr
}

type fakeSettings struct {
	brand settingsapp.Settings
	email settingsapp.EmailLoginSettings
}

func (s *fakeSettings) Get(context.Context) (settingsapp.Settings, error) {
	return s.brand, nil
}

func (s *fakeSettings) GetEmailLogin(context.Context) (settingsapp.EmailLoginSettings, error) {
	return s.email, nil
}

type fakeMailer struct {
	messages     []Mail
	testMessages []Mail
	err          error
}

func (m *fakeMailer) SendLoginCode(_ context.Context, message Mail) error {
	m.messages = append(m.messages, message)
	return m.err
}

func (m *fakeMailer) SendTestEmail(_ context.Context, message Mail) error {
	m.testMessages = append(m.testMessages, message)
	return m.err
}
