//go:build integration

// Package tests exercises the full Polaris stack — real PostgreSQL store,
// real application service, real HTTP router with the production OIDC and
// ingest-key authenticators — over an in-process HTTP server.
package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/claudioed/polaris/internal/adapters/httpapi"
	"github.com/claudioed/polaris/internal/adapters/httpapi/oidctest"
	"github.com/claudioed/polaris/internal/adapters/postgres"
	"github.com/claudioed/polaris/internal/application"
	"github.com/claudioed/polaris/internal/domain/fitness"
	"github.com/google/uuid"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	clientID        = "polaris-web"
	authorizedEmail = "engineer-1@example.com"
	ingestKey       = "integration-ingest-secret"
)

func skipIfDisabled(t *testing.T) {
	t.Helper()
	if os.Getenv("POLARIS_SKIP_INTEGRATION") == "1" {
		t.Skip("POLARIS_SKIP_INTEGRATION=1")
	}
}

func startDatabase(ctx context.Context, t *testing.T) string {
	t.Helper()
	if dsn := os.Getenv("POLARIS_TEST_DATABASE_URL"); dsn != "" {
		return dsn
	}
	container, err := tcpostgres.Run(ctx, "postgres:18.4-alpine",
		tcpostgres.WithDatabase("polaris"),
		tcpostgres.WithUsername("polaris"),
		tcpostgres.WithPassword("polaris"),
		testcontainers.WithCmdArgs("-c", "fsync=off"),
		testcontainers.WithAdditionalWaitStrategyAndDeadline(60*time.Second,
			wait.ForLog("database system is ready to accept connections").WithOccurrence(2),
		),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = container.Terminate(shutdownCtx)
	})
	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("container connection string: %v", err)
	}
	return dsn
}

type stack struct {
	baseURL string
	token   string
	apiKey  string
	client  *http.Client
}

