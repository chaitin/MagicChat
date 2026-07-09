package logging

import (
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
)

func Configure() func() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds | log.LUTC)

	logFile := strings.TrimSpace(os.Getenv("LOG_FILE"))
	if logFile == "" {
		logFile = strings.TrimSpace(os.Getenv("ASSISTANT_LOG_FILE"))
	}
	if logFile == "" {
		return func() {}
	}

	if err := os.MkdirAll(filepath.Dir(logFile), 0o755); err != nil {
		log.Printf("create log directory failed path=%s error=%v", filepath.Dir(logFile), err)
		return func() {}
	}
	file, err := os.OpenFile(logFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		log.Printf("open log file failed path=%s error=%v", logFile, err)
		return func() {}
	}

	log.SetOutput(io.MultiWriter(os.Stderr, file))
	log.Printf("assistant log file enabled path=%s", logFile)

	return func() {
		log.SetOutput(os.Stderr)
		_ = file.Close()
	}
}
