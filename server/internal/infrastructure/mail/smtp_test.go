package mail

import (
	"io"
	"mime/quotedprintable"
	"net/smtp"
	"strings"
	"testing"
	"time"

	"app/internal/application/emailauth"
	settingsapp "app/internal/application/settings"
)

func TestRenderLoginCodeMessageIncludesBrandedHTMLAndPlainFallback(t *testing.T) {
	content, err := renderLoginCodeMessage(emailauth.Mail{
		SMTP: settingsapp.EmailLoginSettings{
			FromEmail: "mailer@example.com", FromName: "即应通知",
		},
		Recipient: "alice@example.com", AppName: "即应", OrganizationName: "长亭科技",
		Code: "01234567", ExpiresIn: 15 * time.Minute,
		ClientLoginURL: "https://chat.example.com/login", LogoURL: "https://chat.example.com/favicon.png",
	})
	if err != nil {
		t.Fatalf("render message: %v", err)
	}
	message := string(content)
	for _, expected := range []string{
		"Content-Type: multipart/alternative",
		"text/plain; charset=UTF-8",
		"text/html; charset=UTF-8",
		"01234567",
		"https://chat.example.com/login",
		"https://chat.example.com/favicon.png",
		"#14b8a6",
	} {
		if !strings.Contains(message, expected) {
			t.Fatalf("message missing %q:\n%s", expected, message)
		}
	}
	if strings.Contains(message, "smtp-password") || strings.Contains(message, "code=01234567") {
		t.Fatalf("message leaked secret into content or URL: %s", message)
	}
}

func TestRenderTestEmailMessageIncludesBrandedHTMLAndAccessURL(t *testing.T) {
	content, err := renderTestEmailMessage(emailauth.Mail{
		SMTP: settingsapp.EmailLoginSettings{
			FromEmail: "mailer@example.com", FromName: "即应通知",
		},
		Recipient: "admin@example.com", AppName: "即应", OrganizationName: "长亭科技",
		ClientLoginURL: "https://chat.example.com/login", LogoURL: "https://chat.example.com/favicon.png",
	})
	if err != nil {
		t.Fatalf("render test message: %v", err)
	}
	message := string(content)
	decodedBody, err := io.ReadAll(quotedprintable.NewReader(strings.NewReader(message)))
	if err != nil {
		t.Fatalf("decode test message: %v", err)
	}
	decodedMessage := string(decodedBody)
	for _, expected := range []string{
		"Content-Type: multipart/alternative",
		"SMTP 配置测试",
		"https://chat.example.com/login",
		"https://chat.example.com/favicon.png",
		"#14b8a6",
	} {
		if !strings.Contains(decodedMessage, expected) {
			t.Fatalf("test message missing %q:\n%s", expected, message)
		}
	}
}

func TestNewSMTPAuthPrefersPlainWhenAvailable(t *testing.T) {
	settings := settingsapp.EmailLoginSettings{SMTPUsername: "mailer", SMTPPassword: "smtp-secret"}
	auth, err := newSMTPAuth("LOGIN PLAIN", settings, "smtp.example.com")
	if err != nil {
		t.Fatalf("select auth: %v", err)
	}
	mechanism, initial, err := auth.Start(&smtp.ServerInfo{Name: "smtp.example.com", TLS: true})
	if err != nil {
		t.Fatalf("start auth: %v", err)
	}
	if mechanism != "PLAIN" || string(initial) != "\x00mailer\x00smtp-secret" {
		t.Fatalf("auth start = %q, %q", mechanism, initial)
	}
}

func TestNewSMTPAuthSupportsLogin(t *testing.T) {
	settings := settingsapp.EmailLoginSettings{SMTPUsername: "mailer", SMTPPassword: "smtp-secret"}
	auth, err := newSMTPAuth("login", settings, "smtp.example.com")
	if err != nil {
		t.Fatalf("select auth: %v", err)
	}
	mechanism, initial, err := auth.Start(&smtp.ServerInfo{Name: "smtp.example.com", TLS: true})
	if err != nil {
		t.Fatalf("start auth: %v", err)
	}
	if mechanism != "LOGIN" || initial != nil {
		t.Fatalf("auth start = %q, %q", mechanism, initial)
	}
	username, err := auth.Next([]byte("Username:"), true)
	if err != nil || string(username) != "mailer" {
		t.Fatalf("username response = %q, error = %v", username, err)
	}
	password, err := auth.Next([]byte("Password:"), true)
	if err != nil || string(password) != "smtp-secret" {
		t.Fatalf("password response = %q, error = %v", password, err)
	}
}

func TestNewSMTPAuthRejectsUnsupportedMechanisms(t *testing.T) {
	_, err := newSMTPAuth("CRAM-MD5", settingsapp.EmailLoginSettings{
		SMTPUsername: "mailer", SMTPPassword: "smtp-secret",
	}, "smtp.example.com")
	if err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("unsupported auth error = %v", err)
	}
}
