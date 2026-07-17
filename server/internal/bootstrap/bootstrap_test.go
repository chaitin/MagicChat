package bootstrap

import (
	"context"
	"strings"
	"testing"

	"app/internal/config"
)

func TestBootstrapStorageSkipsDisabledInitialization(t *testing.T) {
	err := bootstrapStorage(context.Background(), config.StorageConfig{
		Provider:         "unsupported",
		BootstrapEnabled: false,
	})
	if err != nil {
		t.Fatalf("bootstrapStorage() error = %v", err)
	}
}

func TestBootstrapStorageRunsEnabledInitialization(t *testing.T) {
	err := bootstrapStorage(context.Background(), config.StorageConfig{
		Provider:         "unsupported",
		BootstrapEnabled: true,
	})
	if err == nil || !strings.Contains(err.Error(), "unsupported storage provider") {
		t.Fatalf("bootstrapStorage() error = %v, want unsupported provider error", err)
	}
}
