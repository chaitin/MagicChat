package organization

import (
	"context"
	"errors"
	"time"
)

var (
	ErrInvalid  = errors.New("invalid organization request")
	ErrNotFound = errors.New("organization item not found")
	ErrConflict = errors.New("organization item conflict")
)

type Unit struct {
	MemberCount  *int       `json:"member_count,omitempty"`
	ID           string     `json:"id"`
	ParentID     *string    `json:"parent_id"`
	Name         string     `json:"name"`
	Kind         string     `json:"kind"`
	LeaderUserID *string    `json:"leader_user_id"`
	SortOrder    int        `json:"sort_order"`
	DisabledAt   *time.Time `json:"disabled_at"`
}

type Department struct {
	MemberCount *int     `json:"member_count,omitempty"`
	ID          string   `json:"id"`
	UnitID      string   `json:"unit_id"`
	ParentID    *string  `json:"parent_id"`
	Name        string   `json:"name"`
	SortOrder   int      `json:"sort_order"`
	IsRoot      bool     `json:"is_root"`
	Leaders     []Leader `json:"leaders"`
}

type Leader struct {
	UserID    string `json:"user_id"`
	IsPrimary bool   `json:"is_primary"`
}

type Assignment struct {
	ID           string `json:"id"`
	UserID       string `json:"user_id"`
	UnitID       string `json:"unit_id"`
	DepartmentID string `json:"department_id"`
	Title        string `json:"title"`
	IsPrimary    bool   `json:"is_primary"`
	SortOrder    int    `json:"sort_order"`
}

type AssignmentInput struct {
	DepartmentID string `json:"department_id"`
	IsPrimary    bool   `json:"is_primary"`
	SortOrder    int    `json:"sort_order"`
}

type Reporting struct {
	DirectManagerUserID  *string  `json:"direct_manager_user_id"`
	DottedManagerUserIDs []string `json:"dotted_manager_user_ids"`
}

type Snapshot struct {
	Units       []Unit       `json:"units"`
	Departments []Department `json:"departments"`
}

type Member struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Nickname     string `json:"nickname"`
	Avatar       string `json:"avatar"`
	Title        string `json:"title"`
	IsPrimary    bool   `json:"is_primary"`
	DepartmentID string `json:"department_id"`
}

type MemberPage struct {
	Members  []Member `json:"members"`
	Total    int64    `json:"total"`
	Page     int      `json:"page"`
	PageSize int      `json:"page_size"`
}

type Reader interface {
	Snapshot(context.Context) (Snapshot, error)
	Assignments(context.Context, string) ([]Assignment, error)
	Members(context.Context, string, int, int) (MemberPage, error)
}
