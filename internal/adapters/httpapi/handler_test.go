package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/claudioed/polaris/internal/adapters/httpapi/oidctest"
)

const observedAt = "2026-08-22T11:55:00Z"

var errStoreDown = fmt.Errorf("connection refused")

type response struct {
	code    int
	header  http.Header
	body    map[string]any
	rawBody string
}

func (r *response) str(field string) string {
	value, _ := r.body[field].(string)
	return value
}

func (r *response) items() []any {
	value, _ := r.body["items"].([]any)
	return value
}

// api drives the real router with a valid OIDC bearer token and ingest key.
type api struct {
	t       *testing.T
	handler http.Handler
	token   string
	apiKey  string
}

func newAPI(t *testing.T) (*api, *oidctest.Issuer, *memStore) {
	t.Helper()
	issuer, auth := newTestAuth(t)
	store := newMemStore()
	handler := newTestHandlerWithStore(auth, store)
	return &api{
		t:       t,
		handler: handler,
		token:   issuer.Token(t, issuer.Claims(testClientID, "user-1")),
		apiKey:  testIngestKey,
	}, issuer, store
}

func (a *api) do(method, target, body string, headers map[string]string) *response {
	a.t.Helper()
	req, err := http.NewRequest(method, target, strings.NewReader(body))
	if err != nil {
		a.t.Fatalf("build request %s %s: %v", method, target, err)
	}
	req.Header.Set("Authorization", "Bearer "+a.token)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	rec := httptest.NewRecorder()
	a.handler.ServeHTTP(rec, req)
	parsed := &response{code: rec.Code, header: rec.Header(), rawBody: rec.Body.String()}
	if rec.Body.Len() > 0 {
		var decoded map[string]any
		if jsonErr := json.Unmarshal(rec.Body.Bytes(), &decoded); jsonErr != nil {
			a.t.Fatalf("%s %s returned non-object body (%d): %s", method, target, rec.Code, rec.Body.String())
		}
		parsed.body = decoded
	}
	return parsed
}

func (a *api) get(target string) *response { return a.do(http.MethodGet, target, "", nil) }
func (a *api) post(target, body string) *response {
	return a.do(http.MethodPost, target, body, nil)
}
func (a *api) patch(target, body string, headers map[string]string) *response {
	return a.do(http.MethodPatch, target, body, headers)
}
func (a *api) ingest(target, body string) *response {
	a.t.Helper()
	rec := doRequest(a.handler, http.MethodPost, target, "", a.apiKey, body)
	parsed := &response{code: rec.Code, header: rec.Header(), rawBody: rec.Body.String()}
	if rec.Body.Len() > 0 {
		var decoded map[string]any
		if json.Unmarshal(rec.Body.Bytes(), &decoded) != nil {
			a.t.Fatalf("ingest %s returned non-object body (%d): %s", target, rec.Code, rec.Body.String())
		}
		parsed.body = decoded
	}
	return parsed
}

func (a *api) mustCode(want int, rec *response, context string) {
	a.t.Helper()
	if rec.code != want {
		a.t.Fatalf("%s: status = %d, want %d (body: %s)", context, rec.code, want, rec.rawBody)
	}
}

// seedWorkspace creates tribe -> squad -> target through the public API and
// returns their ids.
func (a *api) seedWorkspace() (tribeID, squadID, targetID string) {
	a.t.Helper()
	rec := a.post("/api/v1/tribes", `{"name": "Commerce"}`)
	a.mustCode(http.StatusCreated, rec, "create tribe")
	tribeID = rec.str("id")
	rec = a.post(fmt.Sprintf("/api/v1/tribes/%s/squads", tribeID), `{"name": "Checkout", "mission": "sell"}`)
	a.mustCode(http.StatusCreated, rec, "create squad")
	squadID = rec.str("id")
	rec = a.post(fmt.Sprintf("/api/v1/squads/%s/fitness-targets", squadID), `{"name": "checkout-api"}`)
	a.mustCode(http.StatusCreated, rec, "create target")
	targetID = rec.str("id")
	return tribeID, squadID, targetID
}

func pushDefinition(targetID string) string {
	return fmt.Sprintf(`{
		"name": "Checkout latency", "purpose": "protect latency", "objective": "keep p95 low",
		"targetIds": ["%s"],
		"criteria": [{"key": "latency", "unit": "ms", "required": true, "failureComparison": "GREATER_THAN", "failureValue": 500}],
		"acquisition": {"mode": "PUSH", "producerId": "producer-1", "maximumObservationAgeSeconds": 600},
		"freshnessSeconds": 300, "enforcement": "BLOCK"
	}`, targetID)
}

