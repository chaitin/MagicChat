package logging

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigureRestrictsExistingLogFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "assistant.log")
	if err := os.WriteFile(path, []byte("previous logs\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LOG_FILE", path)
	previous := log.Writer()
	closeLog := Configure()
	t.Cleanup(func() {
		closeLog()
		log.SetOutput(previous)
	})
	log.Print("test model response")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("log permissions = %o, want 600", info.Mode().Perm())
	}
	content, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(content), "test model response") {
		t.Fatalf("log content = %q, err=%v", content, err)
	}
}
