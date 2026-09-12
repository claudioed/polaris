---

title: "Getting started"
description: "Run the Polaris stack locally with Docker Compose or bare Go."
---

# Getting started

## Prerequisites

- Docker with Compose (Postgres 18.4, Prometheus, and the two Polaris images run in containers)
- A Google Cloud **OAuth 2.0 Web application** client (for OIDC authentication)
- Node 24 and Go 1.26 only if you plan to develop outside Docker

## 1. Configure the environment

```sh
cp .env.example .env
```

Set the two mandatory secrets in `.env`:

| Variable | Purpose |
| --- | --- |
| `POLARIS_OIDC_CLIENT_ID` | Google OAuth client ID. The same value is passed to the control tower build as `VITE_GOOGLE_CLIENT_ID`. |
| `POLARIS_INGEST_SECRET_KEY` | Shared ingest secret, e.g. `openssl rand -base64 32`. Producers send it as `X-API-Key`. |

The process **refuses to start** without both values, and it fails fast if OIDC discovery cannot
reach the issuer (`POLARIS_OIDC_ISSUER`, default `https://accounts.google.com`).

:::tip Creating the Google client

In Google Cloud Console, create an OAuth 2.0 **Web application** client and add the control tower
origins (`http://localhost:3000` and `http://localhost:5173`) as authorized JavaScript origins.

:::

## 2. Start the stack

```sh
docker compose up --build
```

| Service | URL |
| --- | --- |
| Control tower | http://localhost:3000 |
| API | http://localhost:8080/api/v1 |
| Live OpenAPI contract | http://localhost:8080/openapi.yaml |
| PostgreSQL | `localhost:5432` |
| Development Prometheus | http://localhost:9090 |

If a host port is already in use, override `POLARIS_CONTROL_TOWER_PORT`, `POLARIS_HTTP_PORT`,
`POLARIS_POSTGRES_PORT`, or `POLARIS_PROMETHEUS_PORT` in `.env`. Container ports and
service-to-service addresses stay unchanged.

Database migrations run automatically on boot and are safe to re-run.

## 3. Run the Go process outside Docker

```sh
docker compose up -d postgres prometheus
go run ./cmd/polaris
```

## 4. Development lifecycle

```sh
make generate      # regenerate OpenAPI server bindings
make test          # unit tests
make coverage      # coverage gate (>= 90%)
make integration   # PostgreSQL + full-stack suites (testcontainers-go)
make mutation      # mutation testing (go-gremlins)
make build         # build the binary
make web-test      # control tower tests
make web-build     # build the control tower
```

`make integration` boots an ephemeral `postgres:18.4-alpine`, so a Docker daemon must be reachable.
Set `POLARIS_SKIP_INTEGRATION=1` to skip, or point `POLARIS_TEST_DATABASE_URL` at an
already-migrated database. The full-stack suite wires the real router with the production OIDC and
ingest-key authenticators against an in-process fake issuer (`internal/adapters/httpapi/oidctest`).

## 5. Control tower UI development

```sh
make web-install
make web-dev
```

Vite serves the control tower at http://localhost:5173 and proxies API requests to port 8080.

## 6. First requests

Sign in to the control tower with the authorized Google account, or call the API directly:

```sh
# Health probes are anonymous
curl -s http://localhost:8080/api/v1/health/ready | jq

# Business routes need a Google ID token
curl -s http://localhost:8080/api/v1/tribes \
  -H "Authorization: Bearer $GOOGLE_ID_TOKEN" | jq
```

See [Authentication](./authentication.md) for token acquisition and the full
[REST API reference](/api/polaris-api) for every operation.
