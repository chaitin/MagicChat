package client

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"app/internal/application/account"

	"github.com/labstack/echo/v4"
)

const (
	UserSessionCookieName    = "user_session"
	PushInstallationIDHeader = "X-Push-Installation-ID"
	currentAccountKey        = "api.client.current_account"
	currentSessionKey        = "api.client.current_session"
	maxAvatarRequestBytes    = 2 * 1024 * 1024
)

type AuthenticatedHook func(echo.Context, account.AuthenticatedSession)

type sessionCredential struct {
	token  string
	source string
}

func sessionCredentialFromRequest(r *http.Request) (sessionCredential, bool) {
	values, present := r.Header[http.CanonicalHeaderKey("Authorization")]
	if present {
		if len(values) != 1 {
			return sessionCredential{}, false
		}
		value := values[0]
		const prefix = "Bearer "
		if !strings.HasPrefix(value, prefix) || len(value) == len(prefix) {
			return sessionCredential{}, false
		}
		token := value[len(prefix):]
		for _, character := range token {
			if character <= ' ' || character >= 0x7f || character == ',' {
				return sessionCredential{}, false
			}
		}
		return sessionCredential{token: token, source: "bearer"}, true
	}

	cookie, err := r.Cookie(UserSessionCookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return sessionCredential{}, true
	}
	return sessionCredential{token: cookie.Value, source: "cookie"}, true
}

type AccountAPI struct {
	accounts        account.ClientService
	sessions        account.SessionAuthenticator
	nativeSessions  account.NativeSessionService
	onAuthenticated AuthenticatedHook
}

type loginRequest struct {
	Email    string `json:"email" example:"user@example.com"`
	Password string `json:"password" example:"password"`
}

type updateProfileRequest struct {
	Avatar   *string `json:"avatar" example:"/assets/avatars/builtin/07.webp"`
	Nickname *string `json:"nickname" example:"小张"`
}

type accountResponse struct {
	ID           string    `json:"id" example:"7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"`
	Avatar       string    `json:"avatar" example:"/assets/avatars/builtin/07.webp"`
	Email        string    `json:"email" example:"user@example.com"`
	LastOnlineAt *string   `json:"last_online_at" example:"2026-07-03T01:00:00Z"`
	Name         string    `json:"name" example:"张三"`
	Nickname     string    `json:"nickname" example:"小张"`
	Phone        string    `json:"phone" example:"+8613812345678"`
	Status       string    `json:"status" example:"active"`
	CreatedAt    time.Time `json:"created_at" format:"date-time"`
}

type mobileSessionResponse struct {
	Token                    string    `json:"token"`
	ExpiresAt                time.Time `json:"expires_at" format:"date-time"`
	RefreshToken             string    `json:"refresh_token"`
	RefreshExpiresAt         time.Time `json:"refresh_expires_at" format:"date-time"`
	RefreshAbsoluteExpiresAt time.Time `json:"refresh_absolute_expires_at" format:"date-time"`
}

func newMobileSessionResponse(value account.NativeSessionCredential) *mobileSessionResponse {
	return &mobileSessionResponse{
		Token: value.Token, ExpiresAt: value.ExpiresAt,
		RefreshToken: value.RefreshToken, RefreshExpiresAt: value.RefreshExpiresAt,
		RefreshAbsoluteExpiresAt: value.RefreshAbsoluteExpiresAt,
	}
}

type accountEnvelope struct {
	Account       accountResponse        `json:"user"`
	MobileSession *mobileSessionResponse `json:"mobile_session,omitempty"`
}

