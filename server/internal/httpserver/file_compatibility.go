package httpserver

import (
	"strings"
	"time"

	fileapp "app/internal/application/file"
)

const maxRemoteMessageFileBytes = 20 * 1024 * 1024

type temporaryFileReadURLResponse struct {
	ExpiresAt time.Time `json:"expires_at" format:"date-time"`
	FileID    string    `json:"file_id" example:"7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"`
	URL       string    `json:"url"`
}

type readTemporaryFileURLsResponse struct {
	URLs []temporaryFileReadURLResponse `json:"urls"`
}

func newTemporaryFileReadURLResponses(values []fileapp.ResolvedTemporaryURL) []temporaryFileReadURLResponse {
	result := make([]temporaryFileReadURLResponse, 0, len(values))
	for _, value := range values {
		result = append(result, temporaryFileReadURLResponse{
			ExpiresAt: value.ExpiresAt,
			FileID:    value.FileID,
			URL:       value.URL,
		})
	}
	return result
}

func isRequestBodyTooLarge(err error) bool {
	return err != nil && strings.Contains(err.Error(), "request body too large")
}
