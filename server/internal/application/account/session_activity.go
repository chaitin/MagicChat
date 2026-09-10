package account

import (
	"context"
	"errors"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
)

const (
	activityFlushInterval  = time.Minute
	activityFlushTimeout   = 10 * time.Second
	activityBatchSize      = 500
	activityBufferCapacity = 100_000
)

type activityBuffer struct {
	mu       sync.Mutex
	flushMu  sync.Mutex
	sessions map[string]time.Time
	online   map[string]time.Time
	closed   bool
	dropped  uint64
}

func mergeActivity(values *map[string]time.Time, id string, at time.Time) bool {
	if *values == nil {
		*values = make(map[string]time.Time)
	}
	previous, exists := (*values)[id]
	if !exists && len(*values) >= activityBufferCapacity {
		return false
	}
	if at.After(previous) {
		(*values)[id] = at
	}
	return true
}

func (s *Service) recordSessionActivity(sessionID string, at time.Time) {
	s.activity.mu.Lock()
	defer s.activity.mu.Unlock()
	if !s.activity.closed && !mergeActivity(&s.activity.sessions, sessionID, at.UTC()) {
		s.activity.dropped++
	}
}

func (s *Service) RecordOnlineActivity(ctx context.Context, accountID string, at time.Time) error {
	if err := ctx.Err(); err != nil {
		return internalError(err)
	}
	id := strings.TrimSpace(accountID)
	if id == "" {
		return nil
	}
	at = at.UTC()
	s.activity.mu.Lock()
	if s.activity.closed {
		s.activity.mu.Unlock()
		return nil
	}
	accepted := mergeActivity(&s.activity.online, id, at)
	if !accepted {
		s.activity.dropped++
	}
	s.activity.mu.Unlock()
	if !accepted {
		return internalError(errors.New("online activity buffer is full"))
	}
	return nil
}

func (s *Service) withOnlineActivity(value Account) Account {
	s.activity.mu.Lock()
	at := s.activity.online[value.ID]
	s.activity.mu.Unlock()
	if !at.IsZero() && (value.LastOnlineAt == nil || at.After(*value.LastOnlineAt)) {
		value.LastOnlineAt = &at
	}
	return value
}

func (s *Service) RunActivityWorker(ctx context.Context) {
	ticker := time.NewTicker(activityFlushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			flushCtx, cancel := context.WithTimeout(ctx, activityFlushTimeout)
			err := s.FlushActivity(flushCtx)
			cancel()
			if err != nil {
				slog.Error("flush account activity", "error", err)
			}
			s.activity.mu.Lock()
			dropped := s.activity.dropped
			s.activity.dropped = 0
			s.activity.mu.Unlock()
			if dropped > 0 {
				slog.Warn("account activity buffer full", "dropped", dropped)
			}
		}
	}
}

// CloseActivity stops accepting optional activity updates and flushes the final
// snapshot. The worker must be stopped before calling this during shutdown.
func (s *Service) CloseActivity(ctx context.Context) error {
	s.activity.mu.Lock()
	s.activity.closed = true
	s.activity.mu.Unlock()
	return s.FlushActivity(ctx)
}

// FlushActivity keeps pending entries until each batch commits. Concurrent newer
// timestamps survive acknowledgement; failures are retried by the next flush.
func (s *Service) FlushActivity(ctx context.Context) error {
	s.activity.flushMu.Lock()
	defer s.activity.flushMu.Unlock()
	s.activity.mu.Lock()
	sessions := copyActivity(s.activity.sessions)
	online := copyActivity(s.activity.online)
	s.activity.mu.Unlock()
	var result error
	if err := s.flushActivityValues(ctx, sessions, false); err != nil {
		result = errors.Join(result, err)
	}
	if err := s.flushActivityValues(ctx, online, true); err != nil {
		result = errors.Join(result, err)
	}
	return result
}

func copyActivity(values map[string]time.Time) map[string]time.Time {
	copied := make(map[string]time.Time, len(values))
	for id, at := range values {
		copied[id] = at
	}
	return copied
}

func (s *Service) flushActivityValues(ctx context.Context, values map[string]time.Time, online bool) error {
	ids := make([]string, 0, len(values))
	for id := range values {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for start := 0; start < len(ids); start += activityBatchSize {
		if err := ctx.Err(); err != nil {
			return err
		}
		batch := ids[start:min(start+activityBatchSize, len(ids))]
		var model any = &store.UserSession{}
		column := "last_seen_at"
		if online {
			model = &store.User{}
			column = "last_online_at"
		}
		var expression strings.Builder
		expression.WriteString("CASE id")
		args := make([]any, 0, 2*len(batch))
		for _, id := range batch {
			// PostgreSQL otherwise resolves an all-parameter CASE to text.
			if s.db.Dialector.Name() == "postgres" {
				expression.WriteString(" WHEN ? THEN CAST(? AS timestamptz)")
			} else {
				expression.WriteString(" WHEN ? THEN ?")
			}
			args = append(args, id, values[id])
		}
		expression.WriteString(" END")
		latest := gorm.Expr(expression.String(), args...)
		if err := s.db.WithContext(ctx).Model(model).
			Where("id IN ?", batch).
			Where("("+column+" IS NULL OR "+column+" < ?)", latest).
			UpdateColumn(column, latest).Error; err != nil {
			return err
		}
		if online {
			// Update cached timestamps before removing their pending overlay.
			s.profiles.mu.Lock()
			s.profiles.generation++
			for _, id := range batch {
				if element := s.profiles.entries[id]; element != nil {
					entry := element.Value.(profileEntry)
					at := values[id]
					if entry.value.LastOnlineAt == nil || at.After(*entry.value.LastOnlineAt) {
						entry.value.LastOnlineAt = &at
						element.Value = entry
					}
				}
			}
			s.profiles.mu.Unlock()
		}
		s.activity.mu.Lock()
		pending := s.activity.sessions
		if online {
			pending = s.activity.online
		}
		for _, id := range batch {
			if !pending[id].After(values[id]) {
				delete(pending, id)
			}
		}
		s.activity.mu.Unlock()
	}
	return nil
}
