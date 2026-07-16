package store

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPostgresTemporaryFileExpirationMigrationBackfillsAndRollsBack(t *testing.T) {
	baseDSN := strings.TrimSpace(os.Getenv("POSTGRES_TEST_DSN"))
	if baseDSN == "" {
		t.Skip("POSTGRES_TEST_DSN is not configured")
	}
	baseDB, err := OpenPostgres(baseDSN)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}

	schema := "temporary_file_expiration_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec("CREATE SCHEMA " + quotePostgresTestIdentifier(schema)).Error; err != nil {
		t.Fatalf("create test schema: %v", err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec("DROP SCHEMA IF EXISTS " + quotePostgresTestIdentifier(schema) + " CASCADE").Error
	})

	testDSN, err := postgresDSNWithSearchPath(baseDSN, schema)
	if err != nil {
		t.Fatalf("build postgres test dsn: %v", err)
	}
	db, err := OpenPostgres(testDSN)
	if err != nil {
		t.Fatalf("open schema postgres: %v", err)
	}
	if err := runPostgresTestMigrationsTo(db, 15); err != nil {
		t.Fatalf("migrate postgres test schema to version 15: %v", err)
	}

	createdAt := time.Date(2026, time.July, 15, 6, 30, 0, 0, time.UTC)
	standardID := uuid.NewString()
	largeID := uuid.NewString()
	if err := db.Exec(`
		INSERT INTO temporary_files (id, object_key, size_bytes, created_at)
		VALUES (?, ?, ?, ?), (?, ?, ?, ?)
	`,
		standardID, "temporary-files/legacy-standard", int64(10*1024*1024), createdAt,
		largeID, "temporary-files/legacy-large", int64(10*1024*1024+1), createdAt,
	).Error; err != nil {
		t.Fatalf("create legacy temporary files: %v", err)
	}
	if err := runPostgresTestMigrationsTo(db, 16); err != nil {
		t.Fatalf("migrate temporary file expiration: %v", err)
	}

	type expirationRow struct {
		ID        string
		ExpiresAt time.Time
	}
	var rows []expirationRow
	if err := db.Raw(`
		SELECT id, expires_at
		FROM temporary_files
		WHERE id IN (?, ?)
		ORDER BY id
	`, standardID, largeID).Scan(&rows).Error; err != nil {
		t.Fatalf("load backfilled expiration: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("backfilled row count = %d, want 2", len(rows))
	}
	expiresByID := make(map[string]time.Time, len(rows))
	for _, row := range rows {
		expiresByID[row.ID] = row.ExpiresAt
	}
	if want := createdAt.AddDate(0, 0, 180); !expiresByID[standardID].Equal(want) {
		t.Fatalf("standard expiration = %v, want %v", expiresByID[standardID], want)
	}
	if want := createdAt.AddDate(0, 0, 30); !expiresByID[largeID].Equal(want) {
		t.Fatalf("large expiration = %v, want %v", expiresByID[largeID], want)
	}

	if err := runPostgresTestMigrationsDownTo(db, 15); err != nil {
		t.Fatalf("roll back temporary file expiration: %v", err)
	}
	var expiresAtColumnCount int64
	if err := db.Raw(`
		SELECT COUNT(*)
		FROM information_schema.columns
		WHERE table_schema = ? AND table_name = 'temporary_files' AND column_name = 'expires_at'
	`, schema).Scan(&expiresAtColumnCount).Error; err != nil {
		t.Fatalf("inspect rolled-back expires_at column: %v", err)
	}
	if expiresAtColumnCount != 0 {
		t.Fatalf("expires_at column count after rollback = %d", expiresAtColumnCount)
	}
	var retainedCount int64
	if err := db.Raw("SELECT COUNT(*) FROM temporary_files WHERE id IN (?, ?)", standardID, largeID).
		Scan(&retainedCount).Error; err != nil {
		t.Fatalf("count retained temporary files: %v", err)
	}
	if retainedCount != 2 {
		t.Fatalf("retained temporary file count = %d, want 2", retainedCount)
	}
}
