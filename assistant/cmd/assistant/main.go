package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"assistant/internal/appclient"
	"assistant/internal/config"
	"assistant/internal/logging"
)

func main() {
	closeLog := logging.Configure()
	defer closeLog()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	client, err := appclient.New(ctx, cfg)
	if err != nil {
		log.Fatalf("init app client: %v", err)
	}
	defer client.Close()

	log.Printf("AI assistant app client connecting to %s", cfg.WebSocketURL)
	if err := client.Run(ctx); err != nil {
		log.Fatalf("run app client: %v", err)
	}
}