func pullDefinition(targetID, sourceID string) string {
	return fmt.Sprintf(`{
		"name": "Prometheus latency", "purpose": "protect latency", "objective": "keep p95 low",
		"targetIds": ["%s"],
		"criteria": [{"key": "latency", "unit": "ms", "required": true, "failureComparison": "GREATER_THAN", "failureValue": 500}],
		"acquisition": {"mode": "PULL", "sourceId": "%s", "trigger": "ON_DEMAND", "timeoutSeconds": 5,
			"queries": [{"criterionKey": "latency", "expression": "latency_p95", "mode": "INSTANT", "reduction": "LAST", "seriesPolicy": "REQUIRE_SINGLE_SERIES", "unit": "ms"}]},
		"freshnessSeconds": 300, "enforcement": "OBSERVE"
	}`, targetID, sourceID)
}

func (a *api) seedPushFunction() string {
	a.t.Helper()
	_, squadID, targetID := a.seedWorkspace()
	rec := a.post(fmt.Sprintf("/api/v1/squads/%s/fitness-functions", squadID), pushDefinition(targetID))
	a.mustCode(http.StatusCreated, rec, "create push function")
	fnID := rec.str("id")
	rec = a.post(fmt.Sprintf("/api/v1/fitness-functions/%s/versions/1/activations", fnID), `{}`)
	a.mustCode(http.StatusCreated, rec, "activate push function")
	return fnID
}

func TestTopologyRoutes(t *testing.T) {
	a, _, _ := newAPI(t)
	tribeID, squadID, targetID := a.seedWorkspace()

	rec := a.get("/api/v1/tribes/" + tribeID)
	a.mustCode(http.StatusOK, rec, "get tribe")
	if rec.str("kind") != "tribe" || rec.str("status") != "ACTIVE" {
		t.Fatalf("tribe document wrong: %s", rec.rawBody)
	}

	rec = a.get("/api/v1/tribes")
	a.mustCode(http.StatusOK, rec, "list tribes")
	if len(rec.items()) != 1 {
		t.Fatalf("tribe list = %d items, want 1", len(rec.items()))
	}

	rec = a.post(fmt.Sprintf("/api/v1/tribes/%s/archivals", tribeID), `{"reason": "merged"}`)
	a.mustCode(http.StatusCreated, rec, "archive tribe")
	if rec.str("status") != "ARCHIVED" {
		t.Fatalf("archived tribe status = %q", rec.str("status"))
	}

	rec = a.get(fmt.Sprintf("/api/v1/tribes/%s/squads", tribeID))
	a.mustCode(http.StatusOK, rec, "list squads")
	if len(rec.items()) != 1 {
		t.Fatalf("squad list = %d items, want 1", len(rec.items()))
	}

	rec = a.post(fmt.Sprintf("/api/v1/squads/%s/transfers", squadID), `{"tribeId": "`+tribeID+`", "reason": "reorg"}`)
	a.mustCode(http.StatusCreated, rec, "transfer squad")
	if rec.str("status") != "ACTIVE" {
		t.Fatalf("transferred squad status = %q", rec.str("status"))
	}

	rec = a.post(fmt.Sprintf("/api/v1/squads/%s/transfers", squadID), `{"reason": "no tribe"}`)
	a.mustCode(http.StatusUnprocessableEntity, rec, "transfer without tribeId")

	rec = a.post(fmt.Sprintf("/api/v1/fitness-targets/%s/lifecycle-transitions", targetID), `{"status": "DEPRECATED"}`)
	a.mustCode(http.StatusCreated, rec, "deprecate target")
	rec = a.post(fmt.Sprintf("/api/v1/fitness-targets/%s/lifecycle-transitions", targetID), `{"status": "BOGUS"}`)
	a.mustCode(http.StatusUnprocessableEntity, rec, "invalid target status")

	rec = a.post(fmt.Sprintf("/api/v1/squads/%s/measurement-producers", squadID), `{"name": "ci-pipeline"}`)
	a.mustCode(http.StatusCreated, rec, "create producer")
	if rec.str("kind") != "measurement-producer" || rec.str("status") != "ACTIVE" {
		t.Fatalf("producer document wrong: %s", rec.rawBody)
	}

	rec = a.get("/api/v1/squads/missing")
	a.mustCode(http.StatusNotFound, rec, "missing squad")
}

