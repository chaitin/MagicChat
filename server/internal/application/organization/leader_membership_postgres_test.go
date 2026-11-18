package organization

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func leaderMembershipPostgresDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("POSTGRES_TEST_DSN"))
	if dsn == "" {
		t.Skip("POSTGRES_TEST_DSN is not configured")
	}
	base, err := store.OpenPostgres(dsn)
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := base.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = baseSQL.Close() })
	schema := "leader_membership_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := base.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
			t.Errorf("清理独立测试schema: %v", err)
		}
	})
	testDSN := dsn + " search_path=" + schema
	if strings.Contains(dsn, "://") {
		u, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		q := u.Query()
		q.Set("search_path", schema)
		u.RawQuery = q.Encode()
		testDSN = u.String()
	}
	db, err := store.OpenPostgres(testDSN)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := store.RunPostgresMigrations(db, "../../../migrations"); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestPostgresConcurrentLeadersPreserveAllMemberships(t *testing.T) {
	db := leaderMembershipPostgresDB(t)
	s := NewService(db)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	first := testOrganizationUser(t, db, "负责人一")
	second := testOrganizationUser(t, db, "负责人二")
	a := leaderTestDepartment(t, s, store.RootOrganizationUnitID, store.RootDepartmentID, "研发")
	b := leaderTestDepartment(t, s, store.RootOrganizationUnitID, store.RootDepartmentID, "销售")
	ready := make(chan struct{}, 2)
	release := make(chan struct{})
	// Force both transactions to hold their leader foreign-key locks before adding memberships.
	if err := db.Callback().Create().After("gorm:create").Register("test:leader-membership-barrier", func(tx *gorm.DB) {
		if tx.Statement.Table != "organization_department_leaders" {
			return
		}
		ready <- struct{}{}
		select {
		case <-release:
		case <-ctx.Done():
			tx.AddError(ctx.Err())
		}
	}); err != nil {
		t.Fatal(err)
	}
	results := make(chan error, 2)
	go func() {
		results <- s.SetDepartmentLeaders(ctx, "admin", a.ID, []Leader{{UserID: first, IsPrimary: true}, {UserID: second}})
	}()
	go func() {
		results <- s.SetDepartmentLeaders(ctx, "admin", b.ID, []Leader{{UserID: second, IsPrimary: true}, {UserID: first}})
	}()
	for i := 0; i < 2; i++ {
		select {
		case <-ready:
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	close(release)
	for i := 0; i < 2; i++ {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	for _, user := range []string{first, second} {
		assignments, err := s.Assignments(ctx, user)
		if err != nil || len(assignments) != 3 {
			t.Fatalf("并发加入丢失归属: %+v, %v", assignments, err)
		}
		found := map[string]bool{}
		for _, assignment := range assignments {
			found[assignment.DepartmentID] = true
			if assignment.IsPrimary != (assignment.DepartmentID == store.RootDepartmentID) {
				t.Fatalf("并发加入改变主归属: %+v", assignments)
			}
		}
		if !found[a.ID] || !found[b.ID] || !found[store.RootDepartmentID] {
			t.Fatalf("归属不完整: %+v", assignments)
		}
	}
}
