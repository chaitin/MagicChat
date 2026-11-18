package store

import (
	"os"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestMemberJobTitleMigrationMovesPrimaryTitleAndPreservesMemberships(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		"CREATE TABLE users (id text PRIMARY KEY)",
		"CREATE TABLE organization_assignments (user_id text, title varchar(160) NOT NULL DEFAULT '', is_primary boolean)",
		"INSERT INTO users (id) VALUES ('member'), ('unassigned')",
		"INSERT INTO organization_assignments (user_id, title, is_primary) VALUES ('member', '工程师', true), ('member', '旧兼任', false)",
	} {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile("../../migrations/00050_move_job_title_to_members.sql")
	if err != nil {
		t.Fatal(err)
	}
	sections := strings.Split(string(raw), "-- +goose Down")
	run := func(sql string) {
		t.Helper()
		for _, stmt := range strings.Split(sql, ";") {
			if strings.TrimSpace(stmt) == "" {
				continue
			}
			if err := db.Exec(stmt).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	run(sections[0])
	var title, blank string
	if err := db.Table("users").Select("job_title").Where("id = ?", "member").Scan(&title).Error; err != nil || title != "工程师" {
		t.Fatalf("migrated title: %q %v", title, err)
	}
	if err := db.Table("users").Select("job_title").Where("id = ?", "unassigned").Scan(&blank).Error; err != nil || blank != "" {
		t.Fatalf("unassigned title: %q %v", blank, err)
	}
	if db.Migrator().HasColumn("organization_assignments", "title") {
		t.Fatal("membership still has title column")
	}
	var count int64
	if err := db.Table("organization_assignments").Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("lost memberships: %d %v", count, err)
	}
	run(sections[1])
	if db.Migrator().HasColumn("users", "job_title") {
		t.Fatal("down migration retained member title column")
	}
	var titles []string
	if err := db.Table("organization_assignments").Pluck("title", &titles).Error; err != nil || len(titles) != 2 || titles[0] != "工程师" || titles[1] != "工程师" {
		t.Fatalf("rollback titles: %+v %v", titles, err)
	}
}
