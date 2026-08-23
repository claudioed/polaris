package prometheus

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/claudioed/polaris/internal/domain/fitness"
)

func TestCheck(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/-/ready" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	if err := New(server.Client(), 0).Check(context.Background(), server.URL); err != nil {
		t.Fatal(err)
	}
	if err := New(server.Client(), 1).Check(context.Background(), "file:///tmp/prom"); err == nil {
		t.Fatal("invalid URL accepted")
	}
	failing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "not ready", http.StatusServiceUnavailable)
	}))
	defer failing.Close()
	if err := New(nil, 0).Check(context.Background(), failing.URL); err == nil {
		t.Fatal("unready Prometheus accepted")
	}
}

func TestQueryScalarVectorAndMatrix(t *testing.T) {
	responses := map[string]string{
		"scalar": `{"status":"success","data":{"resultType":"scalar","result":[1,"5"]}}`,
		"vector": `{"status":"success","data":{"resultType":"vector","result":[{"metric":{"a":"1"},"value":[1,"2"]},{"metric":{"a":"2"},"value":[1,"4"]}]}}`,
		"matrix": `{"status":"success","data":{"resultType":"matrix","result":[{"metric":{},"values":[[1,"1"],[2,"3"],[3,"5"]]}]}}`,
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		_, _ = w.Write([]byte(responses[r.Form.Get("query")]))
	}))
	defer server.Close()
	client := New(server.Client(), 1024)
	now := time.Now().UTC()
	query := fitness.MetricQuery{Expression: "scalar", Mode: "INSTANT", Reduction: "LAST", SeriesPolicy: "REQUIRE_SINGLE_SERIES"}
	value, evidence, err := client.Query(context.Background(), server.URL, query, now, time.Second)
	if err != nil || value != 5 || evidence["providerType"] != "PROMETHEUS" {
		t.Fatalf("scalar query failed: %v %#v %v", value, evidence, err)
	}
	query.Expression, query.Reduction, query.SeriesPolicy = "vector", "SUM", "REDUCE_ACROSS_SERIES"
	if value, _, err = client.Query(context.Background(), server.URL, query, now, time.Second); err != nil || value != 6 {
		t.Fatalf("vector reduction failed: %v %v", value, err)
	}
	query.Expression, query.Mode, query.Reduction = "matrix", "RANGE", "AVERAGE"
	query.LookbackSecond, query.StepSecond = 60, 10
	if value, _, err = client.Query(context.Background(), server.URL, query, now, time.Second); err != nil || value != 3 {
		t.Fatalf("matrix reduction failed: %v %v", value, err)
	}
}

func TestQueryFailures(t *testing.T) {
	cases := map[string]struct {
		status int
		body   string
	}{
		"http":      {500, `{}`},
		"json":      {200, `{`},
		"api":       {200, `{"status":"error","error":"bad expression"}`},
		"empty":     {200, `{"status":"success","data":{"resultType":"vector","result":[]}}`},
		"ambiguous": {200, `{"status":"success","data":{"resultType":"vector","result":[{"value":[1,"2"]},{"value":[1,"3"]}]}}`},
		"type":      {200, `{"status":"success","data":{"resultType":"string","result":[]}}`},
		"nan":       {200, `{"status":"success","data":{"resultType":"scalar","result":[1,"NaN"]}}`},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			query := fitness.MetricQuery{Expression: "x", Mode: "INSTANT", Reduction: "LAST", SeriesPolicy: "REQUIRE_SINGLE_SERIES"}
			_, _, err := New(server.Client(), 1024).Query(context.Background(), server.URL, query, time.Now(), time.Second)
			if err == nil {
				t.Fatal("expected query error")
			}
			if name == "empty" && !errors.Is(err, ErrNoData) {
				t.Fatalf("expected no data, got %v", err)
			}
			if name == "ambiguous" && !errors.Is(err, ErrAmbiguousResult) {
				t.Fatalf("expected ambiguity, got %v", err)
			}
		})
	}
}

func TestResponseLimitAndTransportFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(strings.Repeat("x", 20)))
	}))
	defer server.Close()
	query := fitness.MetricQuery{Expression: "x", Mode: "INSTANT", Reduction: "LAST"}
	if _, _, err := New(server.Client(), 5).Query(context.Background(), server.URL, query, time.Now(), time.Second); err == nil {
		t.Fatal("response limit not enforced")
	}
	server.Close()
	if err := New(server.Client(), 10).Check(context.Background(), server.URL); err == nil {
		t.Fatal("transport error not returned")
	}
}

func TestReduceResolveAndMalformedSamples(t *testing.T) {
	tests := map[string]float64{"LAST": 4, "COUNT": 3, "MIN": 1, "MAX": 4, "SUM": 7, "AVERAGE": 7.0 / 3}
	for reduction, expected := range tests {
		got, err := reduce([]float64{1, 2, 4}, reduction)
		if err != nil || math.Abs(got-expected) > 1e-9 {
			t.Fatalf("%s = %v, %v", reduction, got, err)
		}
	}
	if _, err := reduce(nil, "SUM"); !errors.Is(err, ErrNoData) {
		t.Fatal("empty reduction accepted")
	}
	if _, err := reduce([]float64{1}, "MEDIAN"); err == nil {
		t.Fatal("unsupported reduction accepted")
	}
	if _, err := resolve("://", "/query"); err == nil {
		t.Fatal("malformed URL accepted")
	}
	if endpoint, err := resolve("https://example.com/base/", "/query"); err != nil || endpoint != "https://example.com/base/query" {
		t.Fatalf("URL resolution failed: %q %v", endpoint, err)
	}

	for _, data := range []struct {
		ResultType string `json:"resultType"`
		Result     []byte `json:"-"`
		raw        string
	}{
		{ResultType: "scalar", raw: `[]`},
		{ResultType: "vector", raw: `[{"value":[]}]`},
		{ResultType: "matrix", raw: `[{"values":[[]]}]`},
	} {
		input := struct {
			ResultType string          `json:"resultType"`
			Result     json.RawMessage `json:"result"`
		}{ResultType: data.ResultType, Result: json.RawMessage(data.raw)}
		if _, err := samples(input); err == nil {
			t.Fatalf("malformed %s accepted", data.ResultType)
		}
	}
	input := struct {
		ResultType string          `json:"resultType"`
		Result     json.RawMessage `json:"result"`
	}{ResultType: "scalar", Result: json.RawMessage(`[1,"not-a-number"]`)}
	if _, err := samples(input); err == nil {
		t.Fatal("invalid numeric sample accepted")
	}
}
