---

title: "Configuration"
description: "Environment variables understood by the Polaris API and control tower."
---

# Configuration

All configuration is environment-based. The canonical template is
[`.env.example`](https://github.com/claudioed/polaris/blob/main/.env.example).

## Required secrets

| Variable | Default | Description |
| --- | --- | --- |
| `POLARIS_OIDC_CLIENT_ID` | — | Google OAuth 2.0 client ID. **Required**; the process refuses to start without it. |
| `POLARIS_INGEST_SECRET_KEY` | — | Shared secret for the two ingest endpoints (`X-API-Key`). **Required**. |

## Core runtime

| Variable | Default | Description |
| --- | --- | --- |
| `POLARIS_DATABASE_URL` | `postgres://polaris:polaris@localhost:5432/polaris?sslmode=disable` | PostgreSQL system-of-record connection string. Migrations run automatically at boot. |
| `POLARIS_HTTP_ADDRESS` | `:8080` | Listen address for the HTTP API. |
| `POLARIS_WORKER_INTERVAL_SECONDS` | `10` | Tick interval of the scheduled-collection worker. |

## Identity and authorization

| Variable | Default | Description |
| --- | --- | --- |
| `POLARIS_OIDC_ISSUER` | `https://accounts.google.com` | OIDC issuer used for discovery and JWKS. Startup fails fast if unreachable. |
| `POLARIS_AUTHORIZED_EMAIL` | `claudioed.oliveira@gmail.com` | The only verified Google email authorized on business endpoints. |

## Prometheus provider

| Variable | Default | Description |
| --- | --- | --- |
| `POLARIS_PROMETHEUS_MAX_RESPONSE_BYTES` | `4194304` (4 MiB) | Caps Prometheus query-response size to bound memory use. |

## Docker Compose host ports

Only the *host* side changes; container ports and service-to-service addresses are fixed.

| Variable | Default |
| --- | --- |
| `POLARIS_POSTGRES_PORT` | `5432` |
| `POLARIS_PROMETHEUS_PORT` | `9090` |
| `POLARIS_HTTP_PORT` | `8080` |
| `POLARIS_CONTROL_TOWER_PORT` | `3000` |

## Control tower (build time)

| Variable | Description |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | Same Google client ID, baked into the Vite build. Compose passes `POLARIS_OIDC_CLIENT_ID` here automatically. |

## Test-only

| Variable | Description |
| --- | --- |
| `POLARIS_SKIP_INTEGRATION` | Set to `1` to skip integration suites. |
| `POLARIS_TEST_DATABASE_URL` | Point integration suites at an already-migrated database instead of testcontainers. |
