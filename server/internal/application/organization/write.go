package organization

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type UnitInput struct {
	ParentID     string  `json:"parent_id"`
	Name         string  `json:"name"`
	Kind         string  `json:"kind"`
	LeaderUserID *string `json:"leader_user_id"`
	SortOrder    int     `json:"sort_order"`
}

type DepartmentInput struct {
	Leaders   *[]Leader `json:"leaders,omitempty"`
	UnitID    string    `json:"unit_id"`
	ParentID  string    `json:"parent_id"`
	Name      string    `json:"name"`
	SortOrder int       `json:"sort_order"`
}

func (s *Service) CreateUnit(ctx context.Context, actor string, input UnitInput) (Unit, error) {
	name := validName(input.Name)
	if name == "" || !validUnitKind(input.Kind) {
		return Unit{}, ErrInvalid
	}
	parentID := strings.TrimSpace(input.ParentID)
	if parentID == "" {
		parentID = store.RootOrganizationUnitID
	}
	if !validID(parentID) {
		return Unit{}, ErrInvalid
	}
	if input.LeaderUserID != nil && !validID(*input.LeaderUserID) {
		return Unit{}, ErrInvalid
	}
	now := time.Now().UTC()
	unit := store.OrganizationUnit{ID: uuid.NewString(), ParentID: &parentID, Name: name, Kind: input.Kind, LeaderUserID: input.LeaderUserID, SortOrder: input.SortOrder, CreatedAt: now, UpdatedAt: now}
	dept := store.OrganizationDepartment{ID: uuid.NewString(), UnitID: unit.ID, Name: "", IsRoot: true, CreatedAt: now, UpdatedAt: now}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOrganizationStructure(tx); err != nil {
			return err
		}
		var parent store.OrganizationUnit
		if err := tx.First(&parent, "id = ?", parentID).Error; err != nil {
			return classifyNotFound(err)
		}
		if parent.DisabledAt != nil {
			return ErrConflict
		}
		if err := requireActiveUser(tx, input.LeaderUserID); err != nil {
			return err
		}
		if err := tx.Create(&unit).Error; err != nil {
			return err
		}
		if err := tx.Create(&dept).Error; err != nil {
			return err
		}
		if err := ensureUnitLeaderMembership(ctx, tx, actor, unit.ID, unit.LeaderUserID); err != nil {
			return err
		}
		return audit(tx, actor, "unit.create", "unit", unit.ID, nil, unit)
	})
	if err != nil {
		return Unit{}, err
	}
	return Unit{ID: unit.ID, ParentID: unit.ParentID, Name: unit.Name, Kind: unit.Kind, LeaderUserID: unit.LeaderUserID, SortOrder: unit.SortOrder}, nil
}

func (s *Service) UpdateUnit(ctx context.Context, actor, id string, input UnitInput) error {
	if id == store.RootOrganizationUnitID || !validID(id) || !validUnitKind(input.Kind) || validName(input.Name) == "" {
		return ErrInvalid
	}
	parentID := strings.TrimSpace(input.ParentID)
	if !validID(parentID) || parentID == id {
		return ErrInvalid
	}
	if input.LeaderUserID != nil && !validID(*input.LeaderUserID) {
		return ErrInvalid
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOrganizationStructure(tx); err != nil {
			return err
		}
		var value store.OrganizationUnit
		if err := tx.First(&value, "id = ?", id).Error; err != nil {
			return classifyNotFound(err)
		}
		before := value
		var parent store.OrganizationUnit
		if err := tx.First(&parent, "id = ?", parentID).Error; err != nil {
			return classifyNotFound(err)
		}
		if parent.DisabledAt != nil {
			return ErrConflict
		}
		if err := ensureUnitNotDescendant(tx, id, parentID); err != nil {
			return err
		}
		if err := requireActiveUser(tx, input.LeaderUserID); err != nil {
			return err
		}
		value.ParentID, value.Name, value.Kind, value.LeaderUserID, value.SortOrder = &parentID, validName(input.Name), input.Kind, input.LeaderUserID, input.SortOrder
		value.UpdatedAt = time.Now().UTC()
		if err := tx.Save(&value).Error; err != nil {
			return err
		}
		if err := ensureUnitLeaderMembership(ctx, tx, actor, id, input.LeaderUserID); err != nil {
			return err
		}
		return audit(tx, actor, "unit.update", "unit", id, before, value)
	})
}

