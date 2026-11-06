package entitycard

import (
	"app/internal/store"
	"testing"
)

func TestTaskPriorityLabel(t *testing.T) {
	for _, tc := range []struct {
		priority int16
		want     string
	}{
		{store.TaskPriorityLow, "低优先级"},
		{store.TaskPriorityMedium, "中优先级"},
		{store.TaskPriorityHigh, "高优先级"},
		{0, ""},
	} {
		if got := taskPriorityLabel(tc.priority); got != tc.want {
			t.Errorf("priority %d = %q, want %q", tc.priority, got, tc.want)
		}
	}
}
