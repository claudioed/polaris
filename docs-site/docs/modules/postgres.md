---

title: "PostgreSQL adapter (internal/adapters/postgres)"
description: "Persistence, embedded migrations, schedules, and the transactional outbox."
---

# PostgreSQL adapter — `internal/adapters/postgres`

PostgreSQL 18.4 is the **system of record**. `store.go` implements both the `Store` and
`ScheduleStore` ports over a `pgx` connection pool.

## Responsibilities

- **Records** — generic create/get/list/update for every auditable resource kind (tribes, squads,
  targets, sources, producers, waivers, templates, lifecycle sub-resources) with keyset
  (cursor) pagination.
- **Fitness functions** — dedicated tables for the aggregate (`CreateFitnessFunction`,
  `GetFitnessFunction`, `SaveFitnessFunction`, `ListFitnessFunctions`) including version rows
  (`insertVersions`) and revision-based optimistic concurrency.
- **Submissions** — `FindSubmission` by the natural key `producerId` + `externalRunId` (idempotent
  replay), `SaveSubmissionAndEvaluation` persisting submission, evaluation, and event in one
  transaction.
- **Evaluations** — immutable append + cursor-paginated reads.
- **Transactional outbox** — `AppendEvent` inside the same transaction as the state change;
  `PollEvents` / `AcknowledgeEvents` give consumers at-least-once delivery with explicit
  acknowledgement.
- **Scheduling** — `ClaimDueCollections` atomically claims due pull collections for the worker,
  so multiple replicas can scale out safely.
- **Ownership** — `OwnedTargetIDs` resolves the squad-owned fitness targets a definition may
  reference.

## Migrations (`migrate.go`)

`Migrate` applies the SQL files embedded from `migrations/` (starting at `00001_initial.sql`).
Migrations run automatically at boot, are tracked, and are safe to re-run. `mapError` translates
driver errors into domain errors (e.g. unique-constraint violations → `409 RESOURCE_CONFLICT`).

## Testing posture

`store_integration_test.go` runs under the `integration` build tag with
[testcontainers-go](https://github.com/testcontainers/testcontainers-go), booting an ephemeral
`postgres:18.4-alpine` per run — the same suites run in CI against a service container.
