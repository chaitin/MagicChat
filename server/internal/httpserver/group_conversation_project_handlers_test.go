package httpserver

import (
	"net/http"
	"testing"
	"time"

	"app/internal/store"
)

func TestGroupAdminCanManageConversationProjectsAndMembersCanList(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	now := time.Now().UTC()
	groupOwner := insertTestUser(t, db, "group-project-owner@example.com", "Group Owner", store.UserStatusActive, now)
	groupAdmin := insertTestUser(t, db, "group-project-admin@example.com", "Group Admin", store.UserStatusActive, now)
	groupMember := insertTestUser(t, db, "group-project-member@example.com", "Group Member", store.UserStatusActive, now)
	projectOwner := insertTestUser(t, db, "group-project-project-owner@example.com", "Project Owner", store.UserStatusActive, now)

	project := insertProjectFixture(t, db, projectFixtureInput{
		Owner:     projectOwner,
		Name:      "协作项目",
		UpdatedAt: now.Add(-time.Hour),
	})
	accessGroup := insertProjectConversationFixture(t, db, projectConversationFixtureInput{
		Creator: projectOwner,
		Kind:    store.ConversationKindGroup,
		Status:  store.ConversationStatusActive,
		Name:    "已有项目群",
		Now:     now,
		Members: []store.ConversationMember{
			{MemberType: store.ConversationMemberTypeUser, MemberID: projectOwner.ID, Role: store.ConversationMemberRoleOwner},
			{MemberType: store.ConversationMemberTypeUser, MemberID: groupAdmin.ID, Role: store.ConversationMemberRoleMember},
		},
	})
	insertProjectGroupFixture(t, db, project.ID, accessGroup.ID, projectOwner.ID, now)

	targetGroup := insertProjectConversationFixture(t, db, projectConversationFixtureInput{
		Creator: groupOwner,
		Kind:    store.ConversationKindGroup,
		Status:  store.ConversationStatusActive,
		Name:    "目标群聊",
		Now:     now,
		Members: []store.ConversationMember{
			{MemberType: store.ConversationMemberTypeUser, MemberID: groupOwner.ID, Role: store.ConversationMemberRoleOwner},
			{MemberType: store.ConversationMemberTypeUser, MemberID: groupAdmin.ID, Role: store.ConversationMemberRoleAdmin},
			{MemberType: store.ConversationMemberTypeUser, MemberID: groupMember.ID, Role: store.ConversationMemberRoleMember},
		},
	})

	path := "/api/client/conversations/" + targetGroup.ID + "/projects/" + project.ID
	adminCookie := loginAsUser(t, server, groupAdmin.Email)
	bindResp, bindBody := putJSON(t, server, path, map[string]any{}, adminCookie)
	if bindResp.StatusCode != http.StatusOK {
		t.Fatalf("bind status = %d, want 200: %#v", bindResp.StatusCode, bindBody)
	}
	requireSuccess(t, bindBody)
	requireRowCount(t, db, &store.ProjectGroup{}, 1, "project_id = ? AND conversation_id = ?", project.ID, targetGroup.ID)

	memberCookie := loginAsUser(t, server, groupMember.Email)
	listResp, listBody := getJSON(t, server, "/api/client/conversations", memberCookie)
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d, want 200: %#v", listResp.StatusCode, listBody)
	}
	conversations := requireSuccess(t, listBody)["conversations"].([]any)
	var projects []any
	for _, item := range conversations {
		conversation := item.(map[string]any)
		if conversation["id"] == targetGroup.ID {
			projects = conversation["projects"].([]any)
			break
		}
	}
	if len(projects) != 1 || projects[0].(map[string]any)["id"] != project.ID {
		t.Fatalf("listed projects = %#v, want project %s", projects, project.ID)
	}

	forbiddenResp, forbiddenBody := requestJSON(t, server, http.MethodDelete, path, map[string]any{}, memberCookie)
	if forbiddenResp.StatusCode != http.StatusForbidden {
		t.Fatalf("member unbind status = %d, want 403: %#v", forbiddenResp.StatusCode, forbiddenBody)
	}
	requireError(t, forbiddenBody, "forbidden")

	unbindResp, unbindBody := requestJSON(t, server, http.MethodDelete, path, map[string]any{}, adminCookie)
	if unbindResp.StatusCode != http.StatusOK {
		t.Fatalf("unbind status = %d, want 200: %#v", unbindResp.StatusCode, unbindBody)
	}
	requireSuccess(t, unbindBody)
	requireRowCount(t, db, &store.ProjectGroup{}, 0, "project_id = ? AND conversation_id = ?", project.ID, targetGroup.ID)
}

func TestGroupProjectEndpointsRejectNonMembersAndInaccessibleProjects(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	now := time.Now().UTC()
	owner := insertTestUser(t, db, "group-project-reject-owner@example.com", "Owner", store.UserStatusActive, now)
	outsider := insertTestUser(t, db, "group-project-reject-outsider@example.com", "Outsider", store.UserStatusActive, now)
	group := insertProjectConversationFixture(t, db, projectConversationFixtureInput{
		Creator: owner,
		Kind:    store.ConversationKindGroup,
		Status:  store.ConversationStatusActive,
		Name:    "受保护群聊",
		Now:     now,
		Members: []store.ConversationMember{{
			MemberType: store.ConversationMemberTypeUser,
			MemberID:   owner.ID,
			Role:       store.ConversationMemberRoleOwner,
		}},
	})
	project := insertProjectFixture(t, db, projectFixtureInput{Owner: outsider, Name: "不可访问项目", UpdatedAt: now})

	ownerCookie := loginAsUser(t, server, owner.Email)
	bindResp, bindBody := putJSON(
		t,
		server,
		"/api/client/conversations/"+group.ID+"/projects/"+project.ID,
		map[string]any{},
		ownerCookie,
	)
	if bindResp.StatusCode != http.StatusNotFound {
		t.Fatalf("inaccessible project bind status = %d, want 404: %#v", bindResp.StatusCode, bindBody)
	}
	requireError(t, bindBody, "not_found")
}