type successEnvelope struct {
	Success bool `json:"success" example:"true"`
	Data    any  `json:"data"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorEnvelope struct {
	Success bool      `json:"success" example:"false"`
	Error   errorBody `json:"error"`
}

func NewAccountAPI(accounts account.ClientService, sessions account.SessionAuthenticator, onAuthenticated AuthenticatedHook) *AccountAPI {
	nativeSessions, _ := accounts.(account.NativeSessionService)
	return &AccountAPI{
		accounts:        accounts,
		sessions:        sessions,
		nativeSessions:  nativeSessions,
		onAuthenticated: onAuthenticated,
	}
}

func (a *AccountAPI) RegisterPublicRoutes(router *echo.Echo) {
	router.POST("/api/client/auth/login", a.login)
	router.POST("/api/client/auth/logout", a.logout)
	router.POST("/api/client/auth/native/exchange", a.nativeExchange)
	router.POST("/api/client/auth/native/refresh", a.nativeRefresh)
	router.POST("/api/client/auth/native/revoke", a.nativeRevoke)
}

func (a *AccountAPI) RegisterProtectedRoutes(group *echo.Group) {
	group.GET("/me", a.getCurrentAccount)
	group.PATCH("/me", a.updateCurrentAccount)
	group.POST("/me/avatar", a.uploadCurrentAccountAvatar)
}

func (a *AccountAPI) RequireSession(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		credential, valid := sessionCredentialFromRequest(c.Request())
		if !valid || credential.token == "" {
			return writeFailure(c, http.StatusUnauthorized, string(account.CodeUnauthorized), "未登录")
		}

		session, err := a.sessions.AuthenticateSession(c.Request().Context(), credential.token)
		if err != nil {
			return writeAccountError(c, err)
		}
		c.Set(currentAccountKey, session.Account)
		c.Set(currentSessionKey, session)
		if a.onAuthenticated != nil {
			a.onAuthenticated(c, session)
		}
		return next(c)
	}
}

// login godoc
//
// @Summary 普通用户登录
// @Description 普通用户使用管理员创建的邮箱和密码登录。原生客户端发送 X-Dianbao-Mobile-Session: 2 且不带 Origin 时返回访问与刷新凭据，不设置 Cookie；Web 继续使用 Cookie。
// @Tags 客户端认证
// @Accept json
// @Produce json
// @Param X-Dianbao-Mobile-Session header string false "原生客户端会话能力版本；仅值 2 生效（带 Origin 时忽略）" Enums(2)
// @Param body body loginRequest true "登录参数"
// @Success 200 {object} successEnvelope{data=accountEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/auth/login [post]
func (a *AccountAPI) login(c echo.Context) error {
	var req loginRequest
	if err := c.Bind(&req); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(account.CodeInvalidRequest), "请求格式错误")
	}

	result, err := a.accounts.Login(c.Request().Context(), account.LoginCommand{
		Email:     req.Email,
		Password:  req.Password,
		UserAgent: c.Request().UserAgent(),
		IP:        c.RealIP(),
	})
	if err != nil {
		return writeAccountError(c, err)
	}

	response := accountEnvelope{Account: newAccountResponse(result.Account)}
	if supportsMobileSessionResponse(c.Request()) {
		if a.nativeSessions == nil {
			return writeFailure(c, http.StatusInternalServerError, string(account.CodeInternal), "服务端不支持原生会话")
		}
		credential, err := a.nativeSessions.BeginNativeSession(c.Request().Context(), result.Session.Token)
		if err != nil {
			return writeAccountError(c, err)
		}
		response.MobileSession = newMobileSessionResponse(credential)
	} else {
		setSessionCookie(c, result.Session.Token, result.Session.ExpiresAt)
	}
	return writeSuccess(c, http.StatusOK, response)
}

// logout godoc
//
// @Summary 普通用户退出登录
// @Description 精确撤销本请求解析出的一个 Session 并清除兼容 Cookie；Bearer 优先，存在但无效时返回 401 且不回退 Cookie。Mobile 客户端将 401/已失效 Session 作为幂等注销完成。
// @Tags 客户端认证
// @Produce json
// @Param X-Push-Installation-ID header string false "当前推送安装实例 ID"
// @Success 200 {object} successEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security BearerAuth
// @Security CookieAuth
// @Router /api/client/auth/logout [post]
func (a *AccountAPI) logout(c echo.Context) error {
	credential, valid := sessionCredentialFromRequest(c.Request())
	if !valid {
		return writeFailure(c, http.StatusUnauthorized, string(account.CodeUnauthorized), "未登录")
	}
	if err := a.accounts.Logout(c.Request().Context(), account.LogoutCommand{
		Token: credential.token, InstallationID: c.Request().Header.Get(PushInstallationIDHeader),
		RequireExisting: credential.source == "bearer",
	}); err != nil {
		return writeAccountError(c, err)
	}

	if credential.source == "cookie" {
		clearSessionCookie(c)
	}
	return writeSuccess(c, http.StatusOK, map[string]any{})
}

// getCurrentAccount godoc
//
// @Summary 获取当前用户
// @Description 普通用户获取当前登录用户信息。
// @Tags 客户端认证
// @Produce json
// @Success 200 {object} successEnvelope{data=accountEnvelope}
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/me [get]
func (a *AccountAPI) getCurrentAccount(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(account.CodeInternal), "服务端错误")
	}
	return writeSuccess(c, http.StatusOK, accountEnvelope{Account: newAccountResponse(current)})
}

// updateCurrentAccount godoc
//
// @Summary 修改当前用户资料
// @Description 普通用户修改自己的昵称和头像。avatar 与 nickname 均可单独传入；nickname 可传空字符串用于清空。
// @Tags 客户端认证
// @Accept json
// @Produce json
// @Param body body updateProfileRequest true "用户资料"
// @Success 200 {object} successEnvelope{data=accountEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/me [patch]
func (a *AccountAPI) updateCurrentAccount(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(account.CodeInternal), "服务端错误")
	}
	var req updateProfileRequest
	if err := c.Bind(&req); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(account.CodeInvalidRequest), "请求格式错误")
	}

	updated, err := a.accounts.UpdateProfile(c.Request().Context(), account.UpdateProfileCommand{
		AccountID: current.ID,
		Avatar:    req.Avatar,
		Nickname:  req.Nickname,
	})
	if err != nil {
		return writeAccountError(c, err)
	}
	return writeSuccess(c, http.StatusOK, accountEnvelope{Account: newAccountResponse(updated)})
}

// uploadCurrentAccountAvatar godoc
//
// @Summary 上传当前用户头像
// @Description 普通用户上传裁切后的 WebP 头像。头像必须是 256x256，文件会写入 public bucket，并更新当前用户头像。
// @Tags 客户端认证
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "WebP 头像"
// @Success 200 {object} successEnvelope{data=accountEnvelope}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 413 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/me/avatar [post]
func (a *AccountAPI) uploadCurrentAccountAvatar(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(account.CodeInternal), "服务端错误")
	}

	c.Request().Body = http.MaxBytesReader(c.Response().Writer, c.Request().Body, maxAvatarRequestBytes)
	fileHeader, err := c.FormFile("file")
	if err != nil {
		if isRequestBodyTooLarge(err) {
			return writeFailure(c, http.StatusRequestEntityTooLarge, string(account.CodeRequestTooLarge), "头像文件不能超过 1MiB")
		}
		return writeFailure(c, http.StatusBadRequest, string(account.CodeInvalidRequest), "请选择要上传的头像")
	}
	file, err := fileHeader.Open()
	if err != nil {
		return writeFailure(c, http.StatusBadRequest, string(account.CodeInvalidRequest), "读取头像失败")
	}
	defer file.Close()

	updated, err := a.accounts.UploadAvatar(c.Request().Context(), account.UploadAvatarCommand{
		AccountID: current.ID,
		Size:      fileHeader.Size,
		Content:   file,
	})
	if err != nil {
		return writeAccountError(c, err)
	}
	return writeSuccess(c, http.StatusOK, accountEnvelope{Account: newAccountResponse(updated)})
}

func CurrentAccount(c echo.Context) (account.Account, bool) {
	current, ok := c.Get(currentAccountKey).(account.Account)
	return current, ok
}

func CurrentAccountSession(c echo.Context) (account.AuthenticatedSession, bool) {
	current, ok := c.Get(currentSessionKey).(account.AuthenticatedSession)
	return current, ok
}

func newAccountResponse(value account.Account) accountResponse {
	var lastOnlineAt *string
	if value.LastOnlineAt != nil {
		formatted := value.LastOnlineAt.UTC().Format(time.RFC3339)
		lastOnlineAt = &formatted
	}
	return accountResponse{
		ID:           value.ID,
		Avatar:       value.Avatar,
		Email:        value.Email,
		LastOnlineAt: lastOnlineAt,
		Name:         value.Name,
		Nickname:     value.Nickname,
		Phone:        value.Phone,
		Status:       value.Status,
		CreatedAt:    value.CreatedAt,
	}
}

func setSessionCookie(c echo.Context, token string, expiresAt time.Time) {
	c.SetCookie(&http.Cookie{
		Name:     UserSessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
		HttpOnly: true,
		Secure:   requestUsesHTTPS(c.Request()),
		SameSite: http.SameSiteLaxMode,
	})
}

func clearSessionCookie(c echo.Context) {
	c.SetCookie(&http.Cookie{
		Name:     UserSessionCookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0).UTC(),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   requestUsesHTTPS(c.Request()),
		SameSite: http.SameSiteLaxMode,
	})
}

func requestUsesHTTPS(request *http.Request) bool {
	return request.TLS != nil || strings.EqualFold(strings.TrimSpace(request.Header.Get("X-Forwarded-Proto")), "https")
}

func writeSuccess(c echo.Context, status int, data any) error {
	return c.JSON(status, successEnvelope{Success: true, Data: data})
}

func writeFailure(c echo.Context, status int, code string, message string) error {
	return c.JSON(status, errorEnvelope{
		Success: false,
		Error:   errorBody{Code: code, Message: message},
	})
}

func writeAccountError(c echo.Context, err error) error {
	status := http.StatusInternalServerError
	switch account.ErrorCodeOf(err) {
	case account.CodeInvalidRequest:
		status = http.StatusBadRequest
	case account.CodeInvalidCredentials, account.CodeUnauthorized:
		status = http.StatusUnauthorized
	case account.CodeNotFound:
		status = http.StatusNotFound
	case account.CodeConflict:
		status = http.StatusConflict
	case account.CodeRequestTooLarge:
		status = http.StatusRequestEntityTooLarge
	case account.CodeLoginUnavailable:
		status = http.StatusServiceUnavailable
	case account.CodeNicknameDisabled:
		status = http.StatusForbidden
	}
	return writeFailure(c, status, string(account.ErrorCodeOf(err)), account.ErrorMessage(err))
}

func isRequestBodyTooLarge(err error) bool {
	var maxBytesErr *http.MaxBytesError
	return errors.As(err, &maxBytesErr) || strings.Contains(err.Error(), "request body too large")
}