func (s *Service) DeleteUnit(ctx context.Context, actor, id string) error {
	if id == store.RootOrganizationUnitID || !validID(id) {
		return ErrInvalid
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOrganizationStructure(tx); err != nil {
			return err
		}
		var value store.OrganizationUnit
		if err := tx.First(&value, "id = ?", id).Error; err != nil {
			return classifyNotFound(err)
		}
		var children, assignments, departments int64
		if err := tx.Model(&store.OrganizationUnit{}).Where("parent_id = ?", id).Count(&children).Error; err != nil {
			return err
		}
		if err := tx.Table("organization_assignments AS a").Joins("JOIN organization_departments AS d ON d.id = a.department_id").Where("d.unit_id = ?", id).Count(&assignments).Error; err != nil {
			return err
		}
		if err := tx.Model(&store.OrganizationDepartment{}).Where("unit_id = ? AND is_root = ?", id, false).Count(&departments).Error; err != nil {
			return err
		}
		if children > 0 || assignments > 0 || departments > 0 {
			return ErrConflict
		}
		if err := tx.Where("unit_id = ?", id).Delete(&store.OrganizationDepartment{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&value).Error; err != nil {
			return err
		}
		return audit(tx, actor, "unit.delete", "unit", id, value, nil)
	})
}

func (s *Service) SetUnitLeader(ctx context.Context, actor, id string, leaderUserID *string) error {
	if !validID(id) || (leaderUserID != nil && !validID(*leaderUserID)) {
		return ErrInvalid
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var value store.OrganizationUnit
		if err := tx.First(&value, "id = ?", id).Error; err != nil {
			return classifyNotFound(err)
		}
		before := value
		if err := requireActiveUser(tx, leaderUserID); err != nil {
			return err
		}
		value.LeaderUserID = leaderUserID
		value.UpdatedAt = time.Now().UTC()
		if err := tx.Model(&store.OrganizationUnit{}).Where("id = ?", id).Updates(map[string]any{"leader_user_id": leaderUserID, "updated_at": value.UpdatedAt}).Error; err != nil {
			return err
		}
		if err := ensureUnitLeaderMembership(ctx, tx, actor, id, leaderUserID); err != nil {
			return err
		}
		return audit(tx, actor, "unit.leader", "unit", id, before, value)
	})
}

func (s *Service) CreateDepartment(ctx context.Context, actor string, input DepartmentInput) (Department, error) {
	name := validName(input.Name)
	if !validID(input.UnitID) || !validID(input.ParentID) || name == "" {
		return Department{}, ErrInvalid
	}
	now := time.Now().UTC()
	value := store.OrganizationDepartment{ID: uuid.NewString(), UnitID: input.UnitID, ParentID: &input.ParentID, Name: name, SortOrder: input.SortOrder, CreatedAt: now, UpdatedAt: now}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOrganizationStructure(tx); err != nil {
			return err
		}
		if err := validateDepartmentParent(tx, input.UnitID, input.ParentID); err != nil {
			return err
		}
		if err := uniqueSiblingName(tx, input.ParentID, name, ""); err != nil {
			return err
		}
		if err := tx.Create(&value).Error; err != nil {
			return err
		}
		if input.Leaders != nil {
			if err := NewService(tx).SetDepartmentLeaders(ctx, actor, value.ID, *input.Leaders); err != nil {
				return err
			}
		}
		return audit(tx, actor, "department.create", "department", value.ID, nil, value)
	})
	if err != nil {
		return Department{}, err
	}
	result := Department{ID: value.ID, UnitID: value.UnitID, ParentID: value.ParentID, Name: value.Name, SortOrder: value.SortOrder, Leaders: []Leader{}}
	if input.Leaders != nil {
		result.Leaders = append(result.Leaders, (*input.Leaders)...)
	}
	return result, nil
}

