package usermanagement

import (
	"context"
	"strings"

	"app/internal/store"
)

// JobTitles returns saved member titles, without loading member profiles.
func (s *Service) JobTitles(ctx context.Context, keyword string) ([]string, error) {
	query := s.db.WithContext(ctx).Model(&store.User{}).
		Select("TRIM(job_title) AS title").
		Where("TRIM(job_title) <> ''")
	keyword = strings.ToLower(strings.TrimSpace(keyword))
	if keyword != "" {
		// Treat wildcard characters as literal input.
		keyword = strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(keyword)
		query = query.Where("LOWER(job_title) LIKE ? ESCAPE '!'", "%"+keyword+"%")
	}
	titles := []string{}
	if err := query.Group("TRIM(job_title)").Order("TRIM(job_title) ASC").Limit(30).Pluck("TRIM(job_title)", &titles).Error; err != nil {
		return nil, internalError(err)
	}
	return titles, nil
}
