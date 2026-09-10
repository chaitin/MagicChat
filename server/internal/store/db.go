package store

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

const (
	postgresMaxConnections     = 40
	postgresMaxIdleConnections = 20
	postgresMaxIdleTime        = 5 * time.Minute
)

func OpenPostgres(dsn string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: newDatabaseLogger(log.New(os.Stdout, "\r\n", log.LstdFlags)),
	})
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("get sql database: %w", err)
	}
	configurePostgresPool(sqlDB)

	return db, nil
}

func configurePostgresPool(db *sql.DB) {
	db.SetMaxOpenConns(postgresMaxConnections)
	// Retain enough idle connections for ordinary bursts while leaving capacity
	// for the document server, assistant, migrations, and operator sessions.
	db.SetMaxIdleConns(postgresMaxIdleConnections)
	db.SetConnMaxIdleTime(postgresMaxIdleTime)
}

func newDatabaseLogger(writer gormlogger.Writer) gormlogger.Interface {
	return gormlogger.New(writer, gormlogger.Config{
		SlowThreshold:             200 * time.Millisecond,
		LogLevel:                  gormlogger.Warn,
		IgnoreRecordNotFoundError: true,
		Colorful:                  true,
	})
}

func Ping(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("get sql database: %w", err)
	}
	if err := sqlDB.Ping(); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}

	return nil
}
