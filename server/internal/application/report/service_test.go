package report

import (
	"context"
	"testing"
	"time"

	"app/internal/store"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func TestCreateDerivesReportedUserAndListsHistory(t *testing.T) {
	db := newReportTestDB(t)
	now := time.Date(2026, 9, 7, 8, 0, 0, 0, time.UTC)
	reporter := createReportTestUser(t, db, "reporter")
	target := createReportTestUser(t, db, "target")
	conversationID := createReportTestConversation(t, db, reporter.ID, store.ConversationKindDirect)
	createReportTestMember(t, db, conversationID, reporter.ID)
	createReportTestMember(t, db, conversationID, target.ID)

	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	created, err := service.Create(context.Background(), CreateCommand{
		AccountID: reporter.ID, ConversationID: conversationID,
		Reason: ReasonHarassmentOrAbuse, Description: "  持续发送辱骂内容  ",
	})
	if err != nil {
		t.Fatalf("create report: %v", err)
	}
	if created.ReportedUser.ID != target.ID || created.ReporterUser.ID != reporter.ID {
		t.Fatalf("unexpected users: %#v", created)
	}
	if created.Description != "持续发送辱骂内容" || !created.CreatedAt.Equal(now) {
		t.Fatalf("unexpected report: %#v", created)
	}

	listed, err := service.List(context.Background(), ListQuery{})
	if err != nil {
		t.Fatalf("list reports: %v", err)
	}
	if listed.Total != 1 || len(listed.Reports) != 1 || listed.Reports[0].ID != created.ID {
		t.Fatalf("unexpected list: %#v", listed)
	}
}

func TestCreateRejectsUnsupportedTargetsAndInvalidInput(t *testing.T) {
	db := newReportTestDB(t)
	reporter := createReportTestUser(t, db, "reporter-invalid")
	target := createReportTestUser(t, db, "target-invalid")
	groupID := createReportTestConversation(t, db, reporter.ID, store.ConversationKindGroup)
	createReportTestMember(t, db, groupID, reporter.ID)
	createReportTestMember(t, db, groupID, target.ID)
	service := NewService(Dependencies{DB: db})

	_, err := service.Create(context.Background(), CreateCommand{
		AccountID: reporter.ID, ConversationID: groupID,
		Reason: ReasonSpam, Description: "垃圾广告",
	})
	if ErrorCodeOf(err) != CodeNotFound {
		t.Fatalf("group error = %v", err)
	}

	_, err = service.Create(context.Background(), CreateCommand{
		AccountID: reporter.ID, ConversationID: uuid.NewString(),
		Reason: "unknown", Description: " ",
	})
	if ErrorCodeOf(err) != CodeInvalidRequest {
		t.Fatalf("invalid error = %v", err)
	}
}

func newReportTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(
		&store.User{},
		&store.Conversation{},
		&store.ConversationMember{},
		&store.UserReport{},
	); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	return db
}

func createReportTestUser(t *testing.T, db *gorm.DB, prefix string) store.User {
	t.Helper()
	now := time.Now().UTC()
	value := store.User{
		ID: uuid.NewString(), Email: prefix + "@example.com", Name: prefix,
		PasswordHash: "hash", Status: store.UserStatusActive, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Omit(clause.Associations).Create(&value).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return value
}

func createReportTestConversation(t *testing.T, db *gorm.DB, creatorID string, kind string) string {
	t.Helper()
	now := time.Now().UTC()
	value := store.Conversation{
		ID: uuid.NewString(), Kind: kind, Name: "conversation",
		CreatedByUserID: creatorID, Status: store.ConversationStatusActive,
		PostingPolicy: store.ConversationPostingPolicyOpen,
		Visibility:    store.ConversationVisibilityPrivate, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Omit(clause.Associations).Create(&value).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	return value.ID
}

func createReportTestMember(t *testing.T, db *gorm.DB, conversationID string, userID string) {
	t.Helper()
	value := store.ConversationMember{
		ConversationID: conversationID, MemberType: store.ConversationMemberTypeUser,
		MemberID: userID, Role: store.ConversationMemberRoleMember,
		JoinedAt: time.Now().UTC(), HistoryVisibleFromSeq: 1,
	}
	if err := db.Omit(clause.Associations).Create(&value).Error; err != nil {
		t.Fatalf("create member: %v", err)
	}
}
