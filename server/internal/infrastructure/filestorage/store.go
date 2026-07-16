package filestorage

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"time"

	fileapp "app/internal/application/file"
	"app/internal/config"
	"app/internal/objectstore"
)

type Store struct {
	cfg         config.StorageConfig
	clientMu    sync.Mutex
	objectStore *objectstore.Client
}

func New(cfg config.StorageConfig) fileapp.BlobStorage {
	if strings.TrimSpace(cfg.Provider) == "" {
		return nil
	}
	return &Store{cfg: cfg}
}

func (s *Store) PutPublic(ctx context.Context, objectKey string, content io.Reader, sizeBytes int64, contentType string) (string, error) {
	client, err := s.client(ctx)
	if err != nil {
		return "", err
	}
	if err := client.PutPublicObject(ctx, objectKey, content, sizeBytes, contentType); err != nil {
		return "", err
	}
	return client.PublicObjectURL(objectKey)
}

func (s *Store) PutTemporary(ctx context.Context, objectKey string, content io.Reader, sizeBytes int64, contentType string) error {
	client, err := s.client(ctx)
	if err != nil {
		return err
	}
	return client.PutTemporaryObject(ctx, objectKey, content, sizeBytes, contentType)
}

func (s *Store) PresignTemporaryReadURL(ctx context.Context, objectKey string, ttl time.Duration) (string, time.Time, error) {
	client, err := s.client(ctx)
	if err != nil {
		return "", time.Time{}, err
	}
	return client.PresignTemporaryReadURL(ctx, objectKey, ttl)
}

func (s *Store) client(ctx context.Context) (*objectstore.Client, error) {
	if s == nil || strings.TrimSpace(s.cfg.Provider) == "" {
		return nil, errors.New("storage is not configured")
	}
	s.clientMu.Lock()
	defer s.clientMu.Unlock()
	if s.objectStore != nil {
		return s.objectStore, nil
	}
	client, err := objectstore.New(ctx, s.cfg)
	if err != nil {
		return nil, err
	}
	s.objectStore = client
	return s.objectStore, nil
}

var _ fileapp.BlobStorage = (*Store)(nil)
