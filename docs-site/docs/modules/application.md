---

title: "Application (internal/application)"
description: "Use cases and the inbound/outbound ports that connect domain and adapters."
---

# Application — `internal/application`

The use-case layer (`service.go`). It orchestrates the domain, enforces cross-aggregate rules, and
defines the **ports** that adapters implement — this is the seam that keeps the architecture
hexagonal.

## Ports

| Port | Direction | Implementations |
| --- | --- | --- |
| `Store` | outbound | `adapters/postgres.Store` — records, fitness functions, evaluations, submissions, events |
| `ScheduleStore` | outbound | `adapters/postgres.Store` — `ClaimDueCollections` for the worker |
| `Collector` | outbound | `adapters/prometheus.Client` — `Check` and `Query` |
| `IDGenerator` | infra | UUID generation (`cmd/polaris.ids`) |
| `Clock` | infra | UTC time source, injectable for deterministic tests |

## Service capabilities

**Generic resource lifecycle** — `CreateRecord`, `GetRecord`, `ListRecords` (cursor pagination),
`TransitionRecord` drive tribes, squads, fitness targets, measurement sources, producers, waivers,
templates, and lifecycle sub-resources (`activations`, `retirements`, `archivals`, `transfers`…),
each writing an audit `Event` in the same transaction.

**Fitness functions** — `CreateFitnessFunction`, `AddFitnessVersion`, `UpdateFitnessVersion`,
`ActivateFitnessVersion`, `RetireFitnessFunction`, `Get/ListFitnessFunctions` delegate invariants
to the domain aggregate and map `ErrVersionConflict` to HTTP `409`.

**Measurement acquisition**

- `Submit` (PUSH): deduplicates by the natural key `producerId` + `externalRunId`; a replay returns
  the original evaluation with `"replayed": true` and is never applied twice.
- `Collect` (PULL): executes the acquisition queries through the `Collector` port, feeds
  measurements into `fitness.Evaluate`, and persists evaluation + event atomically.
- `RunScheduledCollections`: claims due collections (`ClaimDueCollections`, batched) and runs each.

**Source operations** — `CheckMeasurementSource` (connection checks) and `ValidateSourceQuery`
(query validation with optional execution).

**Events** — `PollEvents` / `AcknowledgeEvents` implement the at-least-once delivery contract for
downstream consumers.

**Health** — `Ready` pings the store; the readiness probe surfaces `503` when PostgreSQL is down.

## Testing posture

`service_test.go` covers every use case with in-memory fakes for the ports; the fast mutation job
runs over this package together with the domain.
