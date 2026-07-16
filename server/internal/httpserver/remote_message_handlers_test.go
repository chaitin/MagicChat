package httpserver

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
)

func TestDownloadRemoteMessageFileRetainsTwentyMiBLimit(t *testing.T) {
	sourceServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", strconv.FormatInt(maxRemoteMessageFileBytes+1, 10))
		w.WriteHeader(http.StatusOK)
	}))
	defer sourceServer.Close()

	previousHTTPClient := remoteMessageFetchHTTPClient
	previousValidator := validateRemoteMessageFetchURL
	remoteMessageFetchHTTPClient = sourceServer.Client()
	validateRemoteMessageFetchURL = func(context.Context, *url.URL) error { return nil }
	t.Cleanup(func() {
		remoteMessageFetchHTTPClient = previousHTTPClient
		validateRemoteMessageFetchURL = previousValidator
	})

	_, err := downloadRemoteMessageFile(t.Context(), sourceServer.URL+"/large", maxRemoteMessageFileBytes)
	var failure appRequestFailure
	if !errors.As(err, &failure) {
		t.Fatalf("download error = %v, want app request failure", err)
	}
	if failure.Code != "request_too_large" || failure.Message != "文件不能超过 20MiB" {
		t.Fatalf("download failure = %#v", failure)
	}
}
