package client

import (
	"context"
	"net/http"
	"time"

	contactapp "app/internal/application/contact"

	"github.com/labstack/echo/v4"
)

type ContactAPI struct {
	contacts contactapp.ClientService
}

type contactAppResponse struct {
	Avatar        string  `json:"avatar" example:"/assets/apps/assistant.webp"`
	CreatorUserID *string `json:"creator_user_id"`
	Description   string  `json:"description" example:"AI 助手"`
	ID            string  `json:"id" example:"7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"`
	Name          string  `json:"name" example:"茉莉"`
	Online        bool    `json:"online" example:"false"`
	Type          string  `json:"type" example:"app"`
}

type contactGroupResponse struct {
	Avatar        string                             `json:"avatar" example:"/assets/avatars/groups/07.webp"`
	AvatarMembers []contactGroupAvatarMemberResponse `json:"avatar_members,omitempty"`
	ID            string                             `json:"id" example:"7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"`
	Joined        bool                               `json:"joined" example:"false"`
	MemberCount   int                                `json:"member_count" example:"8"`
	Name          string                             `json:"name" example:"IM探索"`
	Type          string                             `json:"type" example:"group"`
	Visibility    string                             `json:"visibility" example:"public"`
}

type contactGroupAvatarMemberResponse struct {
	Avatar   string `json:"avatar,omitempty"`
	ID       string `json:"id"`
	Name     string `json:"name,omitempty"`
	Nickname string `json:"nickname,omitempty"`
	Role     string `json:"role"`
	Type     string `json:"type"`
}

type resolveUsersRequest struct {
	UserIDs []string `json:"user_ids" validate:"max=500"`
}

type resolveUsersResponse struct {
	Users []contactUserResponse `json:"users"`
}

type createFriendRequestRequest struct {
	UserID string `json:"user_id"`
}

type searchContactUsersRequest struct {
	Query string `json:"query"`
}

