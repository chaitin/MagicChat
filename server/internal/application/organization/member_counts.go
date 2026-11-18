package organization

import (
	"app/internal/store"
	"context"
)

// populateMemberCounts counts distinct active people, using only memberships the
// viewer may see. Ancestors receive visible descendants, never hidden members.
func (s *Service) populateMemberCounts(ctx context.Context, snapshot *Snapshot, allowed map[string]bool) error {
	type membership struct {
		UserID       string
		DepartmentID string
	}
	var rows []membership
	query := s.db.WithContext(ctx).Table("organization_assignments AS a").
		Select("a.user_id, a.department_id").
		Joins("JOIN users AS u ON u.id = a.user_id").
		Where("u.status = ?", store.UserStatusActive)
	if allowed != nil {
		ids := make([]string, 0, len(allowed))
		for id, visible := range allowed {
			if visible {
				ids = append(ids, id)
			}
		}
		query = query.Where("a.department_id IN ?", ids)
	}
	if err := query.Scan(&rows).Error; err != nil {
		return err
	}
	departments := make(map[string]Department, len(snapshot.Departments))
	units := make(map[string]Unit, len(snapshot.Units))
	departmentPeople := map[string]map[string]struct{}{}
	unitPeople := map[string]map[string]struct{}{}
	for _, d := range snapshot.Departments {
		departments[d.ID] = d
	}
	for _, u := range snapshot.Units {
		units[u.ID] = u
	}
	add := func(sets map[string]map[string]struct{}, id, userID string) {
		if sets[id] == nil {
			sets[id] = map[string]struct{}{}
		}
		sets[id][userID] = struct{}{}
	}
	for _, row := range rows {
		department, ok := departments[row.DepartmentID]
		if !ok {
			continue
		}
		seen := map[string]bool{}
		for current := department; ; {
			if seen[current.ID] {
				return ErrConflict
			}
			seen[current.ID] = true
			add(departmentPeople, current.ID, row.UserID)
			if current.ParentID == nil {
				break
			}
			parent, exists := departments[*current.ParentID]
			if !exists || parent.UnitID != department.UnitID {
				return ErrConflict
			}
			current = parent
		}
		seen = map[string]bool{}
		id := department.UnitID
		for {
			if seen[id] {
				return ErrConflict
			}
			seen[id] = true
			unit, exists := units[id]
			if !exists {
				return ErrConflict
			}
			add(unitPeople, id, row.UserID)
			if unit.ParentID == nil {
				break
			}
			id = *unit.ParentID
		}
	}
	for i := range snapshot.Units {
		count := len(unitPeople[snapshot.Units[i].ID])
		snapshot.Units[i].MemberCount = &count
	}
	for i := range snapshot.Departments {
		department := &snapshot.Departments[i]
		count := len(departmentPeople[department.ID])
		if department.IsRoot {
			count = len(unitPeople[department.UnitID])
		}
		department.MemberCount = &count
	}
	return nil
}