func TestTopologyValidation(t *testing.T) {
	a, _, _ := newAPI(t)

	cases := []struct {
		name   string
		target string
		body   string
		want   int
	}{
		{"missing name", "/api/v1/tribes", `{}`, http.StatusUnprocessableEntity},
		{"blank name", "/api/v1/tribes", `{"name": ""}`, http.StatusUnprocessableEntity},
		{"name too long", "/api/v1/tribes", fmt.Sprintf(`{"name": "%s"}`, strings.Repeat("x", 201)), http.StatusUnprocessableEntity},
		{"unknown field", "/api/v1/tribes", `{"naame": "x"}`, http.StatusBadRequest},
		{"malformed json", "/api/v1/tribes", `{not json`, http.StatusBadRequest},
		{"oversized body", "/api/v1/tribes", fmt.Sprintf(`{"name": "%s"}`, strings.Repeat("y", 2<<20)), http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := a.post(tc.target, tc.body)
			if rec.code != tc.want {
				t.Fatalf("status = %d, want %d (body: %s)", rec.code, tc.want, rec.rawBody)
			}
		})
	}

	rec := a.post("/api/v1/tribes", `{"name": "OK"}`)
	a.mustCode(http.StatusCreated, rec, "valid tribe still created")
	if loc := rec.header.Get("Location"); !strings.Contains(loc, "/api/v1/tribes/") {
		t.Fatalf("Location header = %q", loc)
	}
}

func TestMeasurementSourceRoutes(t *testing.T) {
	a, _, _ := newAPI(t)
	_, squadID, _ := a.seedWorkspace()

	rec := a.get("/api/v1/measurement-provider-types")
	a.mustCode(http.StatusOK, rec, "provider types")
	provider, _ := rec.items()[0].(map[string]any)
	if provider["type"] != "PROMETHEUS" {
		t.Fatalf("provider catalog wrong: %s", rec.rawBody)
	}

	rec = a.post(fmt.Sprintf("/api/v1/squads/%s/measurement-sources", squadID), `{"name": "prom", "providerType": "GRAPHANA"}`)
	a.mustCode(http.StatusUnprocessableEntity, rec, "invalid provider type")
	rec = a.post(fmt.Sprintf("/api/v1/squads/%s/measurement-sources", squadID), `{"name": "prom", "providerType": "PROMETHEUS"}`)
	a.mustCode(http.StatusUnprocessableEntity, rec, "missing base url")

	rec = a.post(fmt.Sprintf("/api/v1/squads/%s/measurement-sources", squadID), `{"name": "prom", "providerType": "PROMETHEUS", "baseUrl": "http://prometheus:9090"}`)
	a.mustCode(http.StatusCreated, rec, "create source")
	if rec.str("status") != "DRAFT" {
		t.Fatalf("new source status = %q, want DRAFT", rec.str("status"))
	}
	sourceID := rec.str("id")

	rec = a.post(fmt.Sprintf("/api/v1/measurement-sources/%s/connection-checks", sourceID), ``)
	a.mustCode(http.StatusAccepted, rec, "connection check")
	data, _ := rec.body["data"].(map[string]any)
	if data["status"] != "SUCCEEDED" {
		t.Fatalf("connection check status = %v, want SUCCEEDED", data["status"])
	}

	rec = a.post(fmt.Sprintf("/api/v1/measurement-sources/%s/query-validations", sourceID), `{"query": {"criterionKey": "latency", "expression": "up"}, "executeSample": false}`)
	a.mustCode(http.StatusOK, rec, "structural validation")
	if rec.body["executed"] != false {
		t.Fatalf("structural validation executed = %v", rec.body["executed"])
	}

	rec = a.post(fmt.Sprintf("/api/v1/measurement-sources/%s/query-validations", sourceID), `{"query": {"criterionKey": "latency", "expression": "up"}, "executeSample": true}`)
	a.mustCode(http.StatusOK, rec, "sample validation")
	if rec.body["sampleValue"] != float64(100) {
		t.Fatalf("sample validation value = %v, want 100", rec.body["sampleValue"])
	}

	rec = a.post(fmt.Sprintf("/api/v1/measurement-sources/%s/query-validations", sourceID), `{"query": {"criterionKey": ""}, "executeSample": false}`)
	a.mustCode(http.StatusUnprocessableEntity, rec, "invalid query")

	rec = a.post(fmt.Sprintf("/api/v1/measurement-sources/%s/activations", sourceID), `{"reason": "checked"}`)
	a.mustCode(http.StatusCreated, rec, "activate source")
	if rec.str("status") != "ACTIVE" {
		t.Fatalf("activated source status = %q", rec.str("status"))
	}
	rec = a.post(fmt.Sprintf("/api/v1/measurement-sources/%s/retirements", sourceID), `{}`)
	a.mustCode(http.StatusCreated, rec, "retire source")
	if rec.str("status") != "RETIRED" {
		t.Fatalf("retired source status = %q", rec.str("status"))
	}
	rec = a.get("/api/v1/measurement-sources/" + sourceID)
	a.mustCode(http.StatusOK, rec, "get source")
}

