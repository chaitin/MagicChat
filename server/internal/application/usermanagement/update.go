package usermanagement

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"app/internal/application/organization"
	"app/internal/store"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *Service) Update(ctx context.Context, cmd UpdateCommand) (User, error) {
	storedUser, err := s.find(ctx, cmd.UserID)
	if err != nil {
		return User{}, err
	}
	email, err := normalizeEmail(cmd.Email)
	if err != nil || len(email) > 320 {
		return User{}, newError(CodeInvalidRequest, "邮箱格式错误", err)
	}
	name, nickname := strings.TrimSpace(cmd.Name), strings.TrimSpace(cmd.Nickname)
	if name == "" || utf8.RuneCountInString(name) > 120 {
		return User{}, newError(CodeInvalidRequest, "姓名不能为空且不能超过 120 个字符", nil)
	}
	if utf8.RuneCountInString(nickname) > 120 {
		return User{}, newError(CodeInvalidRequest, "昵称不能超过 120 个字符", nil)
	}
	phone, err := normalizePhone(cmd.Phone)
	if err != nil {
		return User{}, newError(CodeInvalidRequest, "手机号格式错误", err)
	}
	var jobTitle string
	if cmd.JobTitle != nil {
		jobTitle = strings.TrimSpace(*cmd.JobTitle)
		if utf8.RuneCountInString(jobTitle) > 160 {
			return User{}, newError(CodeInvalidRequest, "职务不能超过 160 个字符", nil)
		}
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Acquire the reporting graph lock before the member row lock.
		// Nested organization transactions use savepoints on this same transaction.
		org := organization.NewService(tx)
		if cmd.Reporting != nil {
			if _, err := org.SetReporting(ctx, cmd.Actor, storedUser.ID, *cmd.Reporting); err != nil {
				return err
			}
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&storedUser, "id = ?", storedUser.ID).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&store.User{}).Where("id <> ? AND email = ?", storedUser.ID, email).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return newError(CodeConflict, "邮箱已存在", nil)
		}
		if phone != nil {
			if err := tx.Model(&store.User{}).Where("id <> ? AND phone = ?", storedUser.ID, *phone).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return newError(CodeConflict, "手机号已存在", nil)
			}
		}
		updates := map[string]any{"name": name, "nickname": nickname, "email": email, "phone": phone, "updated_at": s.now().UTC()}
		if cmd.JobTitle != nil {
			updates["job_title"] = jobTitle
		}
		if err := tx.Model(&storedUser).Updates(updates).Error; err != nil {
			return err
		}
		if cmd.Assignments != nil {
			if _, err := org.SetAssignments(ctx, cmd.Actor, storedUser.ID, *cmd.Assignments); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if _, ok := err.(*Error); ok {
			return User{}, err
		}
		switch {
		case errors.Is(err, organization.ErrInvalid):
			return User{}, newError(CodeInvalidRequest, "组织归属或汇报关系参数无效，请检查所属部门和主归属", err)
		case errors.Is(err, organization.ErrNotFound):
			return User{}, newError(CodeNotFound, "所选部门或上级不存在，请刷新后重试", err)
		case errors.Is(err, organization.ErrConflict):
			return User{}, newError(CodeConflict, "组织关系冲突，请检查账号状态、单位状态或汇报关系是否成环", err)
		}
		if isUniqueConstraintError(err) {
			return User{}, newError(CodeConflict, "邮箱或手机号已存在", err)
		}
		return User{}, internalError(err)
	}
	if s.profileNotifications != nil {
		s.profileNotifications.PublishUserProfileUpdated(ctx, storedUser.ID, storedUser.UpdatedAt)
	}
	if (cmd.Assignments != nil || cmd.Reporting != nil || cmd.JobTitle != nil) && s.organizationChanged != nil {
		s.organizationChanged()
	}
	return newUser(storedUser, s.isOnline(storedUser.ID)), nil
}

// Fetch primary memberships and the single member-level job title for this page.
func (s *Service) primaryOrganizations(ctx context.Context, userIDs []string) (map[string]*UserOrganization, error) {
	var rows []struct {
		UserID         string
		UnitName       string
		DepartmentName string
		Title          string
	}
	err := s.db.WithContext(ctx).Table("organization_assignments AS a").
		Joins("JOIN users AS member ON member.id = a.user_id").
		Joins("JOIN organization_departments AS d ON d.id = a.department_id").
		Joins("JOIN organization_units AS u ON u.id = d.unit_id").
		Joins("LEFT JOIN app_settings AS settings ON settings.id = ?", store.AppSettingsID).
		Where("a.user_id IN ? AND a.is_primary = ?", userIDs, true).
		Select("a.user_id, CASE WHEN u.id = ? THEN COALESCE(settings.organization_name, u.name) ELSE u.name END AS unit_name, CASE WHEN d.is_root THEN '' ELSE d.name END AS department_name, member.job_title AS title", store.RootOrganizationUnitID).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[string]*UserOrganization, len(rows))
	for _, row := range rows {
		result[row.UserID] = &UserOrganization{UnitName: row.UnitName, DepartmentName: row.DepartmentName, Title: row.Title}
	}
	return result, nil
}
