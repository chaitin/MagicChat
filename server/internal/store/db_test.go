package store

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"log"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestPostgresPoolReusesConnectionsAcrossBursts(t *testing.T) {
	db := newPoolTestDB(t)
	configurePostgresPool(db)

	// A burst exceeding database/sql's default two idle connections must
	// survive release so the next burst does not reconnect and authenticate.
	const burstSize = 10
	for wave := 0; wave < 2; wave++ {
		connections := acquirePoolConnections(t, db, burstSize)
		for _, conn := range connections {
			if err := conn.Close(); err != nil {
				t.Fatal(err)
			}
		}
		stats := db.Stats()
		if stats.Idle != burstSize || stats.OpenConnections != burstSize || stats.MaxIdleClosed != 0 {
			t.Fatalf("wave %d did not retain connections for reuse: %+v", wave, stats)
		}
	}
}

func TestPostgresPoolBoundsConcurrentConnections(t *testing.T) {
	db := newPoolTestDB(t)
	configurePostgresPool(db)
	connections := acquirePoolConnections(t, db, postgresMaxConnections)

	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer cancel()
	conn, err := db.Conn(ctx)
	if conn != nil {
		_ = conn.Close()
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("acquire beyond pool limit: error = %v, want deadline exceeded", err)
	}
	stats := db.Stats()
	if stats.OpenConnections != postgresMaxConnections || stats.WaitCount != 1 {
		t.Fatalf("pool did not bound connections and wait: %+v", stats)
	}

	if err := connections[0].Close(); err != nil {
		t.Fatal(err)
	}
	resumeCtx, resumeCancel := context.WithTimeout(t.Context(), time.Second)
	defer resumeCancel()
	conn, err = db.Conn(resumeCtx)
	if err != nil {
		t.Fatalf("acquire after releasing a connection: %v", err)
	}
	_ = conn.Close()
}

func newPoolTestDB(t *testing.T) *sql.DB {
	t.Helper()
	// Exercise the real database/sql pool locally, without a PostgreSQL server.
	gormDB, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	db, err := gormDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func acquirePoolConnections(t *testing.T, db *sql.DB, count int) []*sql.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	connections := make([]*sql.Conn, 0, count)
	for range count {
		conn, err := db.Conn(ctx)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = conn.Close() })
		connections = append(connections, conn)
	}
	return connections
}

func TestDatabaseLoggerSuppressesOnlyRecordNotFound(t *testing.T) {
	var output bytes.Buffer
	logger := newDatabaseLogger(log.New(&output, "", 0))
	trace := func() (string, int64) { return "SELECT 1", 0 }

	logger.Trace(context.Background(), time.Now(), trace, gorm.ErrRecordNotFound)
	if output.Len() != 0 {
		t.Fatalf("record-not-found log = %q", output.String())
	}

	logger.Trace(context.Background(), time.Now(), trace, errors.New("database unavailable"))
	if !strings.Contains(output.String(), "database unavailable") {
		t.Fatalf("database error log = %q", output.String())
	}
}
