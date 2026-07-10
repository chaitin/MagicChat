package appconnection

import (
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"app/internal/realtime"
)

func TestRequestCacheReplaysCompletedResponse(t *testing.T) {
	cache := newRequestCache(requestCacheOptions{})
	request := testAppRequest("request-1", "method.one", map[string]any{"value": 1})
	calls := 0
	execute := func() realtime.Envelope {
		calls++
		return realtime.NewResponse(request.ID, map[string]any{"calls": calls})
	}

	first := cache.Do("app-1", request, execute)
	second := cache.Do("app-1", request, execute)
	if calls != 1 {
		t.Fatalf("handler calls = %d, want 1", calls)
	}
	if string(first.Payload) != string(second.Payload) {
		t.Fatalf("responses differ: %s != %s", first.Payload, second.Payload)
	}
}

func TestRequestCacheCoalescesConcurrentDuplicate(t *testing.T) {
	cache := newRequestCache(requestCacheOptions{})
	request := testAppRequest("request-1", "method.one", nil)
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	execute := func() realtime.Envelope {
		calls.Add(1)
		close(started)
		<-release
		return realtime.NewResponse(request.ID, map[string]any{"ok": true})
	}

	var first, second realtime.Envelope
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		first = cache.Do("app-1", request, execute)
	}()
	<-started
	go func() {
		defer wg.Done()
		second = cache.Do("app-1", request, execute)
	}()
	close(release)
	wg.Wait()

	if calls.Load() != 1 {
		t.Fatalf("handler calls = %d, want 1", calls.Load())
	}
	if string(first.Payload) != string(second.Payload) {
		t.Fatalf("responses differ: %s != %s", first.Payload, second.Payload)
	}
}

func TestRequestCacheRejectsRequestIDConflict(t *testing.T) {
	cache := newRequestCache(requestCacheOptions{})
	first := testAppRequest("request-1", "method.one", map[string]any{"value": 1})
	conflict := testAppRequest("request-1", "method.one", map[string]any{"value": 2})
	cache.Do("app-1", first, func() realtime.Envelope {
		return realtime.NewResponse(first.ID, nil)
	})

	response := cache.Do("app-1", conflict, func() realtime.Envelope {
		t.Fatal("conflicting request executed")
		return realtime.Envelope{}
	})
	if response.Error == nil || response.Error.Code != "request_id_conflict" {
		t.Fatalf("response = %#v, want request_id_conflict", response)
	}
}

func TestRequestCacheExpiresCompletedResponse(t *testing.T) {
	now := time.Date(2026, 7, 10, 8, 0, 0, 0, time.UTC)
	cache := newRequestCache(requestCacheOptions{
		TTL: time.Minute,
		Now: func() time.Time { return now },
	})
	request := testAppRequest("request-1", "method.one", nil)
	calls := 0
	execute := func() realtime.Envelope {
		calls++
		return realtime.NewResponse(request.ID, map[string]any{"calls": calls})
	}
	cache.Do("app-1", request, execute)
	now = now.Add(2 * time.Minute)
	cache.Do("app-1", request, execute)
	if calls != 2 {
		t.Fatalf("handler calls = %d, want expired request executed again", calls)
	}
}

func TestRequestCacheEvictsLeastRecentlyUsedResponse(t *testing.T) {
	cache := newRequestCache(requestCacheOptions{MaxEntries: 1})
	calls := map[string]int{}
	execute := func(request realtime.Envelope) func() realtime.Envelope {
		return func() realtime.Envelope {
			calls[request.ID]++
			return realtime.NewResponse(request.ID, map[string]any{"id": request.ID})
		}
	}
	first := testAppRequest("request-1", "method.one", nil)
	second := testAppRequest("request-2", "method.one", nil)
	cache.Do("app-1", first, execute(first))
	cache.Do("app-1", second, execute(second))
	cache.Do("app-1", first, execute(first))
	if calls[first.ID] != 2 {
		t.Fatalf("first handler calls = %d, want evicted response executed again", calls[first.ID])
	}
}

func TestRequestCacheEvictsResponseOverByteBudget(t *testing.T) {
	cache := newRequestCache(requestCacheOptions{MaxBytes: 1})
	request := testAppRequest("request-1", "method.one", nil)
	calls := 0
	execute := func() realtime.Envelope {
		calls++
		return realtime.NewResponse(request.ID, map[string]any{"content": "larger than one byte"})
	}

	cache.Do("app-1", request, execute)
	cache.Do("app-1", request, execute)
	if calls != 2 {
		t.Fatalf("handler calls = %d, want byte-budget-evicted response executed again", calls)
	}
}

func testAppRequest(id string, method string, payload any) realtime.Envelope {
	raw, _ := json.Marshal(payload)
	return realtime.Envelope{V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: id, Method: method, Payload: raw}
}