func TestFitnessFunctionVersioning(t *testing.T) {
	a, _, _ := newAPI(t)
	_, squadID, targetID := a.seedWorkspace()
	target := fmt.Sprintf("/api/v1/squads/%s/fitness-functions", squadID)

	rec := a.post(target, pushDefinition("unowned"))
	a.mustCode(http.StatusUnprocessableEntity, rec, "unowned target")

	rec = a.post(target, pushDefinition(targetID))
	a.mustCode(http.StatusCreated, rec, "create function")
	fnID := rec.str("id")
	if rec.str("lifecycle") != "DRAFT" {
		t.Fatalf("new function lifecycle = %q", rec.str("lifecycle"))
	}
	if etag := rec.header.Get("ETag"); etag != `"1"` {
		t.Fatalf("create ETag = %q, want \"1\"", etag)
	}

	rec = a.get("/api/v1/fitness-functions/" + fnID)
	a.mustCode(http.StatusOK, rec, "get function")
	if rec.header.Get("ETag") != `"1"` {
		t.Fatalf("get ETag = %q", rec.header.Get("ETag"))
	}
	versions, _ := rec.body["versions"].([]any)
	if len(versions) != 1 {
		t.Fatalf("versions = %d, want 1", len(versions))
	}

	rec = a.get(fmt.Sprintf("/api/v1/fitness-functions/%s/versions", fnID))
	a.mustCode(http.StatusOK, rec, "list versions")
	if len(rec.items()) != 1 {
		t.Fatalf("version list = %d items", len(rec.items()))
	}

	rec = a.post(fmt.Sprintf("/api/v1/fitness-functions/%s/versions", fnID), pushDefinition(targetID))
	a.mustCode(http.StatusUnprocessableEntity, rec, "add version without If-Match")
	rec = a.do(http.MethodPost, fmt.Sprintf("/api/v1/fitness-functions/%s/versions", fnID), pushDefinition(targetID), map[string]string{"If-Match": `"9"`})
	a.mustCode(http.StatusConflict, rec, "add version with stale If-Match")
	rec = a.do(http.MethodPost, fmt.Sprintf("/api/v1/fitness-functions/%s/versions", fnID), pushDefinition(targetID), map[string]string{"If-Match": `"1"`})
	a.mustCode(http.StatusCreated, rec, "add version")
	if rec.header.Get("ETag") != `"2"` {
		t.Fatalf("add version ETag = %q", rec.header.Get("ETag"))
	}

	rec = a.patch(fmt.Sprintf("/api/v1/fitness-functions/%s/versions/2", fnID), pushDefinition(targetID), map[string]string{"If-Match": `"1"`})
	a.mustCode(http.StatusConflict, rec, "patch with stale If-Match")
	rec = a.patch(fmt.Sprintf("/api/v1/fitness-functions/%s/versions/abc", fnID), pushDefinition(targetID), map[string]string{"If-Match": `"2"`})
	a.mustCode(http.StatusUnprocessableEntity, rec, "patch non-numeric version")
	rec = a.patch(fmt.Sprintf("/api/v1/fitness-functions/%s/versions/99", fnID), pushDefinition(targetID), map[string]string{"If-Match": `"2"`})
	a.mustCode(http.StatusConflict, rec, "patch unknown version")
	rec = a.patch(fmt.Sprintf("/api/v1/fitness-functions/%s/versions/2", fnID), strings.Replace(pushDefinition(targetID), "Checkout latency", "Latency v2", 1), map[string]string{"If-Match": `"2"`})
	a.mustCode(http.StatusOK, rec, "patch draft version")

	rec = a.post(fmt.Sprintf("/api/v1/fitness-functions/%s/versions/2/validations", fnID), `{}`)
	a.mustCode(http.StatusCreated, rec, "validate version")
	if rec.body["valid"] != true {
		t.Fatalf("validation result = %s", rec.rawBody)
	}
	rec = a.post(fmt.Sprintf("/api/v1/fitness-functions/%s/versions/99/validations", fnID), `{}`)
	a.mustCode(http.StatusNotFound, rec, "validate unknown version")

	rec = a.post(fmt.Sprintf("/api/v1/fitness-functions/%s/versions/99/activations", fnID), `{}`)
	a.mustCode(http.StatusConflict, rec, "activate unknown version")
	rec = a.post(fmt.Sprintf("/api/v1/fitness-functions/%s/versions/2/activations", fnID), `{}`)
	a.mustCode(http.StatusCreated, rec, "activate version")
	if rec.str("lifecycle") != "ACTIVE" || rec.body["activeVersion"] != float64(2) {
		t.Fatalf("activated function wrong: %s", rec.rawBody)
	}

	rec = a.get(fmt.Sprintf("/api/v1/squads/%s/fitness-functions", squadID))
	a.mustCode(http.StatusOK, rec, "list functions")
	if len(rec.items()) != 1 {
		t.Fatalf("function list = %d items", len(rec.items()))
	}

	rec = a.post(fmt.Sprintf("/api/v1/fitness-functions/%s/retirements", fnID), `{}`)
	a.mustCode(http.StatusCreated, rec, "retire function")
	if rec.str("lifecycle") != "RETIRED" {
		t.Fatalf("retired lifecycle = %q", rec.str("lifecycle"))
	}
	rec = a.post(fmt.Sprintf("/api/v1/fitness-functions/%s/retirements", fnID), `{}`)
	a.mustCode(http.StatusConflict, rec, "double retire")

	rec = a.get("/api/v1/fitness-functions/missing")
	a.mustCode(http.StatusNotFound, rec, "missing function")
}

