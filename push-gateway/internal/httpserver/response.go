package httpserver

import "github.com/labstack/echo/v4"

type successEnvelope struct {
	Success bool `json:"success"`
	Data    any  `json:"data"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorEnvelope struct {
	Success bool      `json:"success"`
	Error   errorBody `json:"error"`
}

func writeSuccess(c echo.Context, status int, data any) error {
	return c.JSON(status, successEnvelope{Success: true, Data: data})
}

func writeFailure(c echo.Context, status int, code, message string) error {
	return c.JSON(status, errorEnvelope{
		Success: false,
		Error:   errorBody{Code: code, Message: message},
	})
}
