---

title: "Domain (internal/domain/fitness)"
description: "Aggregates, value objects, lifecycle rules, and deterministic evaluation."
---

# Domain — `internal/domain/fitness`

The heart of Polaris. Pure Go with **no I/O and no framework imports** — it owns the invariants
that make fitness functions trustworthy, which is why this package is the primary target of the
coverage (≥ 90%) and mutation-testing gates.

## Aggregate

`Function` is the fitness-function aggregate root (`model.go`). It guards:

| Member | Meaning |
| --- | --- |
| `Lifecycle` | `DRAFT` → `ACTIVE` → `RETIRED`, with `ErrInvalidTransition` on illegal moves |
| `Version` / `VersionState` | Numbered, immutable-once-active definitions: `DRAFT` → `ACTIVE` → `SUPERSEDED` |
| `Definition` | Objective, scope, criteria, acquisition, enforcement — validated by `Definition.Validate` |
| revision | Optimistic-concurrency counter; stale revisions yield `ErrVersionConflict` (HTTP `409`) |

Key aggregate operations:

- `New` — create a function with its first draft version
- `AddVersion` — append a draft under `If-Match` revision control
- `UpdateDraft` — mutate a **DRAFT** version only
- `Activate` — promote a version to `ACTIVE`, superseding the previous one
- `Retire` — retire the function
- `ActiveDefinition` — resolve the definition that evaluations must use

## Value objects

| Type | Notes |
| --- | --- |
| `Criterion` | `key`, Prometheus-backed `query` alias, `Comparison`, `threshold` — must be finite and use a known comparison |
| `MetricQuery` | Instant (`promql`) or range query (`start`, `end`, `step`) |
| `Acquisition` | Mode `PUSH` or `PULL`; PULL binds criterion keys to queries and schedule/timeouts |
| `Enforcement` | `OBSERVE`, `WARN`, `BLOCK` |
| `Comparison` | Six numeric comparators (`GREATER_THAN` … `NOT_EQUAL`) |

## Evaluation (`evaluation.go`)

`Evaluate(def, measurements, waived)` is **deterministic**: same definition + same measurements ⇒
same outcome. It produces:

- **Outcome**: `PASS`, `WARN`, `FAIL`, or `ERROR` (no data / unknown measurement ⇒ `ERROR`,
  because *no data is not success*)
- **Criterion results**: per-criterion actual value, threshold, and pass/fail
- **Disposition**: how the organization must react — `ACCEPTED`, `ATTENTION_REQUIRED`, `BLOCKED`,
  or `WAIVED` when a valid waiver applies

`dispositionFor` maps enforcement × outcome × waiver to the disposition; `compare` applies the
numeric comparator. Evaluations are immutable facts with retained evidence.

## Testing posture

`model_test.go` and `evaluation_test.go` exercise every transition and comparator branch;
go-gremlins mutation testing (`.gremlins.yaml`) enforces test efficacy over this package and the
application layer.
