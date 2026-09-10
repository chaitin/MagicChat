package migrations

import (
	"strings"
	"testing"
)

func TestPrivateServerMigration(t *testing.T) {
	rawSQL, err := Files.ReadFile("00003_add_private_servers.sql")
	if err != nil {
		t.Fatalf("read private server migration: %v", err)
	}
	sql := strings.ToLower(string(rawSQL))
	for _, expected := range []string{
		"create table push_servers",
		"create table push_server_keys",
		"create table push_server_daily_usage",
		"create table push_admin_sessions",
		"create table push_admin_audit_events",
		"add column server_id uuid",
		"add column quota_date date",
		"where status = 'active'",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("migration missing %q", expected)
		}
	}
}

func TestProviderRequestIdentifierMigration(t *testing.T) {
	rawSQL, err := Files.ReadFile("00002_add_provider_request_id.sql")
	if err != nil {
		t.Fatalf("read provider request identifier migration: %v", err)
	}
	sql := strings.ToLower(string(rawSQL))
	for _, expected := range []string{
		"add column provider_request_id text not null default ''",
		"drop column provider_request_id",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("migration missing %q", expected)
		}
	}
}
