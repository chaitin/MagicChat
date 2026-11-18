package store

import (
	"encoding/json"
	"time"
)

const (
	RootOrganizationUnitID = "00000000-0000-0000-0000-000000000001"
	RootDepartmentID       = "00000000-0000-0000-0000-000000000002"
)

// Organization units express the group/subsidiary relationship. Departments
// express the working hierarchy inside a unit; neither is a chat group.
type OrganizationUnit struct {
	ID           string  `gorm:"type:uuid;primaryKey"`
	ParentID     *string `gorm:"type:uuid;index"`
	Name         string  `gorm:"size:160;not null"`
	Kind         string  `gorm:"size:32;not null"`
	LeaderUserID *string `gorm:"type:uuid"`
	SortOrder    int     `gorm:"not null;default:0"`
	DisabledAt   *time.Time
	CreatedAt    time.Time `gorm:"not null"`
	UpdatedAt    time.Time `gorm:"not null"`
}

func (OrganizationUnit) TableName() string { return "organization_units" }

type OrganizationDepartment struct {
	ID        string    `gorm:"type:uuid;primaryKey"`
	UnitID    string    `gorm:"type:uuid;not null;index"`
	ParentID  *string   `gorm:"type:uuid;index"`
	Name      string    `gorm:"size:160;not null"`
	SortOrder int       `gorm:"not null;default:0"`
	IsRoot    bool      `gorm:"not null;default:false"`
	CreatedAt time.Time `gorm:"not null"`
	UpdatedAt time.Time `gorm:"not null"`
}

func (OrganizationDepartment) TableName() string { return "organization_departments" }

type OrganizationAssignment struct {
	ID           string    `gorm:"type:uuid;primaryKey"`
	UserID       string    `gorm:"type:uuid;not null;index"`
	DepartmentID string    `gorm:"type:uuid;not null;index"`
	IsPrimary    bool      `gorm:"not null;default:false"`
	SortOrder    int       `gorm:"not null;default:0"`
	CreatedAt    time.Time `gorm:"not null"`
	UpdatedAt    time.Time `gorm:"not null"`
}

func (OrganizationAssignment) TableName() string { return "organization_assignments" }

type OrganizationMemberReporting struct {
	UserID              string    `gorm:"type:uuid;primaryKey"`
	DirectManagerUserID *string   `gorm:"type:uuid;index"`
	UpdatedAt           time.Time `gorm:"not null"`
}

func (OrganizationMemberReporting) TableName() string { return "organization_member_reporting" }

type OrganizationMemberDottedManager struct {
	UserID        string `gorm:"type:uuid;primaryKey"`
	ManagerUserID string `gorm:"type:uuid;primaryKey"`
}

func (OrganizationMemberDottedManager) TableName() string {
	return "organization_member_dotted_managers"
}

type OrganizationDepartmentLeader struct {
	DepartmentID string `gorm:"type:uuid;primaryKey"`
	UserID       string `gorm:"type:uuid;primaryKey"`
	IsPrimary    bool   `gorm:"not null;default:false"`
}

func (OrganizationDepartmentLeader) TableName() string { return "organization_department_leaders" }

type OrganizationAuditEvent struct {
	ID         string          `gorm:"type:uuid;primaryKey"`
	Actor      string          `gorm:"size:120;not null"`
	Action     string          `gorm:"size:80;not null"`
	TargetType string          `gorm:"size:40;not null"`
	TargetID   string          `gorm:"type:uuid;not null"`
	Before     json.RawMessage `gorm:"type:jsonb;not null"`
	After      json.RawMessage `gorm:"type:jsonb;not null"`
	CreatedAt  time.Time       `gorm:"not null"`
}

func (OrganizationAuditEvent) TableName() string { return "organization_audit_events" }

type OrganizationPolicy struct {
	ID              int       `gorm:"primaryKey"`
	VisibilityScope string    `gorm:"size:32;not null;default:all"`
	UpdatedAt       time.Time `gorm:"not null"`
}

func (OrganizationPolicy) TableName() string { return "organization_policy" }
