package organization

import (
	"app/internal/store"
	"context"
)

func (s *Service) NodeMembersForViewer(ctx context.Context, viewerID, departmentID string, page, pageSize int) (MemberPage, error) {
	snapshot, err := s.SnapshotForViewer(ctx, viewerID)
	if err != nil {
		return MemberPage{}, err
	}
	var selected *Department
	for i := range snapshot.Departments {
		if snapshot.Departments[i].ID == departmentID {
			selected = &snapshot.Departments[i]
			break
		}
	}
	if selected == nil {
		return MemberPage{}, ErrNotFound
	}
	allowed, err := s.visibleDepartments(ctx, viewerID)
	if err != nil {
		return MemberPage{}, err
	}
	unitIDs := map[string]bool{selected.UnitID: true}
	deptIDs := map[string]bool{selected.ID: true}
	for changed := true; changed; {
		changed = false
		if selected.IsRoot {
			for _, unit := range snapshot.Units {
				if unit.ParentID != nil && unitIDs[*unit.ParentID] && !unitIDs[unit.ID] {
					unitIDs[unit.ID] = true
					changed = true
				}
			}
		}
		for _, department := range snapshot.Departments {
			match := selected.IsRoot && unitIDs[department.UnitID]
			if !selected.IsRoot && department.ParentID != nil {
				match = deptIDs[*department.ParentID]
			}
			if match && !deptIDs[department.ID] {
				deptIDs[department.ID] = true
				changed = true
			}
		}
	}
	ids := []string{}
	for id := range deptIDs {
		if allowed == nil || allowed[id] {
			ids = append(ids, id)
		}
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 100
	}
	result := MemberPage{Members: []Member{}, Page: page, PageSize: pageSize}
	if len(ids) == 0 {
		return result, nil
	}
	memberIDs := s.db.WithContext(ctx).Table("organization_assignments").Select("user_id").Where("department_id IN ?", ids)
	query := s.db.WithContext(ctx).Table("users AS u").Where("u.id IN (?) AND u.status = ?", memberIDs, store.UserStatusActive)
	if err := query.Count(&result.Total).Error; err != nil {
		return MemberPage{}, err
	}
	if err := query.Select("u.id, u.name, u.nickname, u.avatar, u.job_title AS title").Order("u.name, u.id").Limit(pageSize).Offset((page - 1) * pageSize).Scan(&result.Members).Error; err != nil {
		return MemberPage{}, err
	}
	return result, nil
}
