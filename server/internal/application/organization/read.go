package organization

import (
	"context"
	"errors"
	"strings"

	"app/internal/store"

	"gorm.io/gorm"
)

type Service struct{ db *gorm.DB }

func NewService(db *gorm.DB) *Service { return &Service{db: db} }

func (s *Service) Snapshot(ctx context.Context) (Snapshot, error) {
	db := s.db.WithContext(ctx)
	var settings store.AppSettings
	if err := db.First(&settings, "id = ?", store.AppSettingsID).Error; err != nil {
		return Snapshot{}, err
	}
	var units []store.OrganizationUnit
	if err := db.Order("sort_order, id").Find(&units).Error; err != nil {
		return Snapshot{}, err
	}
	var departments []store.OrganizationDepartment
	if err := db.Order("sort_order, id").Find(&departments).Error; err != nil {
		return Snapshot{}, err
	}
	var leaders []store.OrganizationDepartmentLeader
	if err := db.Find(&leaders).Error; err != nil {
		return Snapshot{}, err
	}
	leadersByDepartment := map[string][]Leader{}
	for _, leader := range leaders {
		leadersByDepartment[leader.DepartmentID] = append(leadersByDepartment[leader.DepartmentID], Leader{UserID: leader.UserID, IsPrimary: leader.IsPrimary})
	}
	result := Snapshot{Units: make([]Unit, 0, len(units)), Departments: make([]Department, 0, len(departments))}
	for _, unit := range units {
		name := unit.Name
		if unit.ID == store.RootOrganizationUnitID {
			name = settings.OrganizationName
		}
		result.Units = append(result.Units, Unit{ID: unit.ID, ParentID: unit.ParentID, Name: name, Kind: unit.Kind, LeaderUserID: unit.LeaderUserID, SortOrder: unit.SortOrder, DisabledAt: unit.DisabledAt})
	}
	for _, dept := range departments {
		name := dept.Name
		if dept.IsRoot {
			for _, unit := range result.Units {
				if unit.ID == dept.UnitID {
					name = unit.Name
					break
				}
			}
		}
		deptLeaders := leadersByDepartment[dept.ID]
		if deptLeaders == nil {
			deptLeaders = []Leader{}
		}
		result.Departments = append(result.Departments, Department{ID: dept.ID, UnitID: dept.UnitID, ParentID: dept.ParentID, Name: name, SortOrder: dept.SortOrder, IsRoot: dept.IsRoot, Leaders: deptLeaders})
	}
	result.Units = orderUnits(result.Units)
	result.Departments = orderDepartments(result.Departments, result.Units)
	return result, nil
}

func orderUnits(units []Unit) []Unit {
	children := map[string][]Unit{}
	for _, unit := range units {
		parent := ""
		if unit.ParentID != nil {
			parent = *unit.ParentID
		}
		children[parent] = append(children[parent], unit)
	}
	ordered := make([]Unit, 0, len(units))
	visited := map[string]bool{}
	var walk func(string)
	walk = func(parent string) {
		for _, unit := range children[parent] {
			if visited[unit.ID] {
				continue
			}
			visited[unit.ID] = true
			ordered = append(ordered, unit)
			walk(unit.ID)
		}
	}
	walk("")
	for _, unit := range units {
		if !visited[unit.ID] {
			ordered = append(ordered, unit)
		}
	}
	return ordered
}

func orderDepartments(departments []Department, units []Unit) []Department {
	children := map[string][]Department{}
	for _, department := range departments {
		parent := ""
		if department.ParentID != nil {
			parent = *department.ParentID
		}
		children[parent] = append(children[parent], department)
	}
	ordered := make([]Department, 0, len(departments))
	visited := map[string]bool{}
	var walk func(Department)
	walk = func(department Department) {
		if visited[department.ID] {
			return
		}
		visited[department.ID] = true
		ordered = append(ordered, department)
		for _, child := range children[department.ID] {
			walk(child)
		}
	}
	for _, unit := range units {
		for _, department := range children[""] {
			if department.UnitID == unit.ID {
				walk(department)
			}
		}
	}
	for _, department := range departments {
		if !visited[department.ID] {
			ordered = append(ordered, department)
		}
	}
	return ordered
}

func (s *Service) Assignments(ctx context.Context, userID string) ([]Assignment, error) {
	if !validID(userID) {
		return nil, ErrInvalid
	}
	var user store.User
	if err := s.db.WithContext(ctx).Select("id", "job_title").First(&user, "id = ?", userID).Error; err != nil {
		return nil, classifyNotFound(err)
	}
	var values []store.OrganizationAssignment
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).Order("is_primary DESC, sort_order, id").Find(&values).Error; err != nil {
		return nil, err
	}
	if len(values) == 0 {
		return []Assignment{}, nil
	}
	deptIDs := make([]string, 0, len(values))
	for _, value := range values {
		deptIDs = append(deptIDs, value.DepartmentID)
	}
	var depts []store.OrganizationDepartment
	if err := s.db.WithContext(ctx).Where("id IN ?", deptIDs).Find(&depts).Error; err != nil {
		return nil, err
	}
	unitByDept := map[string]string{}
	for _, dept := range depts {
		unitByDept[dept.ID] = dept.UnitID
	}
	result := make([]Assignment, 0, len(values))
	for _, value := range values {
		result = append(result, Assignment{ID: value.ID, UserID: value.UserID, UnitID: unitByDept[value.DepartmentID], DepartmentID: value.DepartmentID, Title: user.JobTitle, IsPrimary: value.IsPrimary, SortOrder: value.SortOrder})
	}
	return result, nil
}

func (s *Service) Members(ctx context.Context, departmentID string, page, pageSize int) (MemberPage, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}
	var dept store.OrganizationDepartment
	if err := s.db.WithContext(ctx).First(&dept, "id = ?", departmentID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return MemberPage{}, ErrNotFound
		}
		return MemberPage{}, err
	}
	query := s.db.WithContext(ctx).Table("organization_assignments AS a").Joins("JOIN users AS u ON u.id = a.user_id").Where("a.department_id = ? AND u.status = ?", departmentID, store.UserStatusActive)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return MemberPage{}, err
	}
	var members []Member
	if err := query.Select("u.id, u.name, u.nickname, u.avatar, u.job_title AS title, a.is_primary, a.department_id").Order("a.sort_order, u.name, u.id").Limit(pageSize).Offset((page - 1) * pageSize).Scan(&members).Error; err != nil {
		return MemberPage{}, err
	}
	if members == nil {
		members = []Member{}
	}
	return MemberPage{Members: members, Total: total, Page: page, PageSize: pageSize}, nil
}

func validName(name string) string { return strings.TrimSpace(name) }