func TestWaiverRoutes(t *testing.T) {
	a, _, _ := newAPI(t)
	fnID := a.seedPushFunction()
	base := fmt.Sprintf("/api/v1/fitness-functions/%s/waivers", fnID)

	rec := a.post(base, `{"reason": ""}`)
	a.mustCode(http.StatusUnprocessableEntity, rec, "waiver without reason")
	rec = a.post(base, fmt.Sprintf(`{"reason": "%s"}`, strings.Repeat("r", 2001)))
	a.mustCode(http.StatusUnprocessableEntity, rec, "waiver reason too long")

	rec = a.post(base, `{"reason": "legacy behavior", "criterionKeys": ["latency"]}`)
	a.mustCode(http.StatusCreated, rec, "create waiver")
	if rec.str("status") != "PROPOSED" {
		t.Fatalf("waiver status = %q", rec.str("status"))
	}
	waiverID := rec.str("id")

	for _, transition := range []struct {
		path   string
		status string
	}{{"approvals", "APPROVED"}, {"rejections", "REJECTED"}, {"revocations", "REVOKED"}} {
		rec = a.post(fmt.Sprintf("/api/v1/waivers/%s/%s", waiverID, transition.path), `{}`)
		a.mustCode(http.StatusCreated, rec, "waiver "+transition.path)
		if rec.str("status") != transition.status {
			t.Fatalf("waiver %s status = %q, want %q", transition.path, rec.str("status"), transition.status)
		}
	}

	rec = a.post(fmt.Sprintf("/api/v1/waivers/%s/disappearances", waiverID), `{}`)
	a.mustCode(http.StatusUnprocessableEntity, rec, "unknown waiver transition")
}

func TestEvaluationRequestRoutes(t *testing.T) {
	a, _, _ := newAPI(t)
	fnID := a.seedPushFunction()

	rec := a.post(fmt.Sprintf("/api/v1/fitness-functions/%s/evaluation-requests", fnID), `{}`)
	a.mustCode(http.StatusAccepted, rec, "create evaluation request")
	if rec.str("status") != "PENDING" {
		t.Fatalf("request status = %q", rec.str("status"))
	}
	requestID := rec.str("id")

	rec = a.get("/api/v1/evaluation-requests/" + requestID)
	a.mustCode(http.StatusOK, rec, "get evaluation request")

	rec = a.post(fmt.Sprintf("/api/v1/evaluation-requests/%s/cancellations", requestID), `{}`)
	a.mustCode(http.StatusCreated, rec, "cancel evaluation request")
	if rec.str("status") != "CANCELLED" {
		t.Fatalf("cancelled status = %q", rec.str("status"))
	}
}

