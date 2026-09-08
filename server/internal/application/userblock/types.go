package userblock

import (
	"context"
	"time"
)

type Status struct {
	Blocked   bool
	BlockedAt *time.Time
	UserID    string
}

type Command struct {
	AccountID string
	UserID    string
}

type ClientService interface {
	Block(context.Context, Command) (Status, error)
	GetStatus(context.Context, Command) (Status, error)
	Unblock(context.Context, Command) error
}
