package report

import "errors"

type ErrorCode string

const (
	CodeInternal       ErrorCode = "internal_error"
	CodeInvalidRequest ErrorCode = "invalid_request"
	CodeNotFound       ErrorCode = "not_found"
)

type Error struct {
	Code    ErrorCode
	Message string
	Cause   error
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func (e *Error) Unwrap() error { return e.Cause }

func ErrorCodeOf(err error) ErrorCode {
	var reportErr *Error
	if errors.As(err, &reportErr) {
		return reportErr.Code
	}
	return CodeInternal
}

func ErrorMessage(err error) string {
	var reportErr *Error
	if errors.As(err, &reportErr) && reportErr.Message != "" {
		return reportErr.Message
	}
	return "服务端错误"
}

func invalidError(message string, cause error) error {
	return &Error{Code: CodeInvalidRequest, Message: message, Cause: cause}
}

func notFoundError() error {
	return &Error{Code: CodeNotFound, Message: "举报对象不存在或不可用"}
}

func internalError(cause error) error {
	return &Error{Code: CodeInternal, Message: "服务端错误", Cause: cause}
}