type friendRequestResponse struct {
	ID              string     `json:"id"`
	RequesterUserID string     `json:"requester_user_id"`
	AddresseeUserID string     `json:"addressee_user_id"`
	Status          string     `json:"status"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	HandledAt       *time.Time `json:"handled_at"`
}

type listFriendRequestsResponse struct {
	Requests []friendRequestResponse `json:"requests"`
}

type searchContactUsersResponse struct {
	UserIDs []string `json:"user_ids"`
}

type deleteFriendResponse struct {
	UserID string `json:"user_id"`
}

type contactUserResponse struct {
	Avatar       string    `json:"avatar" example:"/assets/avatars/builtin/07.webp"`
	Email        string    `json:"email" example:"user@example.com"`
	ID           string    `json:"id" example:"7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"`
	LastOnlineAt *string   `json:"last_online_at" example:"2026-07-03T01:00:00Z"`
	Name         string    `json:"name" example:"张三"`
	Nickname     string    `json:"nickname" example:"小张"`
	Online       bool      `json:"online" example:"true"`
	Phone        string    `json:"phone" example:"+8613812345678"`
	Type         string    `json:"type" example:"user"`
	UpdatedAt    time.Time `json:"updated_at" format:"date-time"`
}

type listClientContactsResponse struct {
	Apps          []contactAppResponse   `json:"apps"`
	DirectoryMode string                 `json:"directory_mode" enums:"organization,friends"`
	Groups        []contactGroupResponse `json:"groups"`
	UserIDs       []string               `json:"user_ids"`
}

type listContactUsersResponse struct {
	UserIDs []string `json:"user_ids"`
}

func NewContactAPI(contacts contactapp.ClientService) *ContactAPI {
	return &ContactAPI{contacts: contacts}
}

func (a *ContactAPI) RegisterRoutes(group *echo.Group) {
	group.GET("/contacts", a.list)
	group.GET("/contacts/users", a.listUsers)
	group.POST("/users/resolve", a.resolveUsers)
	group.POST("/users/search", a.searchUsers)
	group.GET("/friend-requests", a.listFriendRequests)
	group.POST("/friend-requests", a.createFriendRequest)
	group.POST("/friend-requests/:request_id/accept", a.acceptFriendRequest)
	group.POST("/friend-requests/:request_id/reject", a.rejectFriendRequest)
	group.DELETE("/friend-requests/:request_id", a.cancelFriendRequest)
	group.DELETE("/friends/:user_id", a.deleteFriend)
}

// list godoc
//
// @Summary 列出通讯录
// @Description 普通用户获取统一通讯录。返回对当前用户可见的应用、启用用户，以及当前用户已加入或公开的 active 群组。
// @Tags 客户端通讯录
// @Produce json
// @Success 200 {object} successEnvelope{data=listClientContactsResponse}
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/contacts [get]
func (a *ContactAPI) list(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(contactapp.CodeInternal), "服务端错误")
	}
	result, err := a.contacts.List(c.Request().Context(), contactapp.ListCommand{
		AccountID: current.ID,
		Keyword:   c.QueryParam("keyword"),
	})
	if err != nil {
		return writeContactError(c, err)
	}
	return writeSuccess(c, http.StatusOK, listClientContactsResponse{
		Apps: newContactAppsResponse(result.Apps), DirectoryMode: result.DirectoryMode,
		Groups: newContactGroupsResponse(result.Groups), UserIDs: contactUserIDs(result.Users),
	})
}

// listUsers godoc
//
// @Summary 列出通讯录用户
// @Description 普通用户获取通讯录用户 ID。返回所有启用用户，包含当前用户；keyword 会搜索名称、昵称、邮箱和手机号。
// @Tags 客户端通讯录
// @Produce json
// @Param keyword query string false "搜索关键字，匹配名称、昵称、邮箱或手机号"
// @Success 200 {object} successEnvelope{data=listContactUsersResponse}
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/contacts/users [get]
func (a *ContactAPI) listUsers(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(contactapp.CodeInternal), "服务端错误")
	}
	result, err := a.contacts.ListUsers(c.Request().Context(), contactapp.ListUsersCommand{AccountID: current.ID, Keyword: c.QueryParam("keyword")})
	if err != nil {
		return writeContactError(c, err)
	}
	return writeSuccess(c, http.StatusOK, listContactUsersResponse{UserIDs: contactUserIDs(result.Users)})
}

// resolveUsers godoc
//
// @Summary 批量解析用户资料
// @Description 根据用户 ID 批量返回启用用户的资料，每次最多 500 个。
// @Tags 客户端通讯录
// @Accept json
// @Produce json
// @Param request body resolveUsersRequest true "用户 ID"
// @Success 200 {object} successEnvelope{data=resolveUsersResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/users/resolve [post]
func (a *ContactAPI) resolveUsers(c echo.Context) error {
	var request resolveUsersRequest
	if err := c.Bind(&request); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(contactapp.CodeInvalidRequest), "请求格式错误")
	}
	result, err := a.contacts.ResolveUsers(c.Request().Context(), contactapp.ResolveUsersCommand{UserIDs: request.UserIDs})
	if err != nil {
		return writeContactError(c, err)
	}
	return writeSuccess(c, http.StatusOK, resolveUsersResponse{Users: newContactUsersResponse(result.Users)})
}

// searchUsers godoc
//
// @Summary 精确查找用户
// @Description 使用完整邮箱、手机号或用户 ID 精确查找启用用户。
// @Tags 客户端好友
// @Accept json
// @Produce json
// @Param request body searchContactUsersRequest true "查找条件"
// @Success 200 {object} successEnvelope{data=searchContactUsersResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Router /api/client/users/search [post]
func (a *ContactAPI) searchUsers(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(contactapp.CodeInternal), "服务端错误")
	}
	var request searchContactUsersRequest
	if err := c.Bind(&request); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(contactapp.CodeInvalidRequest), "请求格式错误")
	}
	result, err := a.contacts.SearchUsers(c.Request().Context(), contactapp.SearchUsersCommand{AccountID: current.ID, Query: request.Query})
	if err != nil {
		return writeContactError(c, err)
	}
	return writeSuccess(c, http.StatusOK, searchContactUsersResponse{UserIDs: result.UserIDs})
}

// listFriendRequests godoc
//
// @Summary 列出好友申请
// @Tags 客户端好友
// @Produce json
// @Param direction query string true "申请方向" Enums(incoming,outgoing)
// @Success 200 {object} successEnvelope{data=listFriendRequestsResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Router /api/client/friend-requests [get]
func (a *ContactAPI) listFriendRequests(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(contactapp.CodeInternal), "服务端错误")
	}
	result, err := a.contacts.ListFriendRequests(c.Request().Context(), contactapp.ListFriendRequestsCommand{
		AccountID: current.ID, Direction: c.QueryParam("direction"),
	})
	if err != nil {
		return writeContactError(c, err)
	}
	return writeSuccess(c, http.StatusOK, listFriendRequestsResponse{Requests: newFriendRequestsResponse(result.Requests)})
}

// createFriendRequest godoc
//
// @Summary 发送好友申请
// @Description 若对方已有一条反向待处理申请，则自动建立好友关系；好友通讯录模式下同时创建或更新双方私聊，并写入好友建立系统消息。
// @Tags 客户端好友
// @Accept json
// @Produce json
// @Param request body createFriendRequestRequest true "目标用户"
// @Success 201 {object} successEnvelope{data=friendRequestResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Router /api/client/friend-requests [post]
func (a *ContactAPI) createFriendRequest(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(contactapp.CodeInternal), "服务端错误")
	}
	var request createFriendRequestRequest
	if err := c.Bind(&request); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(contactapp.CodeInvalidRequest), "请求格式错误")
	}
	result, err := a.contacts.CreateFriendRequest(c.Request().Context(), contactapp.CreateFriendRequestCommand{AccountID: current.ID, UserID: request.UserID})
	if err != nil {
		return writeContactError(c, err)
	}
	return writeSuccess(c, http.StatusCreated, newFriendRequestResponse(result))
}

// acceptFriendRequest godoc
//
// @Summary 接受好友申请
// @Description 建立好友关系；好友通讯录模式下同时创建或更新双方私聊，并写入好友建立系统消息。
// @Tags 客户端好友
// @Produce json
// @Param request_id path string true "申请 ID"
// @Success 200 {object} successEnvelope{data=friendRequestResponse}
// @Failure 404 {object} errorEnvelope
// @Router /api/client/friend-requests/{request_id}/accept [post]
func (a *ContactAPI) acceptFriendRequest(c echo.Context) error {
	return a.updateFriendRequest(c, a.contacts.AcceptFriendRequest)
}

// rejectFriendRequest godoc
//
// @Summary 拒绝好友申请
// @Tags 客户端好友
// @Produce json
// @Param request_id path string true "申请 ID"
// @Success 200 {object} successEnvelope{data=friendRequestResponse}
// @Failure 404 {object} errorEnvelope
// @Router /api/client/friend-requests/{request_id}/reject [post]
func (a *ContactAPI) rejectFriendRequest(c echo.Context) error {
	return a.updateFriendRequest(c, a.contacts.RejectFriendRequest)
}

// cancelFriendRequest godoc
//
// @Summary 取消好友申请
// @Tags 客户端好友
// @Produce json
// @Param request_id path string true "申请 ID"
// @Success 200 {object} successEnvelope{data=friendRequestResponse}
// @Failure 404 {object} errorEnvelope
// @Router /api/client/friend-requests/{request_id} [delete]
func (a *ContactAPI) cancelFriendRequest(c echo.Context) error {
	return a.updateFriendRequest(c, a.contacts.CancelFriendRequest)
}

func (a *ContactAPI) updateFriendRequest(c echo.Context, update func(context.Context, contactapp.UpdateFriendRequestCommand) (contactapp.FriendRequest, error)) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(contactapp.CodeInternal), "服务端错误")
	}
	result, err := update(c.Request().Context(), contactapp.UpdateFriendRequestCommand{AccountID: current.ID, RequestID: c.Param("request_id")})
	if err != nil {
		return writeContactError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newFriendRequestResponse(result))
}

// deleteFriend godoc
//
// @Summary 删除好友
// @Tags 客户端好友
// @Produce json
// @Param user_id path string true "好友用户 ID"
// @Success 200 {object} successEnvelope{data=deleteFriendResponse}
// @Failure 404 {object} errorEnvelope
// @Router /api/client/friends/{user_id} [delete]
func (a *ContactAPI) deleteFriend(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(contactapp.CodeInternal), "服务端错误")
	}
	userID := c.Param("user_id")
	if err := a.contacts.DeleteFriend(c.Request().Context(), contactapp.DeleteFriendCommand{AccountID: current.ID, UserID: userID}); err != nil {
		return writeContactError(c, err)
	}
	return writeSuccess(c, http.StatusOK, deleteFriendResponse{UserID: userID})
}

func newFriendRequestResponse(value contactapp.FriendRequest) friendRequestResponse {
	return friendRequestResponse{
		ID: value.ID, RequesterUserID: value.RequesterUserID, AddresseeUserID: value.AddresseeUserID,
		Status: value.Status, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt, HandledAt: value.HandledAt,
	}
}

func newFriendRequestsResponse(values []contactapp.FriendRequest) []friendRequestResponse {
	result := make([]friendRequestResponse, 0, len(values))
	for _, value := range values {
		result = append(result, newFriendRequestResponse(value))
	}
	return result
}

func newContactAppsResponse(values []contactapp.App) []contactAppResponse {
	result := make([]contactAppResponse, 0, len(values))
	for _, value := range values {
		result = append(result, contactAppResponse{
			Avatar: value.Avatar, CreatorUserID: value.CreatorUserID, Description: value.Description, ID: value.ID,
			Name: value.Name, Online: value.Online, Type: value.Type,
		})
	}
	return result
}

func newContactGroupsResponse(values []contactapp.Group) []contactGroupResponse {
	result := make([]contactGroupResponse, 0, len(values))
	for _, value := range values {
		var avatarMembers []contactGroupAvatarMemberResponse
		if value.AvatarMembers != nil {
			avatarMembers = make([]contactGroupAvatarMemberResponse, 0, len(value.AvatarMembers))
			for _, member := range value.AvatarMembers {
				response := contactGroupAvatarMemberResponse{ID: member.ID, Role: member.Role, Type: member.Type}
				if member.Type == contactapp.ContactTypeApp {
					response.Avatar = member.Avatar
					response.Name = member.Name
				}
				avatarMembers = append(avatarMembers, response)
			}
		}
		result = append(result, contactGroupResponse{
			Avatar: value.Avatar, AvatarMembers: avatarMembers, ID: value.ID, Joined: value.Joined,
			MemberCount: value.MemberCount, Name: value.Name, Type: value.Type, Visibility: value.Visibility,
		})
	}
	return result
}

func contactUserIDs(values []contactapp.User) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, value.ID)
	}
	return result
}

func newContactUsersResponse(values []contactapp.User) []contactUserResponse {
	result := make([]contactUserResponse, 0, len(values))
	for _, value := range values {
		var lastOnlineAt *string
		if value.LastOnlineAt != nil {
			formatted := value.LastOnlineAt.UTC().Format(time.RFC3339)
			lastOnlineAt = &formatted
		}
		result = append(result, contactUserResponse{
			Avatar: value.Avatar, Email: value.Email, ID: value.ID, LastOnlineAt: lastOnlineAt,
			Name: value.Name, Nickname: value.Nickname, Online: value.Online, Phone: value.Phone, Type: value.Type, UpdatedAt: value.UpdatedAt,
		})
	}
	return result
}

func writeContactError(c echo.Context, err error) error {
	status := http.StatusInternalServerError
	switch contactapp.ErrorCodeOf(err) {
	case contactapp.CodeInvalidRequest:
		status = http.StatusBadRequest
	case contactapp.CodeNotFound:
		status = http.StatusNotFound
	case contactapp.CodeConflict:
		status = http.StatusConflict
	}
	return writeFailure(c, status, string(contactapp.ErrorCodeOf(err)), contactapp.ErrorMessage(err))
}
