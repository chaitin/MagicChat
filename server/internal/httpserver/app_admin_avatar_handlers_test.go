package httpserver

import (
	"bytes"
	"net/http"
	"strings"
	"testing"

	"app/internal/store"
)

func TestAdminCanUploadAppAvatar(t *testing.T) {
	s3Server, uploadedObjects := newFakeS3Server(t)
	defer s3Server.Close()

	server, db := newTemporaryFileTestRouter(t, s3Server.URL, "assets.example.test")
	defer server.Close()

	app := insertTestApp(t, db, store.App{
		Enabled: true,
		Name:    "知识库助手",
	})
	avatarContent := testWebPVP8X(256, 256)

	resp, body := postMultipartFileBytes(
		t,
		server,
		"/api/admin/apps/"+app.ID+"/avatar",
		"file",
		"avatar.webp",
		avatarContent,
		loginAsAdmin(t, server),
	)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("upload app avatar status = %d, want 200: %#v", resp.StatusCode, body)
	}

	updatedApp := requireSuccess(t, body)["app"].(map[string]any)
	avatarURL := updatedApp["avatar"].(string)
	if !strings.HasPrefix(avatarURL, "https://assets.example.test/mygod-public/avatars/apps/"+app.ID+"/") || !strings.HasSuffix(avatarURL, ".webp") {
		t.Fatalf("app.avatar = %q, want public app avatar URL", avatarURL)
	}

	var storedApp store.App
	if err := db.First(&storedApp, "id = ?", app.ID).Error; err != nil {
		t.Fatalf("find stored app: %v", err)
	}
	if storedApp.Avatar != avatarURL {
		t.Fatalf("stored app avatar = %q, want %q", storedApp.Avatar, avatarURL)
	}

	updateResp, updateBody := putJSON(t, server, "/api/admin/apps/"+app.ID, map[string]any{
		"avatar":      "/bypass.webp",
		"description": "更新后的介绍",
		"name":        app.Name,
		"visibility":  store.AppVisibilityPublic,
	}, loginAsAdmin(t, server))
	if updateResp.StatusCode != http.StatusOK {
		t.Fatalf("update app status = %d, want 200: %#v", updateResp.StatusCode, updateBody)
	}
	if updatedAvatar := requireSuccess(t, updateBody)["app"].(map[string]any)["avatar"]; updatedAvatar != avatarURL {
		t.Fatalf("avatar after JSON update = %q, want %q", updatedAvatar, avatarURL)
	}

	uploadedObjects.mu.Lock()
	uploadedBody := uploadedObjects.objects[strings.TrimPrefix(avatarURL, "https://assets.example.test")]
	uploadedObjects.mu.Unlock()
	if !bytes.Equal(uploadedBody, avatarContent) {
		t.Fatalf("uploaded object body = %#v, want avatar content", uploadedBody)
	}
}

func TestUploadAdminAppAvatarRejectsWrongDimensions(t *testing.T) {
	s3Server, _ := newFakeS3Server(t)
	defer s3Server.Close()

	server, db := newTemporaryFileTestRouter(t, s3Server.URL, "assets.example.test")
	defer server.Close()

	app := insertTestApp(t, db, store.App{Enabled: true, Name: "知识库助手"})
	resp, body := postMultipartFileBytes(
		t,
		server,
		"/api/admin/apps/"+app.ID+"/avatar",
		"file",
		"avatar.webp",
		testWebPVP8X(128, 128),
		loginAsAdmin(t, server),
	)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("upload app avatar status = %d, want 400: %#v", resp.StatusCode, body)
	}
	requireError(t, body, "invalid_request")
}

func TestUploadAdminAppAvatarRequiresLogin(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	app := insertTestApp(t, db, store.App{Enabled: true, Name: "知识库助手"})
	resp, body := postMultipartFileBytes(
		t,
		server,
		"/api/admin/apps/"+app.ID+"/avatar",
		"file",
		"avatar.webp",
		testWebPVP8X(256, 256),
	)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("upload app avatar status = %d, want 401: %#v", resp.StatusCode, body)
	}
	requireError(t, body, "unauthorized")
}
