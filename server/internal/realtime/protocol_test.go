package realtime

import (
	"encoding/json"
	"testing"
)

func TestNewCursorEventIncludesCursor(t *testing.T) {
	event := NewCursorEvent(42, EventMessageCreated, map[string]any{"message": "hello"})
	if event.Cursor != 42 {
		t.Fatalf("event.Cursor = %d, want 42", event.Cursor)
	}
	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("marshal event: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal event: %v", err)
	}
	if decoded["cursor"] != float64(42) {
		t.Fatalf("encoded cursor = %v, want 42", decoded["cursor"])
	}
}
