---

title: "Prometheus adapter (internal/adapters/prometheus)"
description: "Pull provider for instant and range PromQL queries behind the collector port."
---

# Prometheus adapter — `internal/adapters/prometheus`

The first **pull provider** (`client.go`). It implements the `Collector` port for the application
layer and returns only domain-neutral numbers and evidence maps — the domain never imports
Prometheus concepts.

## Capabilities

| Method | Purpose |
| --- | --- |
| `New(httpClient, maxBytes)` | Constructs the client; response bodies are capped (`POLARIS_PROMETHEUS_MAX_RESPONSE_BYTES`, default 4 MiB) to bound memory. |
| `Check(baseURL)` | Connection checks for measurement sources — verifies the source is reachable and speaks the Prometheus API. |
| `Query(baseURL, query, at, timeout)` | Executes a `MetricQuery`: **instant** or **range** PromQL, returning the measured value plus the raw evidence map. |

Internally: `samples`/`parseSample` extract float series from the vector/matrix response,
`reduce` folds multiple series with the declared operation, and `resolve` safely joins the base
URL with the API path. `fingerprint` derives stable evidence identifiers for the retained query
text.

## Provider isolation

Everything Prometheus-specific lives in this package. The application layer depends on the
`Collector` port only, so a Grafana (or other) adapter can be added later without changing
fitness-function, criterion, evaluation, or outcome semantics. Prometheus sources currently
support outbound authentication mode `NONE` only.

## Testing posture

`client_test.go` covers query parsing, reduction, error surfaces, and the byte cap with an
in-process HTTP double — no live Prometheus required.
