package httpserver

import (
	"net/http"
	"testing"
	"time"

	"app/internal/store"
)

func TestClientCanManageOwnedAppAndRestrictedVisibility(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Date(2026, 7, 16, 14, 0, 0, 0, time.UTC)
	owner := insertTestUser(t, db, "owned-app-owner@example.com", "Owner", store.UserStatusActive, now)
	granted := insertTestUser(t, db, "owned-app-granted@example.com", "Granted", store.UserStatusActive, now)
	outsider := insertTestUser(t, db, "owned-app-outsider@example.com", "Outsider", store.UserStatusActive, now)
	ownerCookie := loginAsUser(t, server, owner.Email)
	grantedCookie := loginAsUser(t, server, granted.Email)
	outsiderCookie := loginAsUser(t, server, outsider.Email)

	createResp, createBody := postJSON(t, server, "/api/client/apps", map[string]any{
		"name": "  报表机器人  ", "description": "  生成报表  ",
		"visibility": "restricted", "user_ids": []string{granted.ID},
	}, ownerCookie)
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("create status = %d, body = %#v", createResp.StatusCode, createBody)
	}
	created := requireSuccess(t, createBody)
	app := created["app"].(map[string]any)
	appID := app["id"].(string)
	firstSecret := created["connection_secret"].(string)
	if firstSecret == "" || app["name"] != "报表机器人" || app["description"] != "生成报表" || app["visibility"] != "restricted" {
		t.Fatalf("created app = %#v, secret = %q", app, firstSecret)
	}

	listResp, listBody := getJSON(t, server, "/api/client/apps", ownerCookie)
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d, body = %#v", listResp.StatusCode, listBody)
	}
	listed := requireSuccess(t, listBody)["apps"].([]any)
	if len(listed) != 1 {
		t.Fatalf("listed apps = %#v", listed)
	}
	if _, ok := listed[0].(map[string]any)["connection_secret"]; ok {
		t.Fatalf("list leaked connection secret: %#v", listed[0])
	}

	otherGetResp, _ := getJSON(t, server, "/api/client/apps/"+appID, grantedCookie)
	if otherGetResp.StatusCode != http.StatusNotFound {
		t.Fatalf("non-owner get status = %d, want 404", otherGetResp.StatusCode)
	}
	grantedConversationResp, grantedConversationBody := postJSON(t, server, "/api/client/conversations/apps", map[string]any{
		"app_id": appID,
	}, grantedCookie)
	if grantedConversationResp.StatusCode != http.StatusCreated {
		t.Fatalf("granted conversation status = %d, body = %#v", grantedConversationResp.StatusCode, grantedConversationBody)
	}
	outsiderConversationResp, _ := postJSON(t, server, "/api/client/conversations/apps", map[string]any{
		"app_id": appID,
	}, outsiderCookie)
	if outsiderConversationResp.StatusCode != http.StatusNotFound {
		t.Fatalf("outsider conversation status = %d, want 404", outsiderConversationResp.StatusCode)
	}

	updateResp, updateBody := patchJSON(t, server, "/api/client/apps/"+appID, map[string]any{
		"visibility": "public",
	}, ownerCookie)
	if updateResp.StatusCode != http.StatusOK || requireSuccess(t, updateBody)["app"].(map[string]any)["visibility"] != "public" {
		t.Fatalf("update status = %d, body = %#v", updateResp.StatusCode, updateBody)
	}
	outsiderConversationResp, outsiderConversationBody := postJSON(t, server, "/api/client/conversations/apps", map[string]any{
		"app_id": appID,
	}, outsiderCookie)
	if outsiderConversationResp.StatusCode != http.StatusCreated {
		t.Fatalf("public conversation status = %d, body = %#v", outsiderConversationResp.StatusCode, outsiderConversationBody)
	}

	rotateResp, rotateBody := postJSON(t, server, "/api/client/apps/"+appID+"/secret/regenerate", map[string]any{}, ownerCookie)
	if rotateResp.StatusCode != http.StatusOK {
		t.Fatalf("rotate status = %d, body = %#v", rotateResp.StatusCode, rotateBody)
	}
	rotated := requireSuccess(t, rotateBody)["connection_secret"].(string)
	if rotated == "" || rotated == firstSecret {
		t.Fatalf("rotated secret = %q, first = %q", rotated, firstSecret)
	}

	disableResp, disableBody := postJSON(t, server, "/api/client/apps/"+appID+"/disable", map[string]any{}, ownerCookie)
	if disableResp.StatusCode != http.StatusOK || requireSuccess(t, disableBody)["app"].(map[string]any)["enabled"] != false {
		t.Fatalf("disable status = %d, body = %#v", disableResp.StatusCode, disableBody)
	}
	enableResp, enableBody := postJSON(t, server, "/api/client/apps/"+appID+"/enable", map[string]any{}, ownerCookie)
	if enableResp.StatusCode != http.StatusOK || requireSuccess(t, enableBody)["app"].(map[string]any)["enabled"] != true {
		t.Fatalf("enable status = %d, body = %#v", enableResp.StatusCode, enableBody)
	}

	deleteResp, deleteBody := requestJSON(t, server, http.MethodDelete, "/api/client/apps/"+appID, map[string]any{}, ownerCookie)
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("delete status = %d, body = %#v", deleteResp.StatusCode, deleteBody)
	}
	getDeletedResp, _ := getJSON(t, server, "/api/client/apps/"+appID, ownerCookie)
	if getDeletedResp.StatusCode != http.StatusNotFound {
		t.Fatalf("get deleted status = %d, want 404", getDeletedResp.StatusCode)
	}
}
