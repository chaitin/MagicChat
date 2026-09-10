package httpserver

import (
	"net/http"
	"strings"
	"time"

	gatewayadmin "push-gateway/internal/admin"
	"push-gateway/internal/model"

	"github.com/labstack/echo/v4"
)

const (
	adminSessionCookie = "push_gateway_admin_session"
	adminCSRFCookie    = "push_gateway_admin_csrf"
	adminSessionKey    = "push_gateway_admin_session_value"
)

type adminLoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type adminServerRequest struct {
	Name       string `json:"name"`
	DailyQuota int64  `json:"daily_quota"`
}

func (s *Server) registerAdminRoutes(router *echo.Echo) {
	group := router.Group("/api/admin/v1")
	group.Use(noStore)
	group.POST("/session", s.adminLogin)
	protected := group.Group("")
	protected.Use(s.requireAdminSession)
	protected.GET("/session", s.adminSession)
	protected.DELETE("/session", s.adminLogout)
	protected.GET("/servers", s.adminListServers)
	protected.POST("/servers", s.adminCreateServer)
	protected.PATCH("/servers/:server_id", s.adminUpdateServer)
	protected.POST("/servers/:server_id/enable", s.adminEnableServer)
	protected.POST("/servers/:server_id/disable", s.adminDisableServer)
	protected.POST("/servers/:server_id/key/reveal", s.adminRevealServerKey)
	protected.POST("/servers/:server_id/key/rotate", s.adminRotateServerKey)
}

func (s *Server) adminLogin(c echo.Context) error {
	if strings.EqualFold(c.Request().Header.Get("Sec-Fetch-Site"), "cross-site") {
		return &gatewayadmin.Failure{Code: "csrf_invalid"}
	}
	if s.admin == nil || !s.admin.Enabled() {
		return &gatewayadmin.Failure{Code: "admin_unavailable"}
	}
	var request adminLoginRequest
	if err := decodeJSON(c, &request); err != nil {
		return err
	}
	credential, err := s.admin.Login(c.Request().Context(), request.Username, request.Password, s.clientAddress(c.Request()))
	if err != nil {
		return err
	}
	s.setAdminCookies(c, credential)
	return writeSuccess(c, http.StatusOK, map[string]any{"authenticated": true, "expires_at": credential.ExpiresAt})
}

func (s *Server) adminSession(c echo.Context) error {
	session := c.Get(adminSessionKey).(model.AdminSession)
	return writeSuccess(c, http.StatusOK, map[string]any{"authenticated": true, "expires_at": session.ExpiresAt})
}

func (s *Server) adminLogout(c echo.Context) error {
	if err := s.admin.Logout(c.Request().Context(), adminSessionToken(c)); err != nil {
		return err
	}
	s.clearAdminCookies(c)
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) adminListServers(c echo.Context) error {
	servers, err := s.admin.ListServers(c.Request().Context())
	if err != nil {
		return err
	}
	return writeSuccess(c, http.StatusOK, map[string]any{"servers": servers})
}

func (s *Server) adminCreateServer(c echo.Context) error {
	var request adminServerRequest
	if err := decodeJSON(c, &request); err != nil {
		return err
	}
	issued, err := s.admin.CreateServer(c.Request().Context(), request.Name, request.DailyQuota, c.Response().Header().Get(echo.HeaderXRequestID))
	if err != nil {
		return err
	}
	return writeSuccess(c, http.StatusCreated, issued)
}

func (s *Server) adminUpdateServer(c echo.Context) error {
	var request adminServerRequest
	if err := decodeJSON(c, &request); err != nil {
		return err
	}
	server, err := s.admin.UpdateServer(c.Request().Context(), c.Param("server_id"), request.Name, request.DailyQuota, c.Response().Header().Get(echo.HeaderXRequestID))
	if err != nil {
		return err
	}
	return writeSuccess(c, http.StatusOK, server)
}

func (s *Server) adminEnableServer(c echo.Context) error {
	return s.adminSetServerStatus(c, model.ServerStatusActive)
}

