package config

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const (
	defaultPushCredentialKeyFile = "data/push/credential.key"
	pushCredentialKeyBytes       = 32
)

func loadOrCreatePushCredentialKey(path string) ([]byte, error) {
	key, err := readPushCredentialKey(path)
	if err == nil {
		return key, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create push credential key directory: %w", err)
	}
	key = make([]byte, pushCredentialKeyBytes)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generate push credential key: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".credential-key-*")
	if err != nil {
		return nil, fmt.Errorf("create temporary push credential key: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return nil, fmt.Errorf("protect temporary push credential key: %w", err)
	}
	if _, err := temporary.Write(key); err != nil {
		_ = temporary.Close()
		return nil, fmt.Errorf("write temporary push credential key: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return nil, fmt.Errorf("sync temporary push credential key: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return nil, fmt.Errorf("close temporary push credential key: %w", err)
	}

	if err := os.Link(temporaryPath, path); err != nil {
		if errors.Is(err, os.ErrExist) {
			return readPushCredentialKey(path)
		}
		return nil, fmt.Errorf("install push credential key: %w", err)
	}
	if err := syncDirectory(directory); err != nil {
		return nil, err
	}
	return key, nil
}

func readPushCredentialKey(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("push credential key file must be a regular file")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("push credential key file permissions must be 0600 or stricter")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	key, err := io.ReadAll(io.LimitReader(file, pushCredentialKeyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read push credential key: %w", err)
	}
	if len(key) != pushCredentialKeyBytes {
		return nil, fmt.Errorf("push credential key file must contain exactly 32 bytes")
	}
	return key, nil
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open push credential key directory: %w", err)
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return fmt.Errorf("sync push credential key directory: %w", err)
	}
	return nil
}