func TestSubmissionRoutes(t *testing.T) {
	a, _, _ := newAPI(t)
	fnID := a.seedPushFunction()
	target := fmt.Sprintf("/api/v1/fitness-functions/%s/measurement-submissions", fnID)
	submission := fmt.Sprintf(`{"producerId": "producer-1", "externalRunId": "run-1", "fitnessFunctionVersion": 1, "observedAt": %q, "measurements": [{"criterionKey": "latency", "unit": "ms", "value": 100}]}`, observedAt)

	rec := a.ingest(target, submission)
	a.mustCode(http.StatusCreated, rec, "submit measurements")
	if rec.body["replayed"] != false {
		t.Fatalf("first submission replayed = %v", rec.body["replayed"])
	}
	if rec.body["outcome"] != "PASS" {
		t.Fatalf("evaluation outcome = %v", rec.body["outcome"])
	}
	evaluationID := rec.str("evaluationId")

	rec = a.ingest(target, submission)
	a.mustCode(http.StatusCreated, rec, "replay measurements")
	if rec.body["replayed"] != true {
		t.Fatalf("duplicate submission replayed = %v", rec.body["replayed"])
	}

	wrongVersion := strings.Replace(submission, "run-1", "run-2", 1)
	wrongVersion = strings.Replace(wrongVersion, `"fitnessFunctionVersion": 1`, `"fitnessFunctionVersion": 9`, 1)
	rec = a.ingest(target, wrongVersion)
	a.mustCode(http.StatusConflict, rec, "submit wrong version")

	stale := strings.Replace(submission, "run-1", "run-3", 1)
	stale = strings.Replace(stale, observedAt, "2026-08-22T08:00:00Z", 1)
	rec = a.ingest(target, stale)
	a.mustCode(http.StatusUnprocessableEntity, rec, "submit stale observation")

	rec = a.get("/api/v1/evaluations/" + evaluationID)
	a.mustCode(http.StatusOK, rec, "get evaluation")
	if rec.body["evaluationId"] != evaluationID {
		t.Fatalf("evaluation document id mismatch: %s", rec.rawBody)
	}

	rec = a.get(fmt.Sprintf("/api/v1/fitness-functions/%s/evaluations", fnID))
	a.mustCode(http.StatusOK, rec, "list evaluations")
	if len(rec.items()) != 1 {
		t.Fatalf("evaluation list = %d items", len(rec.items()))
	}

	rec = a.get("/api/v1/evaluations/missing")
	a.mustCode(http.StatusNotFound, rec, "missing evaluation")
}

func TestSubmissionBatchRoute(t *testing.T) {
	a, _, _ := newAPI(t)
	fnID := a.seedPushFunction()
	good := fmt.Sprintf(`{"fitnessFunctionId": %q, "submission": {"producerId": "producer-1", "externalRunId": "batch-1", "fitnessFunctionVersion": 1, "observedAt": %q, "measurements": [{"criterionKey": "latency", "unit": "ms", "value": 100}]}}`, fnID, observedAt)
	missing := fmt.Sprintf(`{"fitnessFunctionId": "missing", "submission": {"producerId": "p", "externalRunId": "batch-2", "fitnessFunctionVersion": 1, "observedAt": %q, "measurements": []}}`, observedAt)
	broken := `{"fitnessFunctionId": "x", "submission": 123}`

	rec := a.ingest("/api/v1/measurement-submission-batches", fmt.Sprintf(`{"items": [%s, %s, %s]}`, good, missing, broken))
	a.mustCode(http.StatusMultiStatus, rec, "submit batch")
	entries := rec.items()
	if len(entries) != 3 {
		t.Fatalf("batch items = %d, want 3", len(entries))
	}
	first, _ := entries[0].(map[string]any)
	if first["status"] != float64(201) {
		t.Fatalf("first batch item status = %v, want 201", first["status"])
	}
	second, _ := entries[1].(map[string]any)
	if second["status"] != float64(404) {
		t.Fatalf("second batch item status = %v, want 404", second["status"])
	}
	third, _ := entries[2].(map[string]any)
	if third["status"] != float64(400) {
		t.Fatalf("third batch item status = %v, want 400", third["status"])
	}
}

