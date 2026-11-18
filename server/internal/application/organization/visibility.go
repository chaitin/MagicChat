package organization

import (
	"context"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
)

type Policy struct {
	VisibilityScope string `json:"visibility_scope"`
}

func (s *Service) Policy(ctx context.Context) (Policy, error) {
	db := s.db.WithContext(ctx)
	// Older in-memory test fixtures do not install the production migrations.
	if !db.Migrator().HasTable(&store.OrganizationPolicy{}) {
		return Policy{VisibilityScope: "all"}, nil
	}
	var value store.OrganizationPolicy
	if err := db.First(&value, "id = ?", 1).Error; err != nil {
		return Policy{}, err
	}
	return Policy{VisibilityScope: value.VisibilityScope}, nil
}

func (s *Service) SetPolicy(ctx context.Context, actor string, input Policy) (Policy, error) {
	if input.VisibilityScope != "all" && input.VisibilityScope != "same_unit" && input.VisibilityScope != "same_department" {
		return Policy{}, ErrInvalid
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var before store.OrganizationPolicy
		if err := tx.First(&before, "id = ?", 1).Error; err != nil {
			return classifyNotFound(err)
		}
		after := before
		after.VisibilityScope = input.VisibilityScope
		after.UpdatedAt = time.Now().UTC()
		if err := tx.Model(&store.OrganizationPolicy{}).Where("id = ?", 1).Updates(map[string]any{
			"visibility_scope": after.VisibilityScope,
			"updated_at":       after.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		return audit(tx, actor, "policy.update", "policy", store.RootOrganizationUnitID, before, after)
	})
	if err != nil {
		return Policy{}, err
	}
	return input, nil
}

// VisibleUserIDs returns nil when every active user is visible. The viewer is
// always included so a restricted directory can still render the own profile.
func (s *Service) VisibleUserIDs(ctx context.Context, viewerID string) ([]string, error) {
	policy, err := s.Policy(ctx)
	if err != nil {
		return nil, err
	}
	if policy.VisibilityScope == "all" || viewerID == "" {
		return nil, nil
	}
	db := s.db.WithContext(ctx)
	if !db.Migrator().HasTable(&store.OrganizationAssignment{}) {
		return nil, nil
	}
	ids := []string{viewerID}
	if policy.VisibilityScope == "same_unit" {
		var units []string
		if err := db.Table("organization_assignments AS a").
			Joins("JOIN organization_departments AS d ON d.id = a.department_id").
			Where("a.user_id = ? AND a.is_primary = ?", viewerID, true).
			Pluck("d.unit_id", &units).Error; err != nil {
			return nil, err
		}
		if len(units) == 0 {
			return ids, nil
		}
		var members []string
		if err := db.Table("organization_assignments AS a").
			Joins("JOIN organization_departments AS d ON d.id = a.department_id").
			Where("d.unit_id = ?", units[0]).Distinct("a.user_id").Pluck("a.user_id", &members).Error; err != nil {
			return nil, err
		}
		return append(ids, members...), nil
	}
	var departments []string
	if err := db.Model(&store.OrganizationAssignment{}).Where("user_id = ?", viewerID).Pluck("department_id", &departments).Error; err != nil {
		return nil, err
	}
	if len(departments) == 0 {
		return ids, nil
	}
	var members []string
	if err := db.Model(&store.OrganizationAssignment{}).Where("department_id IN ?", departments).Distinct("user_id").Pluck("user_id", &members).Error; err != nil {
		return nil, err
	}
	return append(ids, members...), nil
}

func (s *Service) visibleDepartments(ctx context.Context, viewerID string) (map[string]bool, error) {
	policy, err := s.Policy(ctx)
	if err != nil {
		return nil, err
	}
	if policy.VisibilityScope == "all" {
		return nil, nil
	}
	db := s.db.WithContext(ctx)
	result := map[string]bool{}
	if policy.VisibilityScope == "same_unit" {
		var units []string
		if err := db.Table("organization_assignments AS a").Joins("JOIN organization_departments AS d ON d.id = a.department_id").Where("a.user_id = ? AND a.is_primary = ?", viewerID, true).Pluck("d.unit_id", &units).Error; err != nil {
			return nil, err
		}
		if len(units) == 0 {
			return result, nil
		}
		var departments []store.OrganizationDepartment
		if err := db.Where("unit_id = ?", units[0]).Find(&departments).Error; err != nil {
			return nil, err
		}
		for _, department := range departments {
			result[department.ID] = true
		}
		return result, nil
	}
	var viewerAssignments []store.OrganizationAssignment
	if err := db.Where("user_id = ?", viewerID).Find(&viewerAssignments).Error; err != nil {
		return nil, err
	}
	for _, assignment := range viewerAssignments {
		result[assignment.DepartmentID] = true
	}
	return result, nil
}

func (s *Service) SnapshotForViewer(ctx context.Context, viewerID string) (Snapshot, error) {
	settings := store.AppSettings{}
	if err := s.db.WithContext(ctx).First(&settings, "id = ?", store.AppSettingsID).Error; err != nil {
		return Snapshot{}, err
	}
	if settings.ContactDirectoryMode == store.ContactDirectoryModeFriends {
		return Snapshot{Units: []Unit{}, Departments: []Department{}}, nil
	}
	value, err := s.Snapshot(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	allowed, err := s.visibleDepartments(ctx, viewerID)
	if err != nil {
		return Snapshot{}, err
	}
	if err := s.populateMemberCounts(ctx, &value, allowed); err != nil {
		return Snapshot{}, err
	}
	if allowed == nil {
		return value, nil
	}
	byID := map[string]Department{}
	for _, department := range value.Departments {
		byID[department.ID] = department
	}
	for id := range allowed {
		seen := map[string]bool{id: true}
		department := byID[id]
		for department.ParentID != nil {
			parentID := *department.ParentID
			if seen[parentID] {
				return Snapshot{}, ErrConflict
			}
			seen[parentID] = true
			parent, exists := byID[parentID]
			if !exists {
				return Snapshot{}, ErrConflict
			}
			allowed[parentID] = true
			department = parent
		}
	}
	departments := []Department{}
	units := map[string]bool{}
	visibleIDs, err := s.VisibleUserIDs(ctx, viewerID)
	if err != nil {
		return Snapshot{}, err
	}
	visibleUser := map[string]bool{}
	for _, id := range visibleIDs {
		visibleUser[id] = true
	}
	for _, department := range value.Departments {
		if allowed[department.ID] {
			leaders := []Leader{}
			for _, leader := range department.Leaders {
				if visibleUser[leader.UserID] {
					leaders = append(leaders, leader)
				}
			}
			department.Leaders = leaders
			departments = append(departments, department)
			units[department.UnitID] = true
		}
	}
	unitByID := map[string]Unit{}
	for _, unit := range value.Units {
		unitByID[unit.ID] = unit
	}
	for id := range units {
		seen := map[string]bool{id: true}
		unit := unitByID[id]
		for unit.ParentID != nil {
			parentID := *unit.ParentID
			if seen[parentID] {
				return Snapshot{}, ErrConflict
			}
			seen[parentID] = true
			parent, exists := unitByID[parentID]
			if !exists {
				return Snapshot{}, ErrConflict
			}
			units[parentID] = true
			unit = parent
		}
	}
	visibleUnits := []Unit{}
	for _, unit := range value.Units {
		if units[unit.ID] {
			if unit.LeaderUserID != nil && !visibleUser[*unit.LeaderUserID] {
				unit.LeaderUserID = nil
			}
			visibleUnits = append(visibleUnits, unit)
		}
	}
	return Snapshot{Units: visibleUnits, Departments: departments}, nil
}

func (s *Service) MembersForViewer(ctx context.Context, viewerID, departmentID string, page, pageSize int) (MemberPage, error) {
	if friends, err := s.friendsDirectory(ctx); err != nil {
		return MemberPage{}, err
	} else if friends {
		return MemberPage{}, ErrNotFound
	}
	allowed, err := s.visibleDepartments(ctx, viewerID)
	if err != nil {
		return MemberPage{}, err
	}
	if allowed != nil && !allowed[departmentID] {
		visible, err := s.SnapshotForViewer(ctx, viewerID)
		if err != nil {
			return MemberPage{}, err
		}
		for _, department := range visible.Departments {
			if department.ID == departmentID {
				if page < 1 {
					page = 1
				}
				if pageSize < 1 || pageSize > 100 {
					pageSize = 50
				}
				return MemberPage{Members: []Member{}, Total: 0, Page: page, PageSize: pageSize}, nil
			}
		}
		return MemberPage{}, ErrNotFound
	}
	return s.Members(ctx, departmentID, page, pageSize)
}

func (s *Service) AssignmentsForViewer(ctx context.Context, viewerID, userID string) ([]Assignment, error) {
	if friends, err := s.friendsDirectory(ctx); err != nil {
		return nil, err
	} else if friends {
		return nil, ErrNotFound
	}
	visible, err := s.VisibleUserIDs(ctx, viewerID)
	if err != nil {
		return nil, err
	}
	if visible != nil {
		found := false
		for _, id := range visible {
			if id == userID {
				found = true
				break
			}
		}
		if !found {
			return nil, ErrNotFound
		}
	}
	assignments, err := s.Assignments(ctx, userID)
	if err != nil {
		return nil, err
	}
	departments, err := s.visibleDepartments(ctx, viewerID)
	if err != nil {
		return nil, err
	}
	filtered := []Assignment{}
	for _, assignment := range assignments {
		if departments != nil && !departments[assignment.DepartmentID] {
			continue
		}
		filtered = append(filtered, assignment)
	}
	return filtered, nil
}

func (s *Service) friendsDirectory(ctx context.Context) (bool, error) {
	var settings store.AppSettings
	if err := s.db.WithContext(ctx).First(&settings, "id = ?", store.AppSettingsID).Error; err != nil {
		return false, err
	}
	return settings.ContactDirectoryMode == store.ContactDirectoryModeFriends, nil
}
