package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	contract "github.com/claudioed/polaris/api"
	"github.com/claudioed/polaris/internal/adapters/httpapi"
	"github.com/claudioed/polaris/internal/adapters/postgres"
	prometheusadapter "github.com/claudioed/polaris/internal/adapters/prometheus"
	"github.com/claudioed/polaris/internal/application"
	"github.com/google/uuid"
)

type ids struct{}

func (ids) New() string {
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.NewString()
	}
	return id.String()
}

type clock struct{}

func (clock) Now() time.Time { return time.Now().UTC() }

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	databaseURL := env("POLARIS_DATABASE_URL", "postgres://polaris:polaris@localhost:5432/polaris?sslmode=disable")
	address := env("POLARIS_HTTP_ADDRESS", ":8080")
	issuer := env("POLARIS_OIDC_ISSUER", "https://accounts.google.com")
	clientID := os.Getenv("POLARIS_OIDC_CLIENT_ID")
	ingestKey := os.Getenv("POLARIS_INGEST_SECRET_KEY")
	if clientID == "" {
		logger.Error("POLARIS_OIDC_CLIENT_ID is required")
		os.Exit(1)
	}
	if ingestKey == "" {
		logger.Error("POLARIS_INGEST_SECRET_KEY is required")
		os.Exit(1)
	}

	startup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := postgres.Migrate(startup, databaseURL); err != nil {
		logger.Error("database migration failed", "error", err)
		os.Exit(1)
	}
	store, err := postgres.New(startup, databaseURL)
	if err != nil {
		logger.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer store.Close()

	collector := prometheusadapter.New(&http.Client{Timeout: 35 * time.Second}, int64(envInt("POLARIS_PROMETHEUS_MAX_RESPONSE_BYTES", 4<<20)))
	service := application.NewService(store, ids{}, clock{}, collector)
	auth, err := httpapi.NewOIDC(startup, issuer, clientID)
	if err != nil {
		logger.Error("oidc discovery failed", "error", err, "issuer", issuer)
		os.Exit(1)
	}
	apiHandler := httpapi.New(service, auth.WithIngestKey(ingestKey))
	mux := http.NewServeMux()
	mux.Handle("/api/v1/", apiHandler)
	mux.HandleFunc("/openapi.yaml", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/yaml")
		_, _ = w.Write(contract.OpenAPI)
	})

	server := &http.Server{
		Addr: address, Handler: mux,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second,
		WriteTimeout: 45 * time.Second, IdleTimeout: 60 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go runWorker(ctx, logger, service, time.Duration(envInt("POLARIS_WORKER_INTERVAL_SECONDS", 10))*time.Second)
	go func() {
		logger.Info("polaris started", "address", address, "authentication", "oidc", "issuer", issuer)
		if listenErr := server.ListenAndServe(); listenErr != nil && !errors.Is(listenErr, http.ErrServerClosed) {
			logger.Error("http server failed", "error", listenErr)
			stop()
		}
	}()
	<-ctx.Done()
	shutdown, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	if err = server.Shutdown(shutdown); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}

func runWorker(ctx context.Context, logger *slog.Logger, service *application.Service, interval time.Duration) {
	if interval < time.Second {
		interval = 10 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := service.RunScheduledCollections(ctx, 20); err != nil {
				logger.Warn("scheduled collection batch completed with errors", "error", err)
			}
		}
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(key))
	if err != nil || value < 1 {
		return fallback
	}
	return value
}