func TestCollectionRoutes(t *testing.T) {
	a, _, _ := newAPI(t)
	_, squadID, targetID := a.seedWorkspace()

	rec := a.post(fmt.Sprintf("/api/v1/squads/%s/measurement-sources", squadID), `{"name": "prom", "providerType": "PROMETHEUS", "baseUrl": "http://prometheus:9090"}`)
	a.mustCode(http.StatusCreated, rec, "create source")
	sourceID := rec.str("id")
	a.post(fmt.Sprintf("/api/v1/measurement-sources/%s/activations", sourceID), `{}`)

	rec = a.post(fmt.Sprintf("/api/v1/squads/%s/fitness-functions", squadID), pullDefinition(targetID, sourceID))
	a.mustCode(http.StatusCreated, rec, "create pull function")
	fnID := rec.str("id")
	a.post(fmt.Sprintf("/api/v1/fitness-functions/%s/versions/1/activations", fnID), `{}`)

	rec = a.post(fmt.Sprintf("/api/v1/fitness-functions/%s/collection-attempts", fnID), `{}`)
	a.mustCode(http.StatusAccepted, rec, "collect")
	if rec.body["acquisitionMode"] != "PULL" {
		t.Fatalf("collection acquisition mode = %v", rec.body["acquisitionMode"])
	}
	attemptID := rec.str("originId")

	rec = a.get(fmt.Sprintf("/api/v1/fitness-functions/%s/collection-attempts", fnID))
	a.mustCode(http.StatusOK, rec, "list collection attempts")
	if len(rec.items()) != 1 {
		t.Fatalf("attempt list = %d items", len(rec.items()))
	}

	rec = a.get("/api/v1/collection-attempts/" + attemptID)
	a.mustCode(http.StatusOK, rec, "get collection attempt")
	if rec.str("status") != "SUCCEEDED" {
		t.Fatalf("attempt status = %q", rec.str("status"))
	}

	rec = a.post(fmt.Sprintf("/api/v1/collection-attempts/%s/retries", attemptID), `{}`)
	a.mustCode(http.StatusAccepted, rec, "retry collection")

	rec = a.post("/api/v1/collection-attempts/missing/retries", `{}`)
	a.mustCode(http.StatusNotFound, rec, "retry missing attempt")
}

func TestInsightRoutes(t *testing.T) {
	a, _, _ := newAPI(t)
	tribeID, squadID, _ := a.seedWorkspace()

	rec := a.get(fmt.Sprintf("/api/v1/tribes/%s/fitness-function-templates", tribeID))
	a.mustCode(http.StatusOK, rec, "list templates")
	if len(rec.items()) != 0 {
		t.Fatalf("template list = %d items, want 0", len(rec.items()))
	}

	rec = a.post(fmt.Sprintf("/api/v1/tribes/%s/fitness-function-templates", tribeID), `{"name": "latency template"}`)
	a.mustCode(http.StatusCreated, rec, "create template")
	templateID := rec.str("id")

	rec = a.post(fmt.Sprintf("/api/v1/fitness-function-templates/%s/adoptions", templateID), `{}`)
	a.mustCode(http.StatusUnprocessableEntity, rec, "adopt without squadId")
	rec = a.post(fmt.Sprintf("/api/v1/fitness-function-templates/%s/adoptions", templateID), fmt.Sprintf(`{"squadId": %q}`, squadID))
	a.mustCode(http.StatusCreated, rec, "adopt template")

	rec = a.get(fmt.Sprintf("/api/v1/squads/%s/fitness-overview", squadID))
	a.mustCode(http.StatusOK, rec, "squad overview")
	if rec.body["scope"] != "squad" || rec.body["status"] != "AVAILABLE" {
		t.Fatalf("squad overview wrong: %s", rec.rawBody)
	}
	rec = a.get(fmt.Sprintf("/api/v1/tribes/%s/fitness-overview", tribeID))
	a.mustCode(http.StatusOK, rec, "tribe overview")
	if rec.body["scope"] != "tribe" {
		t.Fatalf("tribe overview wrong: %s", rec.rawBody)
	}
}

