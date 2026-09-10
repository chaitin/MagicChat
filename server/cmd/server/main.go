package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"app/internal/bootstrap"
	"app/internal/config"
	"app/internal/httpserver"
	"app/internal/store"
)

const serverAddr = ":20080"

// @title AI 原生企业协作服务 API
// @version 0.1.0
// @description 私有部署企业协作产品的服务端 API。受保护客户端接口支持 Bearer Session 或 user_session Cookie（二选一）；Authorization 存在时始终优先校验 Bearer，格式错误、过期或无效时直接返回 401，不回退 Cookie。
// @BasePath /
//
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
// @description Native Mobile 使用 Bearer <opaque-session-token>。原始 token 不得放入 URL、日志或业务模型。
//
// @securityDefinitions.apikey CookieAuth
// @in header
// @name Cookie
// @description Web 使用 user_session=<opaque-session-token>。仅当请求不存在 Authorization Header 时才校验 Cookie。
func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("load config", "error", err)
		os.Exit(1)
	}

	db, err := store.OpenPostgres(cfg.Database.DSN)
	if err != nil {
		logger.Error("connect database", "error", err)
		os.Exit(1)
	}
	if err := store.Ping(db); err != nil {
		logger.Error("ping database", "error", err)
		os.Exit(1)
	}

	if err := bootstrap.Run(context.Background(), db, cfg); err != nil {
		logger.Error("bootstrap server", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	router, flushActivity := httpserver.NewRouterWithTaskReminderWorker(ctx, db, cfg)
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := router.Shutdown(shutdownCtx); err != nil {
			logger.Error("shutdown server", "error", err)
		}
		flushCtx, flushCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer flushCancel()
		if err := flushActivity(flushCtx); err != nil {
			logger.Error("flush account activity on shutdown", "error", err)
		}
	}()
	logger.Info("server starting", "addr", serverAddr)
	err = router.Start(serverAddr)
	stop()
	<-shutdownDone
	if err != nil && err != http.ErrServerClosed {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
