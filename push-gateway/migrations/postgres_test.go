package migrations

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/pressly/goose/v3"
)

func TestPostgresMigrationsRoundTrip(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("POSTGRES_TEST_DSN"))
	if dsn == "" {
		t.Skip("POSTGRES_TEST_DSN is not configured")
	}
	adminDB, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatalf("open PostgreSQL: %v", err)
	}
	if err := adminDB.PingContext(t.Context()); err != nil {
		_ = adminDB.Close()
		t.Fatalf("ping PostgreSQL: %v", err)
	}

	schema := "push_gateway_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := adminDB.ExecContext(t.Context(), "CREATE SCHEMA "+pq.QuoteIdentifier(schema)); err != nil {
		_ = adminDB.Close()
		t.Fatalf("create test schema: %v", err)
	}
	scopedDSN, err := postgresDSNWithSearchPath(dsn, schema)
	if err != nil {
		_, _ = adminDB.ExecContext(t.Context(), "DROP SCHEMA "+pq.QuoteIdentifier(schema)+" CASCADE")
		_ = adminDB.Close()
		t.Fatalf("scope PostgreSQL DSN: %v", err)
	}
	db, err := sql.Open("postgres", scopedDSN)
	if err != nil {
		_, _ = adminDB.ExecContext(t.Context(), "DROP SCHEMA "+pq.QuoteIdentifier(schema)+" CASCADE")
		_ = adminDB.Close()
		t.Fatalf("open scoped PostgreSQL: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
		_, _ = adminDB.Exec("DROP SCHEMA " + pq.QuoteIdentifier(schema) + " CASCADE")
		_ = adminDB.Close()
	})

	goose.SetBaseFS(Files)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("set migration dialect: %v", err)
	}
	migrateUp := func() {
		t.Helper()
		if err := goose.UpContext(t.Context(), db, "."); err != nil {
			t.Fatalf("migrate up: %v", err)
		}
	}
	migrateUp()
	assertColumnExists(t, db, schema, "push_installations", "provider_token", true)
	assertColumnExists(t, db, schema, "push_installations", "provider_token_ciphertext", false)
	assertColumnExists(t, db, schema, "push_servers", "server_key", true)
	assertTableExists(t, db, schema, "push_server_keys", false)

	validServerKey := strings.Repeat("a", 32)
	if _, err := db.ExecContext(t.Context(), `
		INSERT INTO push_servers (id, name, server_key, status, daily_quota, revision, created_at, updated_at)
		VALUES ($1, 'test', $2, 'active', 1000, 1, now(), now())
	`, uuid.NewString(), validServerKey); err != nil {
		t.Fatalf("insert server with plaintext key: %v", err)
	}
	if _, err := db.ExecContext(t.Context(), `
		INSERT INTO push_installations (
			id, provider, provider_token, platform, environment, app_version,
			management_token_hash, status, last_seen_at, created_at, updated_at
		) VALUES ($1, 'jpush', $2, 'android', 'production', '', $3, 'active', now(), now(), now())
	`, uuid.NewString(), strings.Repeat("t", 255), []byte("management-token-hash")); err != nil {
		t.Fatalf("insert maximum-length provider token: %v", err)
	}
	if _, err := db.ExecContext(t.Context(), `
		INSERT INTO push_installations (
			id, provider, provider_token, platform, environment, app_version,
			management_token_hash, status, last_seen_at, created_at, updated_at
		) VALUES ($1, 'jpush', $2, 'android', 'production', '', $3, 'active', now(), now(), now())
	`, uuid.NewString(), strings.Repeat("t", 256), []byte("management-token-hash")); err == nil {
		t.Fatal("provider token beyond the indexed length limit was accepted")
	}

	if err := goose.DownToContext(t.Context(), db, ".", 0); err != nil {
		t.Fatalf("migrate down: %v", err)
	}
	var pushTableCount int
	if err := db.QueryRowContext(t.Context(), `
		SELECT count(*)
		FROM information_schema.tables
		WHERE table_schema = $1 AND table_name LIKE 'push_%'
	`, schema).Scan(&pushTableCount); err != nil {
		t.Fatalf("count tables after down migration: %v", err)
	}
	if pushTableCount != 0 {
		t.Fatalf("push tables remaining after down migration = %d", pushTableCount)
	}
	migrateUp()
}

func postgresDSNWithSearchPath(dsn, schema string) (string, error) {
	if strings.Contains(dsn, "://") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			return "", err
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		return parsed.String(), nil
	}
	if strings.ContainsAny(schema, " '"+"\t\r\n") {
		return "", fmt.Errorf("invalid schema name")
	}
	return strings.TrimSpace(dsn) + " search_path=" + schema, nil
}

func assertColumnExists(t *testing.T, db *sql.DB, schema, table, column string, expected bool) {
	t.Helper()
	var exists bool
	if err := db.QueryRowContext(t.Context(), `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
		)
	`, schema, table, column).Scan(&exists); err != nil {
		t.Fatalf("inspect column %s.%s: %v", table, column, err)
	}
	if exists != expected {
		t.Fatalf("column %s.%s exists = %v, want %v", table, column, exists, expected)
	}
}

func assertTableExists(t *testing.T, db *sql.DB, schema, table string, expected bool) {
	t.Helper()
	var exists bool
	if err := db.QueryRowContext(t.Context(), `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = $1 AND table_name = $2
		)
	`, schema, table).Scan(&exists); err != nil {
		t.Fatalf("inspect table %s: %v", table, err)
	}
	if exists != expected {
		t.Fatalf("table %s exists = %v, want %v", table, exists, expected)
	}
}