func TestEventRoutes(t *testing.T) {
	a, _, _ := newAPI(t)
	_, _, _ = a.seedWorkspace()

	rec := a.get("/api/v1/events")
	a.mustCode(http.StatusBadRequest, rec, "poll without consumerId")

	rec = a.get("/api/v1/events?consumerId=consumer-1")
	a.mustCode(http.StatusOK, rec, "poll events")
	if len(rec.items()) == 0 {
		t.Fatal("expected outbox events after seeding")
	}
	first, _ := rec.items()[0].(map[string]any)
	eventID, _ := first["id"].(string)

	rec = a.post("/api/v1/event-acknowledgements", fmt.Sprintf(`{"consumerId": "consumer-1", "eventIds": [%q]}`, eventID))
	a.mustCode(http.StatusCreated, rec, "acknowledge events")
	if rec.body["consumerId"] != "consumer-1" {
		t.Fatalf("ack document wrong: %s", rec.rawBody)
	}

	rec = a.get("/api/v1/events?consumerId=consumer-1&cursor=9999")
	a.mustCode(http.StatusOK, rec, "poll past end")
	if len(rec.items()) != 0 {
		t.Fatalf("events past end = %d items", len(rec.items()))
	}
}

func TestPaginationClamping(t *testing.T) {
	a, _, _ := newAPI(t)
	_, squadID, _ := a.seedWorkspace()
	for _, name := range []string{"a", "b"} {
		rec := a.post(fmt.Sprintf("/api/v1/squads/%s/fitness-targets", squadID), fmt.Sprintf(`{"name": %q}`, name))
		a.mustCode(http.StatusCreated, rec, "create target "+name)
	}

	rec := a.get(fmt.Sprintf("/api/v1/squads/%s/fitness-targets?limit=2", squadID))
	a.mustCode(http.StatusOK, rec, "first page")
	if len(rec.items()) != 2 {
		t.Fatalf("first page = %d items, want 2", len(rec.items()))
	}
	cursor, _ := rec.body["nextCursor"].(string)
	if cursor == "" {
		t.Fatal("first page missing nextCursor")
	}

	rec = a.get(fmt.Sprintf("/api/v1/squads/%s/fitness-targets?limit=2&cursor=%s", squadID, cursor))
	a.mustCode(http.StatusOK, rec, "second page")
	if len(rec.items()) != 1 {
		t.Fatalf("second page = %d items, want 1", len(rec.items()))
	}

	rec = a.get(fmt.Sprintf("/api/v1/squads/%s/fitness-targets?limit=0", squadID))
	a.mustCode(http.StatusOK, rec, "default limit")
	if len(rec.items()) != 3 {
		t.Fatalf("default limit page = %d items", len(rec.items()))
	}
}

func TestReadinessFailsWhenStoreIsDown(t *testing.T) {
	_, auth := newTestAuth(t)
	store := newMemStore()
	store.pingErr = errStoreDown
	handler := newTestHandlerWithStore(auth, store)

	rec := doRequest(handler, http.MethodGet, "/api/v1/health/ready", "", "", "")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("readiness = %d, want 503", rec.Code)
	}
	if rec.Header().Get("Retry-After") != "5" {
		t.Fatalf("Retry-After = %q, want 5", rec.Header().Get("Retry-After"))
	}
}

func TestInternalErrorMapsToProblem(t *testing.T) {
	issuer, auth := newTestAuth(t)
	store := newMemStore()
	store.updateErr = errStoreDown
	handler := newTestHandlerWithStore(auth, store)
	a := &api{t: t, handler: handler, token: issuer.Token(t, issuer.Claims(testClientID, "user-1"))}

	store.createErr = errStoreDown
	rec := a.post("/api/v1/tribes", `{"name": "Commerce"}`)
	a.mustCode(http.StatusInternalServerError, rec, "create failure surfaces as 500")

	store.createErr = nil
	rec = a.post("/api/v1/tribes", `{"name": "Commerce"}`)
	a.mustCode(http.StatusCreated, rec, "create works")
	// Transition hits UpdateRecord which the store fails.
	rec = a.post(fmt.Sprintf("/api/v1/tribes/%s/archivals", rec.str("id")), `{}`)
	a.mustCode(http.StatusInternalServerError, rec, "store failure surfaces as 500")
	if rec.body["code"] != "INTERNAL_ERROR" {
		t.Fatalf("problem code = %v", rec.body["code"])
	}

	store.createErr = errStoreDown
	rec = a.post("/api/v1/fitness-functions/fn-1/evaluation-requests", `{}`)
	a.mustCode(http.StatusInternalServerError, rec, "evaluation request create failure")
	rec = a.get("/api/v1/evaluations/missing")
	a.mustCode(http.StatusNotFound, rec, "missing evaluation")
}
