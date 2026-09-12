---

title: "Authentication"
description: "Google OIDC for business routes, X-API-Key for measurement ingest, anonymous health probes."
---

# Authentication

Polaris enforces authentication on every deployment. There is no "auth off" mode.

## Business endpoints — Google OpenID Connect

All business endpoints require a Google OpenID Connect ID token sent as:

```
Authorization: Bearer <id_token>
```

Polaris verifies the token's **issuer, audience, expiry, and signature** against Google's published
JWKS at startup and per request. After verification, it authorizes **only** the verified email
configured by `POLARIS_AUTHORIZED_EMAIL` (default `claudioed.oliveira@gmail.com`). Other valid
Google accounts receive `403 Forbidden` with code `FORBIDDEN`; missing or invalid tokens receive
`401` with code `UNAUTHENTICATED`.

HTTP-originated audit events record the authenticated principal's subject.

## Ingest endpoints — shared API key

The two ingest endpoints are the exception to OIDC:

- `POST /fitness-functions/{fitnessFunctionId}/measurement-submissions`
- `POST /measurement-submission-batches`

They authenticate with a shared secret via the `X-API-Key` header, compared in **constant time**, so
measurement producers do not need Google identities.

## Anonymous routes

| Route | Purpose |
| --- | --- |
| `GET /api/v1/health/live` | Liveness probe |
| `GET /api/v1/health/ready` | Readiness probe (verifies PostgreSQL, `503` while it is down) |
| `GET /openapi.yaml` | The published contract |

## OpenAPI security schemes

The [REST API reference](/api/polaris-api) documents both schemes per operation:

| Scheme | Where it applies |
| --- | --- |
| `googleOidc` (bearer, OpenID Connect) | All business routes |
| `ingestApiKey` (API key header) | The two measurement-submission endpoints |

## Operational requirements

The process refuses to start without `POLARIS_OIDC_CLIENT_ID` and `POLARIS_INGEST_SECRET_KEY`, and
fails fast if OIDC discovery cannot reach the issuer (`POLARIS_OIDC_ISSUER`, default
`https://accounts.google.com`).

For testing, the full-stack suite uses an in-process fake issuer
(`internal/adapters/httpapi/oidctest`) wired through the production authenticators — no network
access required.
