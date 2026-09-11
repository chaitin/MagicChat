package store

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type sensitiveRecord struct {
	ID    string `gorm:"primaryKey"`
	Value string
}

func TestDatabaseLoggerDoesNotExposeQueryParameters(t *testing.T) {
	var output bytes.Buffer
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{Logger: newDatabaseLogger(&output, 0)},
	)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&sensitiveRecord{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	secret := "sensitive-provider-token"
	if err := db.Create(&sensitiveRecord{ID: uuid.NewString(), Value: secret}).Error; err != nil {
		t.Fatalf("create record: %v", err)
	}

	output.Reset()
	var records []sensitiveRecord
	err = db.Where("value = ? AND missing_column = ?", secret, 1).Find(&records).Error
	if err == nil {
		t.Fatal("invalid query unexpectedly succeeded")
	}
	logged := output.String()
	if strings.Contains(logged, secret) {
		t.Fatalf("database log exposed a query parameter: %s", logged)
	}
	if !strings.Contains(logged, "value = ?") {
		t.Fatalf("database log did not retain parameterized SQL: %s", logged)
	}

	output.Reset()
	var missing sensitiveRecord
	err = db.First(&missing, "value = ?", "missing-sensitive-token").Error
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("missing query error = %v", err)
	}
	if output.Len() != 0 {
		t.Fatalf("record-not-found query was logged: %s", output.String())
	}
}
