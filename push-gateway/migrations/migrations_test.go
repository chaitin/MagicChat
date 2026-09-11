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
		"server_key text not null unique",
		"create table push_server_daily_usage",
		"create table push_admin_sessions",
		"create table push_admin_audit_events",
		"add column server_id uuid",
		"add column quota_date date",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("migration missing %q", expected)
		}
	}
	if strings.Contains(sql, "push_server_keys") || strings.Contains(sql, "key_ciphertext") || strings.Contains(sql, "key_hash") {
		t.Fatal("private server migration still contains protected server-key storage")
	}
}

func TestInstallationMigrationStoresProviderTokenPlaintext(t *testing.T) {
	rawSQL, err := Files.ReadFile("00001_initial.sql")
	if err != nil {
		t.Fatalf("read initial migration: %v", err)
	}
	sql := strings.ToLower(string(rawSQL))
	for _, expected := range []string{
		"provider_token text not null",
		"unique (provider, environment, provider_token)",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("migration missing %q", expected)
		}
	}
	if strings.Contains(sql, "provider_token_ciphertext") || strings.Contains(sql, "provider_token_hash") {
		t.Fatal("initial migration still contains protected provider-token storage")
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
