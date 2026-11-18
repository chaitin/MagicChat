package organization

import (
	"context"
	"strings"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SetAssignments replaces a member's department memberships atomically while
// preserving the IDs of assignments that remain in the same department.
func (s *Service) SetAssignments(ctx context.Context, actor, userID string, input []AssignmentInput) ([]Assignment, error) {
	if !validID(userID) || len(input) == 0 || len(input) > 20 {
		return nil, ErrInvalid
	}
	userID = canonicalID(userID)
	primaryCount := 0
	seenDepartments := map[string]bool{}
	for _, item := range input {
		if !validID(item.DepartmentID) {
			return nil, ErrInvalid
		}
		if seenDepartments[canonicalID(item.DepartmentID)] {
			return nil, ErrInvalid
		}
		seenDepartments[canonicalID(item.DepartmentID)] = true
		if item.IsPrimary {
			primaryCount++
		}
	}
	if primaryCount != 1 {
		return nil, ErrInvalid
	}

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockActiveMember(tx, userID); err != nil {
			return err
		}
		var existing []store.OrganizationAssignment
		if err := tx.Where("user_id = ?", userID).Find(&existing).Error; err != nil {
			return err
		}
		before := make([]store.OrganizationAssignment, len(existing))
		copy(before, existing)
		byDepartment := map[string]store.OrganizationAssignment{}
		for _, item := range existing {
			byDepartment[item.DepartmentID] = item
		}
		// Clear the old primary before assigning the new one; a partial unique
		// index also protects this invariant outside this service.
		if err := tx.Model(&store.OrganizationAssignment{}).Where("user_id = ? AND is_primary = ?", userID, true).Update("is_primary", false).Error; err != nil {
			return err
		}
		keep := make([]string, 0, len(input))
		now := time.Now().UTC()
		for _, item := range input {
			departmentID := canonicalID(item.DepartmentID)
			var department store.OrganizationDepartment
			if err := tx.First(&department, "id = ?", departmentID).Error; err != nil {
				return classifyNotFound(err)
			}
			var unit store.OrganizationUnit
			if err := tx.First(&unit, "id = ?", department.UnitID).Error; err != nil {
				return classifyNotFound(err)
			}
			if unit.DisabledAt != nil {
				return ErrConflict
			}
			assignment, exists := byDepartment[departmentID]
			if !exists {
				assignment = store.OrganizationAssignment{ID: uuid.NewString(), UserID: userID, DepartmentID: departmentID, CreatedAt: now}
			}
			assignment.IsPrimary = item.IsPrimary
			assignment.SortOrder = item.SortOrder
			assignment.UpdatedAt = now
			if exists {
				if err := tx.Model(&store.OrganizationAssignment{}).Where("id = ?", assignment.ID).Updates(map[string]any{
					"is_primary": assignment.IsPrimary,
					"sort_order": assignment.SortOrder,
					"updated_at": now,
				}).Error; err != nil {
					return err
				}
			} else if err := tx.Create(&assignment).Error; err != nil {
				return err
			}
			keep = append(keep, assignment.ID)
		}
		if err := tx.Where("user_id = ? AND id NOT IN ?", userID, keep).Delete(&store.OrganizationAssignment{}).Error; err != nil {
			return err
		}
		return audit(tx, actor, "member.assignments", "user", userID, before, input)
	})
	if err != nil {
		return nil, err
	}
	return s.Assignments(ctx, userID)
}

func lockActiveMember(tx *gorm.DB, userID string) error {
	// Keep foreign-key KEY SHARE locks compatible while serializing edits of this member.
	var user store.User
	if err := tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).First(&user, "id = ?", userID).Error; err != nil {
		return classifyNotFound(err)
	}
	if user.Status != store.UserStatusActive {
		return ErrConflict
	}
	return nil
}

func ensureUnitLeaderMembership(ctx context.Context, tx *gorm.DB, actor, unitID string, leaderUserID *string) error {
	if leaderUserID == nil {
		return nil
	}
	var root store.OrganizationDepartment
	if err := tx.Where("unit_id = ? AND is_root = ?", unitID, true).First(&root).Error; err != nil {
		return classifyNotFound(err)
	}
	return ensureLeaderMembership(ctx, tx, actor, root, *leaderUserID)
}

func ensureLeaderMembership(ctx context.Context, tx *gorm.DB, actor string, department store.OrganizationDepartment, userID string) error {
	userID = canonicalID(userID)
	// Share the member lock with manual assignment edits so concurrent additions do not overwrite each other.
	if err := lockActiveMember(tx, userID); err != nil {
		return err
	}
	var existing []store.OrganizationAssignment
	if err := tx.Where("user_id = ?", userID).Order("id").Find(&existing).Error; err != nil {
		return err
	}
	for _, item := range existing {
		if item.DepartmentID == department.ID {
			return nil
		}
	}
	if department.IsRoot {
		// A membership in one of the unit's departments already makes this person a unit member.
		var count int64
		if err := tx.Table("organization_assignments AS a").
			Joins("JOIN organization_departments AS d ON d.id = a.department_id").
			Where("a.user_id = ? AND d.unit_id = ?", userID, department.UnitID).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return nil
		}
	}
	input := make([]AssignmentInput, 0, len(existing)+1)
	for _, item := range existing {
		input = append(input, AssignmentInput{DepartmentID: item.DepartmentID, IsPrimary: item.IsPrimary, SortOrder: item.SortOrder})
	}
	input = append(input, AssignmentInput{DepartmentID: department.ID, IsPrimary: len(existing) == 0})
	_, err := NewService(tx).SetAssignments(ctx, actor, userID, input)
	return err
}

func canonicalID(id string) string {
	value, _ := uuid.Parse(strings.TrimSpace(id))
	return value.String()
}