func (s stack) request(method, path, body string, headers map[string]string) (int, http.Header, map[string]any) {
	req, err := http.NewRequest(method, s.baseURL+path, strings.NewReader(body))
	if err != nil {
		panic(err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	response, err := s.client.Do(req)
	if err != nil {
		panic(err)
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(response.Body)
	var decoded map[string]any
	_ = json.Unmarshal(raw, &decoded)
	return response.StatusCode, response.Header, decoded
}

func (s stack) asUser(method, path, body string) (int, http.Header, map[string]any) {
	return s.request(method, path, body, map[string]string{"Authorization": "Bearer " + s.token})
}

func (s stack) asProducer(method, path, body string) (int, http.Header, map[string]any) {
	return s.request(method, path, body, map[string]string{"X-API-Key": s.apiKey})
}

type uuidIDs struct{}

func (uuidIDs) New() string { return uuid.NewString() }

type wallClock struct{}

func (wallClock) Now() time.Time { return time.Now().UTC() }

type okayCollector struct{}

func (okayCollector) Check(context.Context, string) error { return nil }
func (okayCollector) Query(context.Context, string, fitness.MetricQuery, time.Time, time.Duration) (float64, map[string]any, error) {
	return 100, map[string]any{"source": "integration"}, nil
}

func newStack(t *testing.T) stack {
	t.Helper()
	ctx := context.Background()

	dsn := startDatabase(ctx, t)
	if err := postgres.Migrate(ctx, dsn); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	store, err := postgres.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(store.Close)

	issuer := oidctest.New(t)
	auth, err := httpapi.NewOIDC(ctx, issuer.Server.URL, clientID, authorizedEmail)
	if err != nil {
		t.Fatalf("oidc discovery against fake issuer: %v", err)
	}
	handler := httpapi.New(
		application.NewService(store, uuidIDs{}, wallClock{}, okayCollector{}),
		auth.WithIngestKey(ingestKey),
	)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	return stack{
		baseURL: server.URL,
		token:   issuer.Token(t, issuer.Claims(clientID, "engineer-1")),
		apiKey:  ingestKey,
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

func TestAuthenticationBoundaries(t *testing.T) {
	skipIfDisabled(t)
	s := newStack(t)

	code, headers, body := s.request(http.MethodGet, "/api/v1/tribes", "", nil)
	if code != http.StatusUnauthorized || body["code"] != "UNAUTHENTICATED" {
		t.Fatalf("anonymous business call = %d %v, want 401", code, body)
	}
	if realm := headers.Get("WWW-Authenticate"); !strings.Contains(realm, "Bearer") {
		t.Fatalf("WWW-Authenticate = %q", realm)
	}

	code, _, _ = s.asProducer(http.MethodGet, "/api/v1/tribes", "")
	if code != http.StatusUnauthorized {
		t.Fatalf("ingest key on business route = %d, want 401", code)
	}

	code, _, _ = s.asUser(http.MethodPost, "/api/v1/fitness-functions/x/measurement-submissions", "{}")
	if code != http.StatusUnauthorized {
		t.Fatalf("bearer on ingest route = %d, want 401", code)
	}

	code, _, _ = s.request(http.MethodGet, "/api/v1/health/live", "", nil)
	if code != http.StatusOK {
		t.Fatalf("anonymous liveness = %d, want 200", code)
	}
	code, _, _ = s.request(http.MethodGet, "/api/v1/health/ready", "", nil)
	if code != http.StatusOK {
		t.Fatalf("anonymous readiness = %d, want 200", code)
	}
}

func TestFullStackGoldenPath(t *testing.T) {
	skipIfDisabled(t)
	s := newStack(t)

	code, _, body := s.asUser(http.MethodPost, "/api/v1/tribes", `{"name": "Commerce"}`)
	if code != http.StatusCreated {
		t.Fatalf("create tribe = %d %v", code, body)
	}
	tribeID, _ := body["id"].(string)

	code, _, body = s.asUser(http.MethodPost, fmt.Sprintf("/api/v1/tribes/%s/squads", tribeID), `{"name": "Checkout"}`)
	if code != http.StatusCreated {
		t.Fatalf("create squad = %d %v", code, body)
	}
	squadID, _ := body["id"].(string)

	code, _, body = s.asUser(http.MethodPost, fmt.Sprintf("/api/v1/squads/%s/fitness-targets", squadID), `{"name": "checkout-api"}`)
	if code != http.StatusCreated {
		t.Fatalf("create target = %d %v", code, body)
	}
	targetID, _ := body["id"].(string)

	code, _, body = s.asUser(http.MethodPost, fmt.Sprintf("/api/v1/squads/%s/measurement-producers", squadID), `{"name": "ci-pipeline"}`)
	if code != http.StatusCreated {
		t.Fatalf("create producer = %d %v", code, body)
	}
	producerID, _ := body["id"].(string)

	definition := fmt.Sprintf(`{
		"name": "Checkout latency", "purpose": "protect latency", "objective": "keep p95 low",
		"targetIds": [%q],
		"criteria": [{"key": "latency", "unit": "ms", "required": true, "failureComparison": "GREATER_THAN", "failureValue": 500}],
		"acquisition": {"mode": "PUSH", "producerId": %q, "maximumObservationAgeSeconds": 600},
		"freshnessSeconds": 300, "enforcement": "BLOCK"
	}`, targetID, producerID)
	code, headers, body := s.asUser(http.MethodPost, fmt.Sprintf("/api/v1/squads/%s/fitness-functions", squadID), definition)
	if code != http.StatusCreated {
		t.Fatalf("create function = %d %v", code, body)
	}
	functionID, _ := body["id"].(string)
	if headers.Get("ETag") != `"1"` {
		t.Fatalf("create ETag = %q", headers.Get("ETag"))
	}

	code, _, body = s.asUser(http.MethodPost, fmt.Sprintf("/api/v1/fitness-functions/%s/versions/1/activations", functionID), `{}`)
	if code != http.StatusCreated || body["lifecycle"] != "ACTIVE" {
		t.Fatalf("activate function = %d %v", code, body)
	}

	submission := fmt.Sprintf(`{"producerId": %q, "externalRunId": "run-1", "fitnessFunctionVersion": 1, "observedAt": %q, "measurements": [{"criterionKey": "latency", "unit": "ms", "value": 120}]}`,
		producerID, time.Now().UTC().Format(time.RFC3339))
	code, _, body = s.asProducer(http.MethodPost, fmt.Sprintf("/api/v1/fitness-functions/%s/measurement-submissions", functionID), submission)
	if code != http.StatusCreated {
		t.Fatalf("submit measurements = %d %v", code, body)
	}
	if body["outcome"] != "PASS" || body["replayed"] != false {
		t.Fatalf("evaluation document wrong: %v", body)
	}
	evaluationID, _ := body["evaluationId"].(string)

	code, _, body = s.asProducer(http.MethodPost, fmt.Sprintf("/api/v1/fitness-functions/%s/measurement-submissions", functionID), submission)
	if code != http.StatusCreated || body["replayed"] != true {
		t.Fatalf("duplicate submission = %d %v", code, body)
	}

	code, _, body = s.asUser(http.MethodGet, "/api/v1/evaluations/"+evaluationID, "")
	if code != http.StatusOK || body["evaluationId"] != evaluationID {
		t.Fatalf("get evaluation = %d %v", code, body)
	}

	code, _, body = s.asUser(http.MethodGet, "/api/v1/events?consumerId=integration-1", "")
	if code != http.StatusOK || len(body["items"].([]any)) == 0 {
		t.Fatalf("poll events = %d %v", code, body)
	}
	first, _ := body["items"].([]any)[0].(map[string]any)
	eventID, _ := first["id"].(string)
	code, _, body = s.asUser(http.MethodPost, "/api/v1/event-acknowledgements", fmt.Sprintf(`{"consumerId": "integration-1", "eventIds": [%q]}`, eventID))
	if code != http.StatusCreated {
		t.Fatalf("acknowledge events = %d %v", code, body)
	}

	code, _, _ = s.asUser(http.MethodGet, fmt.Sprintf("/api/v1/tribes/%s/fitness-overview", tribeID), "")
	if code != http.StatusOK {
		t.Fatalf("tribe overview = %d", code)
	}
}

func TestFullStackBatchAndScheduledPull(t *testing.T) {
	skipIfDisabled(t)
	s := newStack(t)

	code, _, body := s.asUser(http.MethodPost, "/api/v1/tribes", `{"name": "Platform"}`)
	if code != http.StatusCreated {
		t.Fatalf("create tribe = %d %v", code, body)
	}
	tribeID, _ := body["id"].(string)
	code, _, body = s.asUser(http.MethodPost, fmt.Sprintf("/api/v1/tribes/%s/squads", tribeID), `{"name": "Metrics"}`)
	if code != http.StatusCreated {
		t.Fatalf("create squad = %d %v", code, body)
	}
	squadID, _ := body["id"].(string)
	code, _, body = s.asUser(http.MethodPost, fmt.Sprintf("/api/v1/squads/%s/fitness-targets", squadID), `{"name": "metrics-api"}`)
	if code != http.StatusCreated {
		t.Fatalf("create target = %d %v", code, body)
	}
	targetID, _ := body["id"].(string)

	code, _, body = s.asUser(http.MethodPost, fmt.Sprintf("/api/v1/squads/%s/measurement-producers", squadID), `{"name": "batch-producer"}`)
	if code != http.StatusCreated {
		t.Fatalf("create producer = %d %v", code, body)
	}
	producerID, _ := body["id"].(string)

	definition := fmt.Sprintf(`{
		"name": "Metrics latency", "purpose": "protect latency", "objective": "keep p95 low",
		"targetIds": [%q],
		"criteria": [{"key": "latency", "unit": "ms", "required": true, "failureComparison": "GREATER_THAN", "failureValue": 500}],
		"acquisition": {"mode": "PUSH", "producerId": %q, "maximumObservationAgeSeconds": 600},
		"freshnessSeconds": 300, "enforcement": "OBSERVE"
	}`, targetID, producerID)
	code, _, body = s.asUser(http.MethodPost, fmt.Sprintf("/api/v1/squads/%s/fitness-functions", squadID), definition)
	if code != http.StatusCreated {
		t.Fatalf("create function = %d %v", code, body)
	}
	functionID, _ := body["id"].(string)
	code, _, body = s.asUser(http.MethodPost, fmt.Sprintf("/api/v1/fitness-functions/%s/versions/1/activations", functionID), `{}`)

	batch := fmt.Sprintf(`{"items": [
		{"fitnessFunctionId": %q, "submission": {"producerId": %q, "externalRunId": "batch-a", "fitnessFunctionVersion": 1, "observedAt": %q, "measurements": [{"criterionKey": "latency", "unit": "ms", "value": 200}]}},
		{"fitnessFunctionId": %q, "submission": {"producerId": %q, "externalRunId": "batch-b", "fitnessFunctionVersion": 9, "observedAt": %q, "measurements": [{"criterionKey": "latency", "unit": "ms", "value": 200}]}}
	]}`, functionID, producerID, time.Now().UTC().Format(time.RFC3339), functionID, producerID, time.Now().UTC().Format(time.RFC3339))
	code, _, body = s.asProducer(http.MethodPost, "/api/v1/measurement-submission-batches", batch)
	if code != http.StatusMultiStatus {
		t.Fatalf("batch submit = %d %v", code, body)
	}
	items, _ := body["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("batch items = %d", len(items))
	}
	first, _ := items[0].(map[string]any)
	second, _ := items[1].(map[string]any)
	if first["status"] != float64(http.StatusCreated) {
		t.Fatalf("first batch item = %v, want 201", first["status"])
	}
	if second["status"] != float64(http.StatusConflict) {
		t.Fatalf("second batch item = %v, want 409", second["status"])
	}
}
