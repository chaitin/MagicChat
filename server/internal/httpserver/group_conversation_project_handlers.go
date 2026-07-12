package httpserver

import (
	"context"
	"errors"
	"net/http"
	"time"

	"app/internal/store"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errGroupProjectManageForbidden = errors.New("group project manage forbidden")

type conversationProjectResponse struct {
	Avatar      string `json:"avatar"`
	Description string `json:"description"`
	ID          string `json:"id"`
	Name        string `json:"name"`
}

func (s *Server) loadConversationProjects(ctx context.Context, conversationIDs []string) (map[string][]conversationProjectResponse, error) {
	projectsByConversationID := make(map[string][]conversationProjectResponse, len(conversationIDs))
	for _, conversationID := range conversationIDs {
		projectsByConversationID[conversationID] = []conversationProjectResponse{}
	}
	if len(conversationIDs) == 0 {
		return projectsByConversationID, nil
	}

	var rows []struct {
		Avatar         string `gorm:"column:avatar"`
		ConversationID string `gorm:"column:conversation_id"`
		Description    string `gorm:"column:description"`
		Name           string `gorm:"column:name"`
		ProjectID      string `gorm:"column:project_id"`
	}
	if err := s.db.WithContext(ctx).
		Table("project_groups pg").
		Select("pg.conversation_id, p.id AS project_id, p.name, p.avatar, p.description").
		Joins("JOIN projects p ON p.id = pg.project_id AND p.deleted_at IS NULL").
		Where("pg.conversation_id IN ?", conversationIDs).
		Where("p.is_personal = ?", false).
		Order("pg.conversation_id ASC").
		Order("pg.created_at DESC").
		Order("p.id DESC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	for _, row := range rows {
		projectsByConversationID[row.ConversationID] = append(
			projectsByConversationID[row.ConversationID],
			conversationProjectResponse{
				Avatar:      row.Avatar,
				Description: row.Description,
				ID:          row.ProjectID,
				Name:        row.Name,
			},
		)
	}

	return projectsByConversationID, nil
}

// bindGroupConversationProject godoc
//
// @Summary 关联群聊项目
// @Description 群主或群管理员将当前群聊关联到一个可访问的协作项目；重复关联保持成功。
// @Tags 客户端会话
// @Produce json
// @Param conversation_id path string true "群聊 ID"
// @Param project_id path string true "项目 ID"
// @Success 200 {object} successEnvelope{data=projectGroupMutationResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/conversations/{conversation_id}/projects/{project_id} [put]
func (s *Server) bindGroupConversationProject(c echo.Context) error {
	return s.mutateGroupConversationProject(c, true)
}

// unbindGroupConversationProject godoc
//
// @Summary 解除群聊项目关联
// @Description 群主或群管理员解除当前群聊与协作项目的关联；未关联时保持成功。
// @Tags 客户端会话
// @Produce json
// @Param conversation_id path string true "群聊 ID"
// @Param project_id path string true "项目 ID"
// @Success 200 {object} successEnvelope{data=projectGroupMutationResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/conversations/{conversation_id}/projects/{project_id} [delete]
func (s *Server) unbindGroupConversationProject(c echo.Context) error {
	return s.mutateGroupConversationProject(c, false)
}

func (s *Server) mutateGroupConversationProject(c echo.Context, bind bool) error {
	user, ok := currentUser(c)
	if !ok {
		return projectInternalError(c)
	}
	conversationID, err := parseProjectUUID(c.Param("conversation_id"), "群聊 ID 格式错误")
	if err != nil {
		return projectInvalidRequest(c, err.Error())
	}
	projectID, err := parseProjectID(c.Param("project_id"))
	if err != nil {
		return projectInvalidRequest(c, err.Error())
	}

	err = s.db.WithContext(c.Request().Context()).Transaction(func(tx *gorm.DB) error {
		project, _, err := findAccessibleProjectForUpdate(tx, projectID, user.ID)
		if err != nil {
			return err
		}
		if project.IsPersonal {
			return errPersonalProjectGroup
		}
		if err := requireActiveGroupConversationMember(tx, conversationID, user.ID, true, true); err != nil {
			return err
		}

		if bind {
			var existingCount int64
			if err := tx.Model(&store.ProjectGroup{}).
				Where("project_id = ? AND conversation_id = ?", project.ID, conversationID).
				Count(&existingCount).Error; err != nil {
				return err
			}
			if existingCount > 0 {
				return nil
			}
			if err := requireGroupConversationProjectCapacity(tx, conversationID); err != nil {
				return err
			}
			now := time.Now().UTC()
			result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&store.ProjectGroup{
				ProjectID:      project.ID,
				ConversationID: conversationID,
				LinkedByUserID: user.ID,
				CreatedAt:      now,
			})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return nil
			}
			return updateProjectRelationTimestamp(tx, project.ID, now)
		}

		result := tx.Where(
			"project_id = ? AND conversation_id = ?",
			project.ID,
			conversationID,
		).Delete(&store.ProjectGroup{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		return updateProjectRelationTimestamp(tx, project.ID, time.Now().UTC())
	})
	if errors.Is(err, errPersonalProjectGroup) {
		return projectInvalidRequest(c, "个人项目不能关联群聊")
	}
	if err != nil {
		return groupConversationProjectFailure(c, err)
	}

	return success(c, http.StatusOK, map[string]any{})
}

func requireActiveGroupConversationMember(db *gorm.DB, conversationID string, userID string, manage bool, lock bool) error {
	conversationQuery := db.Select("id", "kind", "status")
	if lock {
		conversationQuery = conversationQuery.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var conversation store.Conversation
	if err := conversationQuery.First(&conversation, "id = ?", conversationID).Error; err != nil {
		return err
	}
	if conversation.Kind != store.ConversationKindGroup {
		return errConversationNotGroup
	}
	if conversation.Status != store.ConversationStatusActive {
		return errConversationAccessDenied
	}

	memberQuery := db.Where(
		"conversation_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL",
		conversationID,
		store.ConversationMemberTypeUser,
		userID,
	)
	if lock {
		memberQuery = memberQuery.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var member store.ConversationMember
	if err := memberQuery.First(&member).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errConversationAccessDenied
		}
		return err
	}
	if manage && !canManageGroupConversation(member.Role) {
		return errGroupProjectManageForbidden
	}

	return nil
}

func updateProjectRelationTimestamp(tx *gorm.DB, projectID string, updatedAt time.Time) error {
	result := tx.Model(&store.Project{}).
		Where("id = ?", projectID).
		Update("updated_at", updatedAt)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func groupConversationProjectFailure(c echo.Context, err error) error {
	if errors.Is(err, errConversationNotGroup) {
		return projectInvalidRequest(c, "只能管理群聊的关联项目")
	}
	if errors.Is(err, errConversationAccessDenied) {
		return failure(c, http.StatusForbidden, "forbidden", "无权访问群聊")
	}
	if errors.Is(err, errGroupProjectManageForbidden) {
		return failure(c, http.StatusForbidden, "forbidden", "只有群主或管理员可以管理关联项目")
	}
	if errors.Is(err, errGroupConversationProjectCap) {
		return failure(c, http.StatusConflict, "conflict", "群聊关联项目数量已达上限")
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return failure(c, http.StatusNotFound, "not_found", "群聊或项目不存在")
	}
	return projectInternalError(c)
}
