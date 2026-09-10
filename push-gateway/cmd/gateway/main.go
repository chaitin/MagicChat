package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	gatewayadmin "push-gateway/internal/admin"
	"push-gateway/internal/config"
	"push-gateway/internal/gateway"
	"push-gateway/internal/httpserver"
	"push-gateway/internal/provider"
	"push-gateway/internal/provider/apns"
	"push-gateway/internal/provider/fake"
	"push-gateway/internal/provider/jpush"
	"push-gateway/internal/secure"
	"push-gateway/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("load config", "error", err)
		os.Exit(1)
	}
	db, err := store.OpenPostgres(cfg.DatabaseURL)
	if err != nil {
		logger.Error("open database", "error", err)
		os.Exit(1)
	}
	if err := store.Ping(db); err != nil {
		logger.Error("ping database", "error", err)
		os.Exit(1)
	}
	if err := store.Migrate(db); err != nil {
		logger.Error("migrate database", "error", err)
		os.Exit(1)
	}
	encryptionKeys := append([][]byte{cfg.DataEncryptionKey}, cfg.PreviousDataEncryptionKeys...)
	cipher, err := secure.NewTokenCipher(encryptionKeys...)
	if err != nil {
		logger.Error("create token cipher", "error", err)
		os.Exit(1)
	}
	providers, err := configuredProviders(cfg)
	if err != nil {
		logger.Error("configure push providers", "error", err)
		os.Exit(1)
	}
	service, err := gateway.New(gateway.Options{
		DB: db, Cipher: cipher, Providers: providers,
		GrantTTL: cfg.GrantTTL, NotificationTTL: cfg.NotificationTTL,
		MaxNotificationTTL: cfg.MaxNotificationTTL, JobRetention: cfg.JobRetention,
		InstallationRetention:             cfg.InstallationRetention,
		MaxJobsPerGrantMinute:             int64(cfg.MaxJobsPerGrantMinute),
		MaxRegistrationsPerIPMinute:       int64(cfg.MaxRegistrationsPerIPMinute),
		MaxRegistrationsGlobalMinute:      int64(cfg.MaxRegistrationsGlobalMinute),
		MaxGrantRotationsPerInstallMinute: int64(cfg.MaxGrantRotationsPerInstallMinute),
		MaxNotificationsGlobalMinute:      int64(cfg.MaxNotificationsGlobalMinute),
	})
	if err != nil {
		logger.Error("create gateway service", "error", err)
		os.Exit(1)
	}
	adminService, err := gatewayadmin.New(gatewayadmin.Options{
		DB: db, Cipher: cipher, Username: cfg.Admin.Username,
		Password: cfg.Admin.Password, PasswordHash: cfg.Admin.PasswordHash,
		SessionTTL: cfg.Admin.SessionTTL,
	})
	if err != nil {
		logger.Error("create admin service", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go service.RunWorker(ctx, gateway.WorkerOptions{
		BatchSize: cfg.WorkerBatchSize, PollInterval: cfg.WorkerPollInterval, Logger: logger,
	})
	router := httpserver.New(db, service, httpserver.Options{
		TrustedProxyCIDRs: cfg.TrustedProxyCIDRs,
		Admin:             adminService, AdminCookieSecure: cfg.Admin.CookieSecure,
	})
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := router.Shutdown(shutdownCtx); err != nil {
			logger.Error("shutdown gateway", "error", err)
		}
	}()
	logger.Info("push gateway starting", "addr", cfg.HTTPAddr, "providers", cfg.Providers)
	if err := router.Start(cfg.HTTPAddr); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("push gateway stopped", "error", err)
		os.Exit(1)
	}
}

func configuredProviders(cfg config.Config) ([]provider.Provider, error) {
	result := make([]provider.Provider, 0, len(cfg.Providers))
	for _, name := range cfg.Providers {
		switch name {
		case "fake":
			result = append(result, fake.New())
		case "apns":
			value, err := apns.New(apns.Config{
				KeyID: cfg.APNS.KeyID, TeamID: cfg.APNS.TeamID,
				BundleID: cfg.APNS.BundleID, PrivateKeyPEM: cfg.APNS.PrivateKeyPEM,
			})
			if err != nil {
				return nil, err
			}
			result = append(result, value)
		case "jpush":
			value, err := jpush.New(jpush.Config{
				AppKey: cfg.JPush.AppKey, MasterSecret: cfg.JPush.MasterSecret,
			})
			if err != nil {
				return nil, err
			}
			result = append(result, value)
		default:
			return nil, &gateway.Failure{Code: "unsupported_provider", Message: "push provider is not implemented: " + name}
		}
	}
	return result, nil
}
