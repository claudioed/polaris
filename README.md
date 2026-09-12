# Polaris

Polaris is a squad-owned architectural fitness-function control plane. It receives pipeline measurements, pulls Prometheus measurements, evaluates versioned criteria, and retains evidence, lifecycle history, audit events, and delivery events.

The business and domain model is in [polaris.md](polaris.md). The REST contract is [api/openapi.yaml](api/openapi.yaml).

## Architecture

The service uses Go and hexagonal architecture:

- `internal/domain/fitness`: aggregates, value objects, lifecycle rules, and deterministic evaluation;
- `internal/application`: use cases and inbound/outbound ports;
- `internal/adapters/httpapi`: REST receiver with Google OIDC and ingest API-key authentication;
- `internal/adapters/prometheus`: provider adapter for instant and range PromQL queries;
- `internal/adapters/postgres`: PostgreSQL persistence, migrations, schedules, and transactional outbox;
- `cmd/polaris`: one process containing the HTTP API and scheduled-collection worker.
- `web`: React and TypeScript control tower for discovering and creating fitness functions.

PostgreSQL 18.4 is the system of record. Provider-specific behavior stays behind the collector port so another adapter, such as Grafana, can be introduced without changing the fitness-function domain.

## Authentication

All business endpoints require a Google OpenID Connect ID token sent as `Authorization: Bearer <id_token>`. Polaris verifies the token's issuer, audience, expiry, and signature against Google's published JWKS at startup and per request, then authorizes only the verified email configured by `POLARIS_AUTHORIZED_EMAIL` (default `claudioed.oliveira@gmail.com`). Other valid Google accounts receive `403 Forbidden`. The two ingest endpoints — `POST /fitness-functions/{fitnessFunctionId}/measurement-submissions` and `POST /measurement-submission-batches` — are the exception: they authenticate with a shared secret via the `X-API-Key` header (compared in constant time) so measurement producers do not need Google identities. Health probes (`/api/v1/health/*`) and the published contract (`/openapi.yaml`) stay anonymous.

Authentication is always enforced. The process refuses to start without `POLARIS_OIDC_CLIENT_ID` and `POLARIS_INGEST_SECRET_KEY`, and it fails fast if OIDC discovery cannot reach the issuer (`POLARIS_OIDC_ISSUER`, default `https://accounts.google.com`).

To create credentials:

1. In Google Cloud Console, create an OAuth 2.0 **Web application** client. Add the control tower origin (e.g. `http://localhost:3000` and `http://localhost:5173`) as an authorized JavaScript origin.
2. Copy the client ID into `.env` as `POLARIS_OIDC_CLIENT_ID` (compose passes the same value to the API and, as `VITE_GOOGLE_CLIENT_ID`, to the control tower build).
3. Set `POLARIS_AUTHORIZED_EMAIL=claudioed.oliveira@gmail.com` to identify the only Google account allowed into the control tower.
4. Generate an ingest secret, e.g. `openssl rand -base64 32`, and set `POLARIS_INGEST_SECRET_KEY` in `.env`. Distribute it to measurement producers, which must send it as `X-API-Key`.

HTTP-originated audit events use the authenticated principal's subject; worker activity is system initiated. Prometheus sources still support only outbound authentication mode `NONE` in this version.

## Run

```sh
docker compose up --build
```

The control tower is available at `http://localhost:3000`. The API is available at `http://localhost:8080/api/v1`, its live contract at `http://localhost:8080/openapi.yaml`, PostgreSQL at port `5432`, and the development Prometheus instance at port `9090`.

To run the Go process outside Docker:

```sh
docker compose up -d postgres prometheus
go run ./cmd/polaris
```

Database migrations run automatically and are safe to run again.

## Development

```sh
make generate
make test
make coverage
make integration
make mutation
make build
make web-test
make web-build
```

`make coverage` enforces at least 90% statement coverage across the unit-testable domain, application, Prometheus provider, and HTTP adapter core.

`make integration` runs the PostgreSQL adapter and full-stack API suites (build tag `integration`). They use testcontainers-go to boot an ephemeral `postgres:18.4-alpine`, so a Docker daemon must be reachable; set `POLARIS_SKIP_INTEGRATION=1` to skip them, or point `POLARIS_TEST_DATABASE_URL` at an already-migrated database. The full-stack suite wires the real router with the production OIDC and ingest-key authenticators against an in-process fake issuer (`internal/adapters/httpapi/oidctest`).

`make mutation` runs mutation testing (go-gremlins, pinned as a Go tool) over the domain and application packages and fails below the efficacy threshold in [.gremlins.yaml](.gremlins.yaml). The target clears the Go test cache first: gremlins sizes each mutant's time budget from the uncached clean-run duration, and a cached baseline makes every mutant time out spuriously.

Useful environment variables are documented in [.env.example](.env.example).

## Continuous delivery

The GitHub Actions workflow in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) gates pushes and pull requests with Go and web linting, unit coverage, PostgreSQL integration tests, OpenAPI validation and generated-code drift, mutation testing, and vulnerability scans. Pull requests to `main` also scan both container images with Trivy. The full mutation suite runs weekly and on manual dispatch.

After all gates pass on `main`, the workflow publishes signed API and control-tower images to GHCR, generates and attests SBOMs, increments the patch version, and creates a GitHub release. Define the Actions secret `POLARIS_OIDC_CLIENT_ID` before the first publish so the Google client ID is embedded in the control-tower build.

For UI development, run the API and then start Vite:

```sh
make web-install
make web-dev
```

Vite serves the control tower at `http://localhost:5173` and proxies API requests to port `8080`.