func (s *Service) UpdateDepartment(ctx context.Context, actor, id string, input DepartmentInput) error {
	if !validID(id) || !validID(input.UnitID) || !validID(input.ParentID) || id == input.ParentID || validName(input.Name) == "" {
		return ErrInvalid
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOrganizationStructure(tx); err != nil {
			return err
		}
		var value store.OrganizationDepartment
		if err := tx.First(&value, "id = ?", id).Error; err != nil {
			return classifyNotFound(err)
		}
		if value.IsRoot {
			return ErrInvalid
		}
		before := value
		if err := validateDepartmentParent(tx, input.UnitID, input.ParentID); err != nil {
			return err
		}
		if err := ensureDepartmentNotDescendant(tx, id, input.ParentID); err != nil {
			return err
		}
		if err := uniqueSiblingName(tx, input.ParentID, validName(input.Name), id); err != nil {
			return err
		}
		if value.UnitID != input.UnitID {
			ids, err := departmentSubtreeIDs(tx, id)
			if err != nil {
				return err
			}
			if err := tx.Model(&store.OrganizationDepartment{}).Where("id IN ?", ids).Update("unit_id", input.UnitID).Error; err != nil {
				return err
			}
		}
		value.UnitID, value.ParentID, value.Name, value.SortOrder = input.UnitID, &input.ParentID, validName(input.Name), input.SortOrder
		value.UpdatedAt = time.Now().UTC()
		if err := tx.Save(&value).Error; err != nil {
			return err
		}
		if err := audit(tx, actor, "department.update", "department", id, before, value); err != nil {
			return err
		}
		if input.Leaders != nil {
			return NewService(tx).SetDepartmentLeaders(ctx, actor, id, *input.Leaders)
		}
		return nil
	})
}

func departmentSubtreeIDs(tx *gorm.DB, rootID string) ([]string, error) {
	ids := []string{rootID}
	for index := 0; index < len(ids); index++ {
		var children []string
		if err := tx.Model(&store.OrganizationDepartment{}).Where("parent_id = ?", ids[index]).Pluck("id", &children).Error; err != nil {
			return nil, err
		}
		ids = append(ids, children...)
		if len(ids) > 10000 {
			return nil, ErrConflict
		}
	}
	return ids, nil
}

func (s *Service) DeleteDepartment(ctx context.Context, actor, id string) error {
	if !validID(id) {
		return ErrInvalid
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOrganizationStructure(tx); err != nil {
			return err
		}
		var value store.OrganizationDepartment
		if err := tx.First(&value, "id = ?", id).Error; err != nil {
			return classifyNotFound(err)
		}
		if value.IsRoot {
			return ErrInvalid
		}
		var children, assignments int64
		if err := tx.Model(&store.OrganizationDepartment{}).Where("parent_id = ?", id).Count(&children).Error; err != nil {
			return err
		}
		if err := tx.Model(&store.OrganizationAssignment{}).Where("department_id = ?", id).Count(&assignments).Error; err != nil {
			return err
		}
		if children > 0 || assignments > 0 {
			return ErrConflict
		}
		if err := tx.Where("department_id = ?", id).Delete(&store.OrganizationDepartmentLeader{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&value).Error; err != nil {
			return err
		}
		return audit(tx, actor, "department.delete", "department", id, value, nil)
	})
}

func (s *Service) SetDepartmentLeaders(ctx context.Context, actor, departmentID string, input []Leader) error {
	if !validID(departmentID) {
		return ErrInvalid
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var dept store.OrganizationDepartment
		if err := tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).First(&dept, "id = ?", departmentID).Error; err != nil {
			return classifyNotFound(err)
		}
		var before []store.OrganizationDepartmentLeader
		if err := tx.Where("department_id = ?", departmentID).Find(&before).Error; err != nil {
			return err
		}
		seen, primary := map[string]bool{}, 0
		for _, leader := range input {
			if !validID(leader.UserID) || seen[leader.UserID] {
				return ErrInvalid
			}
			seen[leader.UserID] = true
			if leader.IsPrimary {
				primary++
			}
			id := leader.UserID
			if err := requireActiveUser(tx, &id); err != nil {
				return err
			}
		}
		if (len(input) > 0 && primary != 1) || primary > 1 {
			return ErrInvalid
		}
		if err := tx.Where("department_id = ?", departmentID).Delete(&store.OrganizationDepartmentLeader{}).Error; err != nil {
			return err
		}
		after := make([]store.OrganizationDepartmentLeader, 0, len(input))
		for _, leader := range input {
			after = append(after, store.OrganizationDepartmentLeader{DepartmentID: departmentID, UserID: leader.UserID, IsPrimary: leader.IsPrimary})
		}
		if len(after) > 0 {
			if err := tx.Create(&after).Error; err != nil {
				return err
			}
		}
		ids := make([]string, 0, len(seen))
		for id := range seen {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			if err := ensureLeaderMembership(ctx, tx, actor, dept, id); err != nil {
				return err
			}
		}
		return audit(tx, actor, "department.leaders", "department", departmentID, before, after)
	})
}

