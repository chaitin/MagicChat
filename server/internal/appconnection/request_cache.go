package appconnection

import (
	"crypto/sha256"
	"encoding/json"
	"sync"
	"time"

	"app/internal/realtime"
)

const (
	defaultRequestCacheTTL        = 10 * time.Minute
	defaultRequestCacheMaxEntries = 1000
	defaultRequestCacheMaxBytes   = 64 << 20
)

type requestCacheOptions struct {
	TTL        time.Duration
	MaxEntries int
	MaxBytes   int
	Now        func() time.Time
}

type requestCacheKey struct {
	appID     string
	requestID string
}

type requestCacheEntry struct {
	digest      [32]byte
	done        chan struct{}
	response    realtime.Envelope
	completed   bool
	completedAt time.Time
	lastUsed    uint64
	sizeBytes   int
}

type requestCache struct {
	mu sync.Mutex

	entries    map[requestCacheKey]*requestCacheEntry
	totalBytes int
	clock      uint64
	ttl        time.Duration
	maxEntries int
	maxBytes   int
	now        func() time.Time
}

func newRequestCache(options requestCacheOptions) *requestCache {
	ttl := options.TTL
	if ttl <= 0 {
		ttl = defaultRequestCacheTTL
	}
	maxEntries := options.MaxEntries
	if maxEntries <= 0 {
		maxEntries = defaultRequestCacheMaxEntries
	}
	maxBytes := options.MaxBytes
	if maxBytes <= 0 {
		maxBytes = defaultRequestCacheMaxBytes
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &requestCache{
		entries:    make(map[requestCacheKey]*requestCacheEntry),
		ttl:        ttl,
		maxEntries: maxEntries,
		maxBytes:   maxBytes,
		now:        now,
	}
}

func (c *requestCache) Do(appID string, request realtime.Envelope, execute func() realtime.Envelope) realtime.Envelope {
	key := requestCacheKey{appID: appID, requestID: request.ID}
	digest := requestDigest(request)

	c.mu.Lock()
	c.removeExpiredLocked(c.now())
	if existing := c.entries[key]; existing != nil {
		if existing.digest != digest {
			c.mu.Unlock()
			return realtime.NewErrorResponse(request.ID, "request_id_conflict", "请求 ID 已被不同请求使用")
		}
		c.touchLocked(existing)
		if existing.completed {
			response := existing.response
			c.mu.Unlock()
			return response
		}
		done := existing.done
		c.mu.Unlock()
		<-done
		return existing.response
	}
	entry := &requestCacheEntry{digest: digest, done: make(chan struct{})}
	c.touchLocked(entry)
	c.entries[key] = entry
	c.mu.Unlock()

	response := execute()
	encoded, _ := json.Marshal(response)

	c.mu.Lock()
	entry.response = response
	entry.completed = true
	entry.completedAt = c.now()
	entry.sizeBytes = len(encoded)
	c.totalBytes += entry.sizeBytes
	c.touchLocked(entry)
	close(entry.done)
	c.enforceLimitsLocked()
	c.mu.Unlock()
	return response
}

func requestDigest(request realtime.Envelope) [32]byte {
	content := make([]byte, 0, len(request.Method)+1+len(request.Payload))
	content = append(content, request.Method...)
	content = append(content, 0)
	content = append(content, request.Payload...)
	return sha256.Sum256(content)
}

func (c *requestCache) touchLocked(entry *requestCacheEntry) {
	c.clock++
	entry.lastUsed = c.clock
}

func (c *requestCache) removeExpiredLocked(now time.Time) {
	for key, entry := range c.entries {
		if entry.completed && !entry.completedAt.IsZero() && now.Sub(entry.completedAt) >= c.ttl {
			c.removeLocked(key, entry)
		}
	}
}

func (c *requestCache) enforceLimitsLocked() {
	for c.completedCountLocked() > c.maxEntries || c.totalBytes > c.maxBytes {
		var oldestKey requestCacheKey
		var oldest *requestCacheEntry
		for key, entry := range c.entries {
			if !entry.completed {
				continue
			}
			if oldest == nil || entry.lastUsed < oldest.lastUsed {
				oldestKey = key
				oldest = entry
			}
		}
		if oldest == nil {
			return
		}
		c.removeLocked(oldestKey, oldest)
	}
}

func (c *requestCache) completedCountLocked() int {
	count := 0
	for _, entry := range c.entries {
		if entry.completed {
			count++
		}
	}
	return count
}

func (c *requestCache) removeLocked(key requestCacheKey, entry *requestCacheEntry) {
	delete(c.entries, key)
	c.totalBytes -= entry.sizeBytes
	if c.totalBytes < 0 {
		c.totalBytes = 0
	}
}
