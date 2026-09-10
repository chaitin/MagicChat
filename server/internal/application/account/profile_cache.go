package account

import (
	"container/list"
	"context"
	"errors"
	"hash/fnv"
	"strings"
	"sync"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
)

const (
	profileCacheTTL      = time.Minute
	profileCacheCapacity = 20_000
)

type profileEntry struct {
	value     Account
	expiresAt time.Time
}

type profileCache struct {
	mu         sync.Mutex
	entries    map[string]*list.Element
	lru        list.List
	generation uint64
	// Fixed stripes coalesce concurrent misses without retaining locks per user.
	loads [64]profileLoadLock
}

type profileLoadLock struct {
	once sync.Once
	held chan struct{}
}

func (l *profileLoadLock) lock(ctx context.Context) error {
	l.once.Do(func() { l.held = make(chan struct{}, 1) })
	select {
	case l.held <- struct{}{}:
		// Both cases can be ready after cancellation. Do not treat acquiring
		// the token as permission to proceed with an expired request.
		if err := ctx.Err(); err != nil {
			l.unlock()
			return err
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (l *profileLoadLock) unlock() { <-l.held }

func cloneAccount(value Account) Account {
	if value.LastOnlineAt != nil {
		at := *value.LastOnlineAt
		value.LastOnlineAt = &at
	}
	return value
}

func (c *profileCache) get(id string, now time.Time, version *time.Time) (Account, bool, uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if element := c.entries[id]; element != nil {
		entry := element.Value.(profileEntry)
		if now.Before(entry.expiresAt) && (version == nil || entry.value.UpdatedAt.Equal(*version)) {
			c.lru.MoveToFront(element)
			return cloneAccount(entry.value), true, c.generation
		}
		c.lru.Remove(element)
		delete(c.entries, id)
	}
	return Account{}, false, c.generation
}

func (c *profileCache) put(value Account, now time.Time, generation uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// An update may commit while a cache miss is reading the old profile.
	// Never refill the cache with that read after invalidation.
	if c.generation != generation {
		return
	}
	if c.entries == nil {
		c.entries = make(map[string]*list.Element)
	}
	entry := profileEntry{value: cloneAccount(value), expiresAt: now.Add(profileCacheTTL)}
	if element := c.entries[value.ID]; element != nil {
		element.Value = entry
		c.lru.MoveToFront(element)
		return
	}
	c.entries[value.ID] = c.lru.PushFront(entry)
	if c.lru.Len() > profileCacheCapacity {
		oldest := c.lru.Back()
		delete(c.entries, oldest.Value.(profileEntry).value.ID)
		c.lru.Remove(oldest)
	}
}

func (s *Service) InvalidateProfile(accountID string) {
	id := strings.TrimSpace(accountID)
	s.profiles.mu.Lock()
	defer s.profiles.mu.Unlock()
	s.profiles.generation++
	if element := s.profiles.entries[id]; element != nil {
		s.profiles.lru.Remove(element)
		delete(s.profiles.entries, id)
	}
}

func (s *Service) getProfile(ctx context.Context, accountID string, version *time.Time) (Account, error) {
	if err := ctx.Err(); err != nil {
		return Account{}, internalError(err)
	}
	if value, ok, _ := s.profiles.get(accountID, s.now().UTC(), version); ok {
		if err := ctx.Err(); err != nil {
			return Account{}, internalError(err)
		}
		return s.withOnlineActivity(value), nil
	}
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(accountID))
	lock := &s.profiles.loads[hash.Sum32()%uint32(len(s.profiles.loads))]
	if err := lock.lock(ctx); err != nil {
		return Account{}, internalError(err)
	}
	defer lock.unlock()
	value, ok, generation := s.profiles.get(accountID, s.now().UTC(), version)
	if err := ctx.Err(); err != nil {
		return Account{}, internalError(err)
	}
	if ok {
		return s.withOnlineActivity(value), nil
	}
	// A distinct result type bypasses the store.User nickname projection hook.
	// Cache the stored nickname; apply the current policy only on the response.
	type rawProfileUser store.User
	var user rawProfileUser
	if err := s.db.WithContext(ctx).Model(&store.User{}).
		Select("id", "avatar", "email", "last_online_at", "name", "nickname", "phone", "status", "created_at", "updated_at").
		Take(&user, "id = ?", accountID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return Account{}, newError(CodeNotFound, "用户不存在", err)
		}
		return Account{}, internalError(err)
	}
	if err := ctx.Err(); err != nil {
		return Account{}, internalError(err)
	}
	value = newAccount(store.User(user))
	s.profiles.put(value, s.now().UTC(), generation)
	return s.withOnlineActivity(value), nil
}

func applyProfileNicknamePolicy(value Account, allowNickname bool) Account {
	if !allowNickname {
		value.Nickname = value.Name
	}
	return value
}

func (s *Service) profileNicknameAllowed(ctx context.Context) (bool, error) {
	var policy store.AppSettings
	err := s.db.WithContext(ctx).Select("allow_user_nickname_editing").
		First(&policy, "id = ?", store.AppSettingsID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// Match the store projection when settings have not been initialized.
		return true, nil
	}
	if err != nil {
		return false, internalError(err)
	}
	return policy.AllowUserNicknameEditing, nil
}
