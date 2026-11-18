package contact

import (
	"context"
	"testing"
	"time"

	"app/internal/application/organization"
	"app/internal/store"
)

func TestOrganizationProfilePolicyDoesNotHideContactFields(t *testing.T) {
	t.Run("contact fields remain available", func(t *testing.T) {
		db := openContactTestDB(t)
		if err := db.AutoMigrate(&store.OrganizationPolicy{}, &store.OrganizationAuditEvent{}); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&store.OrganizationPolicy{ID: 1, VisibilityScope: "all", UpdatedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
		ctx := context.Background()
		org := organization.NewService(db)
		want := organization.Policy{VisibilityScope: "all"}
		if _, err := org.SetPolicy(ctx, "admin", want); err != nil {
			t.Fatal(err)
		}
		persisted, err := org.Policy(ctx)
		if err != nil || persisted != want {
			t.Fatalf("persisted policy = %+v, %v; want %+v", persisted, err, want)
		}

		viewer := insertContactTestUser(t, db, "viewer@example.test", "Viewer", store.UserStatusActive, time.Now().UTC())
		target := insertContactTestUser(t, db, "private-target@example.test", "Target", store.UserStatusActive, time.Now().UTC())
		number := "+8613988889999"
		if err := db.Model(&target).Update("phone", number).Error; err != nil {
			t.Fatal(err)
		}
		service := NewService(Dependencies{DB: db, Organization: org, Settings: fixedDirectorySettings{mode: DirectoryModeOrganization}})
		assertFields := func(user User) {
			t.Helper()
			wantEmail, wantPhone := target.Email, number
			if user.Email != wantEmail || user.Phone != wantPhone {
				t.Fatalf("contact = %+v, want email=%q phone=%q", user, wantEmail, wantPhone)
			}
		}
		listed, err := service.ListUsers(ctx, ListUsersCommand{AccountID: viewer.ID, Keyword: "Target"})
		if err != nil || len(listed.Users) != 1 {
			t.Fatalf("list = %+v, %v", listed, err)
		}
		assertFields(listed.Users[0])
		resolved, err := service.ResolveUsers(ctx, ResolveUsersCommand{AccountID: viewer.ID, UserIDs: []string{target.ID}})
		if err != nil || len(resolved.Users) != 1 {
			t.Fatalf("resolve = %+v, %v", resolved, err)
		}
		assertFields(resolved.Users[0])
		self, err := service.ResolveUsers(ctx, ResolveUsersCommand{AccountID: target.ID, UserIDs: []string{target.ID}})
		if err != nil || len(self.Users) != 1 || self.Users[0].Email != target.Email || self.Users[0].Phone != number {
			t.Fatalf("own profile = %+v, %v", self, err)
		}
		for _, search := range []struct {
			query   string
			visible bool
		}{
			{target.Email, true}, {number, true},
		} {
			results, err := service.ListUsers(ctx, ListUsersCommand{AccountID: viewer.ID, Keyword: search.query})
			if err != nil || (len(results.Users) == 1) != search.visible {
				t.Fatalf("list search %q = %+v, %v", search.query, results, err)
			}
			exact, err := service.SearchUsers(ctx, SearchUsersCommand{AccountID: viewer.ID, Query: search.query})
			if err != nil || (len(exact.UserIDs) == 1) != search.visible {
				t.Fatalf("exact search %q = %+v, %v", search.query, exact, err)
			}
		}
		exactID, err := service.SearchUsers(ctx, SearchUsersCommand{AccountID: viewer.ID, Query: target.ID})
		if err != nil || len(exactID.UserIDs) != 1 || exactID.UserIDs[0] != target.ID {
			t.Fatalf("ID search = %+v, %v", exactID, err)
		}
	})
}
