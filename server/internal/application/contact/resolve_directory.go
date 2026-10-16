package contact

import "context"

func (s *Service) ResolveDirectory(ctx context.Context, accountID string, appIDs, groupIDs []string) (ListResult, error) {
	db := s.db.WithContext(ctx)
	identity := Identity{ID: accountID, Type: IdentityTypeUser}
	apps, err := s.listApps(db, identity, "", appIDs)
	if err != nil {
		return ListResult{}, internalError(err)
	}
	groups, err := s.listGroups(db, identity, "", groupIDs)
	if err != nil {
		return ListResult{}, internalError(err)
	}
	return ListResult{Apps: apps, Groups: groups}, nil
}
