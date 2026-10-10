package client

import (
	"encoding/json"
	"io"
	"net/http"

	"app/internal/application/account"

	"github.com/labstack/echo/v4"
)

type nativeRefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func nativeRequest(c echo.Context) bool {
	return supportsMobileSessionResponse(c.Request())
}

func readNativeRefreshRequest(c echo.Context) (nativeRefreshRequest, bool) {
	var request nativeRefreshRequest
	decoder := json.NewDecoder(io.LimitReader(c.Request().Body, 16*1024))
	if err := decoder.Decode(&request); err != nil || len(request.RefreshToken) == 0 || len(request.RefreshToken) > 8192 {
		return request, false
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return request, false
	}
	return request, true
}

func (a *AccountAPI) nativeExchange(c echo.Context) error {
	if !nativeRequest(c) || a.nativeSessions == nil {
		return writeFailure(c, http.StatusUnauthorized, string(account.CodeUnauthorized), "未登录")
	}
	credential, valid := sessionCredentialFromRequest(c.Request())
	if !valid || credential.source != "bearer" {
		return writeFailure(c, http.StatusUnauthorized, string(account.CodeUnauthorized), "未登录")
	}
	result, err := a.nativeSessions.ExchangeNativeSession(c.Request().Context(), credential.token)
	if err != nil {
		return writeAccountError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newMobileSessionResponse(result))
}

func (a *AccountAPI) nativeRefresh(c echo.Context) error {
	if !nativeRequest(c) || a.nativeSessions == nil {
		return writeFailure(c, http.StatusUnauthorized, string(account.CodeUnauthorized), "未登录")
	}
	request, valid := readNativeRefreshRequest(c)
	if !valid {
		return writeFailure(c, http.StatusBadRequest, string(account.CodeInvalidRequest), "请求格式错误")
	}
	result, err := a.nativeSessions.RefreshNativeSession(c.Request().Context(), request.RefreshToken)
	if err != nil {
		return writeAccountError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newMobileSessionResponse(result))
}

func (a *AccountAPI) nativeRevoke(c echo.Context) error {
	if !nativeRequest(c) || a.nativeSessions == nil {
		return writeFailure(c, http.StatusUnauthorized, string(account.CodeUnauthorized), "未登录")
	}
	request, valid := readNativeRefreshRequest(c)
	if !valid {
		return writeFailure(c, http.StatusBadRequest, string(account.CodeInvalidRequest), "请求格式错误")
	}
	if err := a.nativeSessions.RevokeNativeSession(c.Request().Context(), request.RefreshToken); err != nil {
		return writeAccountError(c, err)
	}
	return writeSuccess(c, http.StatusOK, map[string]any{})
}
