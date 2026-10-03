---

title: "Deployment"
description: "Serving Polaris on a public domain with automatic TLS."

---

# Deployment

Polaris is same-origin by design. The control tower calls the API through the
relative path `/api/v1`, and its nginx container already proxies `/api/`,
`/openapi.yaml`, and the SPA assets; the API has no CORS layer. The public
entry point for a domain is therefore the control tower, with TLS terminated
in front of it by the optional Caddy edge service. No environment variable
takes a public URL — nothing in the app changes for a domain.

## Before you deploy

1. **DNS.** Point an A (and/or AAAA) record for the domain at the host, and
   make ports 80 and 443 reachable. `POLARIS_DOMAIN` defaults to
   `polaris-harness.cloud`.
2. **Google OAuth client.** Add `https://<domain>` as an *authorized
   JavaScript origin* on the existing Web application client at
   [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials).
   The client ID is unchanged, and the `http://localhost:3000` and
   `http://localhost:5173` origins stay for development. Google requires
   HTTPS for non-localhost origins.
3. **Secrets.** Generate a fresh ingest secret for production and set
   `POLARIS_INGEST_SECRET_KEY` (for example with `openssl rand -base64 32`).
   Distribute it to measurement producers as the `X-API-Key` value.

## Start the edge

```sh
docker compose --profile edge up --build -d
```

Caddy terminates TLS, obtains and renews a Let's Encrypt certificate for
`POLARIS_DOMAIN` (persisted in the `caddy-data` volume), and forwards
everything to the control tower:

| URL | Served by |
| --- | --- |
| `https://<domain>/` | Control tower SPA |
| `https://<domain>/api/v1/*` | Polaris HTTP API |
| `https://<domain>/openapi.yaml` | Live OpenAPI contract |

## Private by default

Every other published port binds to `127.0.0.1` on the host:

- **PostgreSQL** (`POLARIS_POSTGRES_PORT`) stays reachable only for local
  development, such as running `go run ./cmd/polaris` against the compose
  database.
- **PULL sources**: the stack ships no Prometheus of its own. Register sources
  pointing at a Prometheus reachable from the `polaris` container over a
  private network. Prometheus sources support authentication mode `NONE` only
  in this version — do not expose such an instance to the internet just for
  Polaris.
- **API and control tower** (`POLARIS_HTTP_PORT`,
  `POLARIS_CONTROL_TOWER_PORT`) stay loopback-bound because the edge proxies
  to them over the internal network.

To use a managed PostgreSQL instead of the compose one, set
`POLARIS_DATABASE_URL` with `sslmode=require`.

## Point clients at the domain

- **`polaris-measurements-action`**: set the API base URL to
  `https://<domain>/api/v1` and configure the ingest secret as the repository
  or organization secret for the `X-API-Key` header.
- **`polaris-mcp`**: set its base URL to `https://<domain>/api/v1`. The login
  flow keeps its loopback redirect URI (`http://localhost:8887`), which is
  already registered on the OAuth client and is unaffected by the domain.
