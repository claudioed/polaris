---

title: "HTTP adapter (internal/adapters/httpapi)"
description: "REST receiver with Google OIDC and ingest API-key authentication."
---

# HTTP adapter — `internal/adapters/httpapi`

The inbound adapter (`handler.go`, `auth.go`). It translates the OpenAPI contract into calls on
`application.Service` and owns **all** authentication/authorization concerns.

## Routing

Built on [chi](https://github.com/go-chi/chi) with route groups mirroring the REST contract:
`ingestRoutes`, `topologyRoutes` (tribes, squads, targets), `sourceRoutes` (sources, producers,
connection checks, query validations), `fitnessRoutes` (functions, versions, submissions,
evaluation requests, waivers), `collectionRoutes`, `insightRoutes` (overviews, history), and
`eventRoutes`. Health probes (`live`, `ready`) stay anonymous.

The server bindings in `gen/api/server.gen.go` are generated from `api/openapi.yaml`
(`make generate`); CI's `generated-code-drift` job rejects drift between spec and bindings.

## Authentication (`auth.go`)

| Route class | Mechanism |
| --- | --- |
| Business routes | Google OIDC bearer token — issuer, audience, expiry, and signature verified against Google's JWKS (cached at startup, refreshed per request). Only `POLARIS_AUTHORIZED_EMAIL` is authorized; others get `403 FORBIDDEN`. |
| Ingest routes (2) | `X-API-Key` compared in **constant time** against `POLARIS_INGEST_SECRET_KEY`. |
| Health + `/openapi.yaml` | Anonymous. |

Audit events from HTTP record the authenticated principal's subject.

## Error contract

Every non-2xx response is an RFC 9457 problem document (`application/problem+json`) with a stable
`code` (`INVALID_JSON`, `UNAUTHENTICATED`, `FORBIDDEN`, `RESOURCE_NOT_FOUND`, `RESOURCE_CONFLICT`,
`INVALID_REQUEST`, `INTERNAL_ERROR`) and a `correlationId` that also appears in server logs.

## Testing posture

`handler_test.go` and `auth_test.go` run the full-stack suite against the **production** router and
authenticators, using the in-process fake issuer `oidctest/oidctest.go` — no network, real JWT
verification semantics.
