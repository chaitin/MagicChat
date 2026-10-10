package account

import (
	"context"
	"testing"
	"time"

	"app/internal/auth"
	"app/internal/store"
)

func TestNativeSessionRotationAndReplayRevocation(t *testing.T) {
	db := openAccountTestDB(t)
	now := time.Date(2026, 10, 9, 0, 0, 0, 0, time.UTC)
	insertAccountTestUser(t, db, "native@example.test", "password", now)
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	ctx := context.Background()
	login, err := service.Login(ctx, LoginCommand{Email: "native@example.test", Password: "password"})
	if err != nil {
		t.Fatal(err)
	}
	credential, err := service.BeginNativeSession(ctx, login.Session.Token)
	if err != nil {
		t.Fatal(err)
	}
	if !credential.ExpiresAt.Equal(now.Add(time.Hour)) || !credential.RefreshExpiresAt.Equal(now.Add(90*24*time.Hour)) {
		t.Fatalf("native expiry: %+v", credential)
	}
	if _, err := service.BeginNativeSession(ctx, login.Session.Token); ErrorCodeOf(err) != CodeUnauthorized {
		t.Fatalf("double issue: %v", err)
	}
	now = now.Add(50 * time.Minute)
	next, err := service.RefreshNativeSession(ctx, credential.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if next.Token == credential.Token || next.RefreshToken == credential.RefreshToken {
		t.Fatal("refresh tokens were not rotated")
	}
	if _, err := service.AuthenticateSession(ctx, credential.Token); ErrorCodeOf(err) != CodeUnauthorized {
		t.Fatalf("old access token: %v", err)
	}
	if _, err := service.RefreshNativeSession(ctx, credential.RefreshToken); ErrorCodeOf(err) != CodeUnauthorized {
		t.Fatalf("replay: %v", err)
	}
	if _, err := service.AuthenticateSession(ctx, next.Token); ErrorCodeOf(err) != CodeUnauthorized {
		t.Fatalf("replay did not revoke device: %v", err)
	}
	var sessions int64
	if err := db.Model(&store.UserSession{}).Count(&sessions).Error; err != nil || sessions != 0 {
		t.Fatalf("sessions after replay = %d, %v", sessions, err)
	}
}

func TestOAuthExchangeIsOneTimeAndRefreshHasAbsoluteLimit(t *testing.T) {
	db := openAccountTestDB(t)
	now := time.Date(2026, 10, 9, 0, 0, 0, 0, time.UTC)
	insertAccountTestUser(t, db, "oauth@example.test", "password", now)
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	ctx := context.Background()
	login, err := service.Login(ctx, LoginCommand{Email: "oauth@example.test", Password: "password"})
	if err != nil {
		t.Fatal(err)
	}
	until := now.Add(5 * time.Minute)
	if err := db.Model(&store.UserSession{}).Where("token_hash = ?", auth.HashSessionToken(login.Session.Token)).Update("native_exchange_until", until).Error; err != nil {
		t.Fatal(err)
	}
	credential, err := service.ExchangeNativeSession(ctx, login.Session.Token)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ExchangeNativeSession(ctx, login.Session.Token); ErrorCodeOf(err) != CodeUnauthorized {
		t.Fatalf("exchange reused: %v", err)
	}
	for day := 80; day < 365; day += 80 {
		now = time.Date(2026, 10, 9, 0, 0, 0, 0, time.UTC).Add(time.Duration(day) * 24 * time.Hour)
		credential, err = service.RefreshNativeSession(ctx, credential.RefreshToken)
		if err != nil {
			t.Fatalf("refresh day %d: %v", day, err)
		}
	}
	if credential.RefreshExpiresAt.After(credential.RefreshAbsoluteExpiresAt) {
		t.Fatal("refresh exceeded absolute limit")
	}
	now = credential.RefreshAbsoluteExpiresAt
	if _, err := service.RefreshNativeSession(ctx, credential.RefreshToken); ErrorCodeOf(err) != CodeUnauthorized {
		t.Fatalf("absolute expiry: %v", err)
	}
}

func TestNativeRefreshExpiresAndWebSessionUnaffected(t *testing.T) {
	db := openAccountTestDB(t)
	now := time.Date(2026, 10, 9, 0, 0, 0, 0, time.UTC)
	insertAccountTestUser(t, db, "web@example.test", "password", now)
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	ctx := context.Background()
	web, err := service.Login(ctx, LoginCommand{Email: "web@example.test", Password: "password"})
	if err != nil {
		t.Fatal(err)
	}
	if !web.Session.ExpiresAt.Equal(now.Add(7 * 24 * time.Hour)) {
		t.Fatalf("web expiry: %v", web.Session.ExpiresAt)
	}
	if _, err := service.ExchangeNativeSession(ctx, web.Session.Token); ErrorCodeOf(err) != CodeUnauthorized {
		t.Fatalf("legacy bearer was exchangeable: %v", err)
	}
	native, err := service.Login(ctx, LoginCommand{Email: "web@example.test", Password: "password"})
	if err != nil {
		t.Fatal(err)
	}
	credential, err := service.BeginNativeSession(ctx, native.Session.Token)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(90 * 24 * time.Hour)
	if _, err := service.RefreshNativeSession(ctx, credential.RefreshToken); ErrorCodeOf(err) != CodeUnauthorized {
		t.Fatalf("expired refresh: %v", err)
	}
}