// Serialize hierarchy validation and mutation across all server instances.
// A transaction-scoped lock is released on both commit and rollback.
func lockOrganizationStructure(tx *gorm.DB) error {
	if tx.Dialector.Name() == "postgres" {
		return tx.Exec("SELECT pg_advisory_xact_lock(?)", int64(740831520)).Error
	}
	return nil
}

func validUnitKind(kind string) bool { return kind == "subsidiary" || kind == "business_unit" }
func validID(id string) bool         { _, err := uuid.Parse(strings.TrimSpace(id)); return err == nil }

func classifyNotFound(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNotFound
	}
	return err
}

func requireActiveUser(tx *gorm.DB, id *string) error {
	if id == nil {
		return nil
	}
	var user store.User
	if err := tx.First(&user, "id = ?", *id).Error; err != nil {
		return classifyNotFound(err)
	}
	if user.Status != store.UserStatusActive {
		return ErrConflict
	}
	return nil
}

func ensureUnitNotDescendant(tx *gorm.DB, id, parentID string) error {
	seen := map[string]bool{}
	for parentID != "" {
		if parentID == id || seen[parentID] {
			return ErrInvalid
		}
		seen[parentID] = true
		var unit store.OrganizationUnit
		if err := tx.First(&unit, "id = ?", parentID).Error; err != nil {
			return classifyNotFound(err)
		}
		if unit.ParentID == nil {
			break
		}
		parentID = *unit.ParentID
	}
	return nil
}

func ensureDepartmentNotDescendant(tx *gorm.DB, id, parentID string) error {
	seen := map[string]bool{}
	for parentID != "" {
		if parentID == id || seen[parentID] {
			return ErrInvalid
		}
		seen[parentID] = true
		var dept store.OrganizationDepartment
		if err := tx.First(&dept, "id = ?", parentID).Error; err != nil {
			return classifyNotFound(err)
		}
		if dept.ParentID == nil {
			break
		}
		parentID = *dept.ParentID
	}
	return nil
}

func validateDepartmentParent(tx *gorm.DB, unitID, parentID string) error {
	var parent store.OrganizationDepartment
	if err := tx.First(&parent, "id = ?", parentID).Error; err != nil {
		return classifyNotFound(err)
	}
	if parent.UnitID != unitID {
		return ErrInvalid
	}
	var unit store.OrganizationUnit
	if err := tx.First(&unit, "id = ?", unitID).Error; err != nil {
		return classifyNotFound(err)
	}
	if unit.DisabledAt != nil {
		return ErrConflict
	}
	return nil
}

func uniqueSiblingName(tx *gorm.DB, parentID, name, excludeID string) error {
	query := tx.Model(&store.OrganizationDepartment{}).Where("parent_id = ? AND LOWER(name) = LOWER(?)", parentID, name)
	if excludeID != "" {
		query = query.Where("id <> ?", excludeID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrConflict
	}
	return nil
}

func audit(tx *gorm.DB, actor, action, targetType, targetID string, before, after any) error {
	beforeJSON, err := json.Marshal(before)
	if err != nil {
		return err
	}
	afterJSON, err := json.Marshal(after)
	if err != nil {
		return err
	}
	return tx.Create(&store.OrganizationAuditEvent{ID: uuid.NewString(), Actor: actor, Action: action, TargetType: targetType, TargetID: targetID, Before: beforeJSON, After: afterJSON, CreatedAt: time.Now().UTC()}).Error
}
