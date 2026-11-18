package usermanagement

import (
	"context"
	"time"

	"app/internal/application/organization"
)

const (
	StatusActive   = "active"
	StatusDisabled = "disabled"
)

type UserOrganization struct {
	UnitName       string
	DepartmentName string
	Title          string
}

type User struct {
	JobTitle     string
	Organization *UserOrganization
	ID           string
	Avatar       string
	Email        string
	LastOnlineAt *time.Time
	Name         string
	Nickname     string
	Online       bool
	Phone        string
	Status       string
	CreatedAt    time.Time
}

type ListCommand struct {
	UserIDs             string
	IncludeOrganization bool
	DepartmentIDs       string
	Keyword             string
	Online              string
	Page                string
	PageSize            string
	Sort                string
	Order               string
}

type ListResult struct {
	Users    []User
	Total    int64
	Page     int
	PageSize int
	Sort     string
	Order    string
}

type CreateCommand struct {
	Assignments  *[]organization.AssignmentInput
	JobTitle     string
	Actor        string
	DepartmentID string
	Email        string
	Name         string
	Phone        string
}

type CreateResult struct {
	User            User
	InitialPassword string
}

type UpdateCommand struct {
	JobTitle    *string
	Actor       string
	Assignments *[]organization.AssignmentInput
	Reporting   *organization.Reporting
	UserID      string
	Email       string
	Name        string
	Nickname    string
	Phone       string
}

type SetStatusCommand struct {
	UserID string
	Status string
}

type ResetPasswordResult struct {
	User        User
	NewPassword string
}

type AdminService interface {
	JobTitles(context.Context, string) ([]string, error)
	List(context.Context, ListCommand) (ListResult, error)
	Create(context.Context, CreateCommand) (CreateResult, error)
	Update(context.Context, UpdateCommand) (User, error)
	SetStatus(context.Context, SetStatusCommand) (User, error)
	ResetPassword(context.Context, string) (ResetPasswordResult, error)
}