func (s *Server) adminDisableServer(c echo.Context) error {
	return s.adminSetServerStatus(c, model.ServerStatusDisabled)
}

func (s *Server) adminSetServerStatus(c echo.Context, status string) error {
	server, err := s.admin.SetServerStatus(c.Request().Context(), c.Param("server_id"), status, c.Response().Header().Get(echo.HeaderXRequestID))
	if err != nil {
		return err
	}
	return writeSuccess(c, http.StatusOK, server)
}

func (s *Server) adminRevealServerKey(c echo.Context) error {
	key, err := s.admin.RevealServerKey(c.Request().Context(), c.Param("server_id"), c.Response().Header().Get(echo.HeaderXRequestID))
	if err != nil {
		return err
	}
	return writeSuccess(c, http.StatusOK, map[string]string{"key": key})
}

func (s *Server) adminRotateServerKey(c echo.Context) error {
	issued, err := s.admin.RotateServerKey(c.Request().Context(), c.Param("server_id"), c.Response().Header().Get(echo.HeaderXRequestID))
	if err != nil {
		return err
	}
	return writeSuccess(c, http.StatusOK, issued)
}

func (s *Server) requireAdminSession(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if s.admin == nil || !s.admin.Enabled() {
			return &gatewayadmin.Failure{Code: "admin_unavailable"}
		}
		if strings.EqualFold(c.Request().Header.Get("Sec-Fetch-Site"), "cross-site") {
			return &gatewayadmin.Failure{Code: "csrf_invalid"}
		}
		session, err := s.admin.Authenticate(c.Request().Context(), adminSessionToken(c))
		if err != nil {
			return err
		}
		if c.Request().Method != http.MethodGet && c.Request().Method != http.MethodHead {
			csrfCookie, cookieErr := c.Cookie(adminCSRFCookie)
			if cookieErr != nil || csrfCookie.Value == "" || csrfCookie.Value != c.Request().Header.Get("X-CSRF-Token") {
				return &gatewayadmin.Failure{Code: "csrf_invalid"}
			}
			if err := s.admin.VerifyCSRF(session, csrfCookie.Value); err != nil {
				return err
			}
		}
		c.Set(adminSessionKey, session)
		return next(c)
	}
}

func (s *Server) setAdminCookies(c echo.Context, credential gatewayadmin.SessionCredential) {
	maxAge := int(time.Until(credential.ExpiresAt).Seconds())
	secureCookie := requestUsesHTTPS(c.Request())
	c.SetCookie(&http.Cookie{Name: adminSessionCookie, Value: credential.SessionToken, Path: "/", HttpOnly: true, Secure: secureCookie, SameSite: http.SameSiteStrictMode, MaxAge: maxAge, Expires: credential.ExpiresAt})
	c.SetCookie(&http.Cookie{Name: adminCSRFCookie, Value: credential.CSRFToken, Path: "/", HttpOnly: false, Secure: secureCookie, SameSite: http.SameSiteStrictMode, MaxAge: maxAge, Expires: credential.ExpiresAt})
}

func (s *Server) clearAdminCookies(c echo.Context) {
	expires := time.Unix(0, 0)
	secureCookie := requestUsesHTTPS(c.Request())
	c.SetCookie(&http.Cookie{Name: adminSessionCookie, Path: "/", HttpOnly: true, Secure: secureCookie, SameSite: http.SameSiteStrictMode, MaxAge: -1, Expires: expires})
	c.SetCookie(&http.Cookie{Name: adminCSRFCookie, Path: "/", HttpOnly: false, Secure: secureCookie, SameSite: http.SameSiteStrictMode, MaxAge: -1, Expires: expires})
}

func requestUsesHTTPS(request *http.Request) bool {
	if request.TLS != nil {
		return true
	}
	forwardedProto := strings.TrimSpace(strings.Split(request.Header.Get("X-Forwarded-Proto"), ",")[0])
	return strings.EqualFold(forwardedProto, "https")
}

func adminSessionToken(c echo.Context) string {
	cookie, err := c.Cookie(adminSessionCookie)
	if err != nil {
		return ""
	}
	return cookie.Value
}
