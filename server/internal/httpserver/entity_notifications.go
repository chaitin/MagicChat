package httpserver

import (
	"context"
	"time"

	"app/internal/realtime"
	"app/internal/store"
)

func (s *Server) runEntityChangeWorker(ctx context.Context) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := s.dispatchEntityChanges(ctx); err != nil && ctx.Err() == nil {
			s.db.Logger.Error(ctx, "dispatch client entity changes: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Server) dispatchEntityChanges(ctx context.Context) error {
	changes, err := s.entitySync.Pending(ctx)
	if err != nil {
		return err
	}
	onlineIDs := s.realtime.OnlineUserIDs()
	for _, change := range changes {
		recipients, err := s.entitySync.Recipients(ctx, change, onlineIDs)
		if err != nil {
			return err
		}
		payload := map[string]interface{}{"revision": change.Revision, "updated_at": change.UpdatedAt}
		switch change.Type {
		case store.ClientDirectoryUsers:
			payload["scope"] = "users"
		case store.ClientDirectoryApps:
			payload["scope"] = "apps"
		case "user":
			payload["user_id"] = change.EntityID
			var user store.User
			if err := s.db.WithContext(ctx).Select("updated_at").Take(&user, "id = ?", change.EntityID).Error; err == nil {
				// Legacy clients compare this timestamp with /users/resolve.
				payload["updated_at"] = user.UpdatedAt
			}
			if s.accounts != nil {
				s.accounts.InvalidateProfile(change.EntityID)
			}
		case "app":
			payload["app_id"] = change.EntityID
		default:
			payload["conversation_id"] = change.EntityID
		}
		s.realtime.SendToUsers(recipients, realtime.NewEvent(change.Event, payload))
		if err := s.entitySync.Acknowledge(ctx, change); err != nil {
			return err
		}
	}
	return nil
}
