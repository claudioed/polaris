---

title: "Process (cmd/polaris)"
description: "Composition root — one process, two roles: HTTP API and scheduled-collection worker."
---

# Process — `cmd/polaris`

`main.go` is the **composition root**: it reads configuration, wires every adapter into the
application `Service`, and runs the whole system in a single process.

## Wiring

```
env config ──▶ postgres.New + Migrate        (system of record, migrations run first)
            ─▶ prometheus.New                (collector adapter, byte-capped)
            ─▶ application.NewService(       (use cases)
                  store, ids{}, clock{}, collector)
            ─▶ httpapi.New(service, auth)    (REST router + OIDC/API-key auth)
```

- `ids` — UUID generator implementing `application.IDGenerator`
- `clock` — UTC wall clock implementing `application.Clock`
- Authentication is mandatory: startup fails fast without `POLARIS_OIDC_CLIENT_ID` and
  `POLARIS_INGEST_SECRET_KEY`, or when OIDC discovery cannot reach the issuer.

## Two roles, one binary

1. **HTTP API** — serves the REST contract and the embedded `openapi.yaml` on
   `POLARIS_HTTP_ADDRESS` (default `:8080`).
2. **Scheduled-collection worker** — `runWorker` ticks every
   `POLARIS_WORKER_INTERVAL_SECONDS` (default 10s) and calls `RunScheduledCollections`, which
   atomically claims due pull collections (`ClaimDueCollections`) and executes them. Claiming
   makes the worker safe to scale horizontally.

## Configuration

All variables with defaults are read via `env`/`envInt` — see [Configuration](../introduction/configuration.md)
for the complete table.
