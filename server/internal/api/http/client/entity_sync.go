package client

import (
	"net/http"

	"app/internal/application/entitysync"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type EntitySyncAPI struct{ service *entitysync.Service }

func NewEntitySyncAPI(service *entitysync.Service) *EntitySyncAPI {
	return &EntitySyncAPI{service: service}
}

func (a *EntitySyncAPI) RegisterRoutes(group *echo.Group) {
	group.POST("/entities/resolve", a.resolve)
}

type resolveEntitiesResponse struct {
	Users         []contactUserResponse          `json:"users"`
	Apps          []contactAppResponse           `json:"apps"`
	Groups        []contactGroupResponse         `json:"groups"`
	Conversations []conversationListItemResponse `json:"conversations"`
	Versions      map[string]int64               `json:"versions"`
	Removed       []entitysync.Entity            `json:"removed"`
}

func (a *EntitySyncAPI) resolve(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusUnauthorized, "unauthorized", "请先登录")
	}
	var request struct {
		Entities []entitysync.Entity `json:"entities"`
	}
	if err := c.Bind(&request); err != nil {
		return writeFailure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}
	if len(request.Entities) > 100 {
		return writeFailure(c, http.StatusBadRequest, "invalid_request", "每次最多同步 100 个实体")
	}
	for _, entity := range request.Entities {
		_, parseErr := uuid.Parse(entity.ID)
		if parseErr != nil || (entity.Type != "user" && entity.Type != "app" && entity.Type != "group") {
			return writeFailure(c, http.StatusBadRequest, "invalid_request", "实体格式错误")
		}
	}
	result, err := a.service.Resolve(c.Request().Context(), current.ID, request.Entities)
	if err != nil {
		return writeFailure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	conversations := make([]conversationListItemResponse, 0, len(result.Conversations))
	for _, conversation := range result.Conversations {
		conversations = append(conversations, newConversationItemResponse(conversation))
	}
	return writeSuccess(c, http.StatusOK, resolveEntitiesResponse{
		Users: newContactUsersResponse(result.Users), Apps: newContactAppsResponse(result.Apps),
		Groups: newContactGroupsResponse(result.Groups), Conversations: conversations,
		Versions: result.Versions, Removed: result.Removed,
	})
}
