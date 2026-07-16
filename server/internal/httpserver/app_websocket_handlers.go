package httpserver

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"

	appapp "app/internal/application/app"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

const (
	appIDHeader = "X-MagicChat-App-ID"
)

var (
	errAppConnectionUnauthorized = errors.New("app connection unauthorized")
	errAppConnectionForbidden    = errors.New("app connection forbidden")
)

var appWebSocketUpgrader = websocket.Upgrader{
	CheckOrigin: func(*http.Request) bool {
		return true
	},
}

// appWebSocket godoc
//
// @Summary 应用 WebSocket 连接
// @Description 应用使用 App ID 和连接密钥连接，连接存在且心跳正常时视为在线。
// @Tags 应用连接
// @Param X-MagicChat-App-ID header string true "应用 ID"
// @Param Authorization header string true "Bearer 连接密钥"
// @Success 101
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/app/ws [get]
func (s *Server) appWebSocket(c echo.Context) error {
	appID := strings.TrimSpace(c.Request().Header.Get(appIDHeader))
	if _, err := uuid.Parse(appID); err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "应用 ID 格式错误")
	}

	authorization := c.Request().Header.Get("Authorization")
	app, err := s.authenticateAppConnection(c.Request().Context(), appID, authorization)
	if err != nil {
		return writeAppConnectionAuthFailure(c, err)
	}

	socket, err := appWebSocketUpgrader.Upgrade(c.Response().Writer, c.Request(), nil)
	if err != nil {
		return err
	}

	s.appEventMu.Lock()
	conn := s.appConnections.NewConnection(app.ID, socket)
	s.appConnections.Register(conn)

	// Register before rechecking credentials so a concurrent disable, delete,
	// owner disable, or secret rotation can find and close this connection.
	// Do not start serving or replay events until the recheck succeeds.
	if _, err := s.authenticateAppConnection(c.Request().Context(), app.ID, authorization); err != nil {
		s.appConnections.Unregister(conn)
		conn.Close()
		s.appEventMu.Unlock()
		return nil
	}

	serveDone := make(chan struct{})
	go func() {
		conn.Serve()
		close(serveDone)
	}()
	replayErr := s.replayAppEvents(app.ID, conn)
	s.appEventMu.Unlock()
	if replayErr != nil {
		s.appConnections.Unregister(conn)
		conn.Close()
		<-serveDone
		return replayErr
	}
	<-serveDone
	s.appConnections.Unregister(conn)

	return nil
}

func (s *Server) authenticateAppConnection(ctx context.Context, appID string, authorization string) (appapp.App, error) {
	app, ok, err := s.findAppForConnection(ctx, appID)
	if err != nil {
		return appapp.App{}, err
	}
	if !ok || !validAppBearer(authorization, app.ConnectionSecret) {
		return appapp.App{}, errAppConnectionUnauthorized
	}
	if !app.Enabled {
		return appapp.App{}, errAppConnectionForbidden
	}
	return app, nil
}

func writeAppConnectionAuthFailure(c echo.Context, err error) error {
	switch {
	case errors.Is(err, errAppConnectionUnauthorized):
		return failure(c, http.StatusUnauthorized, "unauthorized", "应用认证失败")
	case errors.Is(err, errAppConnectionForbidden):
		return failure(c, http.StatusForbidden, "forbidden", "应用已禁用")
	default:
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
}

func (s *Server) findAppForConnection(ctx context.Context, appID string) (appapp.App, bool, error) {
	value, err := s.apps.GetForConnection(ctx, appID)
	if appapp.ErrorCodeOf(err) == appapp.CodeNotFound {
		return appapp.App{}, false, nil
	}
	if err != nil {
		return appapp.App{}, false, err
	}
	return value, true, nil
}

func validAppBearer(header string, secret string) bool {
	auth := strings.TrimSpace(header)
	prefix := "Bearer "
	if !strings.HasPrefix(auth, prefix) {
		return false
	}
	token := strings.TrimSpace(strings.TrimPrefix(auth, prefix))
	expected := strings.TrimSpace(secret)
	if token == "" || expected == "" || len(token) != len(expected) {
		return false
	}

	return subtle.ConstantTimeCompare([]byte(token), []byte(expected)) == 1
}
