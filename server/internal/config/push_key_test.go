package config

import (
	"bytes"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestLoadOrCreatePushCredentialKeyIsAtomic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "push", "credential.key")
	const workers = 16
	keys := make(chan []byte, workers)
	errors := make(chan error, workers)
	var wait sync.WaitGroup
	for range workers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			key, err := loadOrCreatePushCredentialKey(path)
			if err != nil {
				errors <- err
				return
			}
			keys <- key
		}()
	}
	wait.Wait()
	close(keys)
	close(errors)
	for err := range errors {
		t.Fatalf("loadOrCreatePushCredentialKey() error = %v", err)
	}
	persisted, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if len(persisted) != pushCredentialKeyBytes {
		t.Fatalf("persisted key bytes = %d", len(persisted))
	}
	for key := range keys {
		if !bytes.Equal(key, persisted) {
			t.Fatal("concurrent caller received a different key")
		}
	}
}

func TestReadPushCredentialKeyRejectsUnsafeFile(t *testing.T) {
	directory := t.TempDir()
	wrongSize := filepath.Join(directory, "wrong-size.key")
	if err := os.WriteFile(wrongSize, make([]byte, 31), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	if _, err := readPushCredentialKey(wrongSize); err == nil {
		t.Fatal("readPushCredentialKey() accepted wrong-sized key")
	}

	unsafeMode := filepath.Join(directory, "unsafe-mode.key")
	if err := os.WriteFile(unsafeMode, make([]byte, 32), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	if _, err := readPushCredentialKey(unsafeMode); err == nil {
		t.Fatal("readPushCredentialKey() accepted unsafe permissions")
	}

	target := filepath.Join(directory, "target.key")
	if err := os.WriteFile(target, make([]byte, 32), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	link := filepath.Join(directory, "link.key")
	if err := os.Symlink(target, link); err != nil {
		t.Fatalf("Symlink() error = %v", err)
	}
	if _, err := readPushCredentialKey(link); err == nil {
		t.Fatal("readPushCredentialKey() accepted symbolic link")
	}
}
