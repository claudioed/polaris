---

title: "Lifecycle and evaluation"
description: "Fitness-function lifecycle, deterministic outcome calculation, and enforcement."
---

# Lifecycle and evaluation

## Fitness-function lifecycle

```text
DRAFT --activate--> ACTIVE --retire--> RETIRED
                       |
                       +--activate new version--> ACTIVE
                           previous version becomes SUPERSEDED
```

| State | Properties |
| --- | --- |
| `DRAFT` | Editable by the owning squad; produces no governed evaluations; may be dry-run validated (`.../validations`). |
| `ACTIVE` | Exactly one immutable active version; accepts evaluation requests and submissions; participates in status and enforcement. |
| `RETIRED` | Terminal for normal operation; fully available for audit and historical analysis. |

The recommended workflow: identify stakeholders and the characteristic → write the objective →
state scope → define observable criteria → choose evaluator and trigger → declare evidence
freshness → choose enforcement → **dry-run** → activate → review periodically.

## Outcome calculation (deterministic)

For each criterion, Polaris validates name/type/unit, applies the declared comparison, and
calculates the criterion result while preserving the raw measurement and evidence. The overall
outcome is:

1. `ERROR` — required measurements are invalid or evaluation cannot be trusted (**no data is not success**);
2. `FAIL` — at least one required criterion fails;
3. `WARN` — none fail, at least one warns;
4. `PASS` — all required criteria pass;
5. `NOT_APPLICABLE` — only when the definition permits it and a reason is recorded.

Polaris never averages a serious failure away: informational measures may be weighted, but
required criteria remain explicit.

## Freshness (evaluated separately)

| State | Meaning |
| --- | --- |
| `CURRENT` | Latest accepted evaluation has not passed `validUntil`. |
| `STALE` | An evaluation exists but is no longer current. |
| `NEVER_EVALUATED` | No accepted evaluation exists. |

## Enforcement

| Enforcement | Passing | Warning | Failure | Error, stale, or missing |
| --- | --- | --- | --- | --- |
| `OBSERVE` | Accepted | Recorded | Recorded | Recorded as unknown |
| `WARN` | Accepted | Attention required | Attention required | Attention required |
| `BLOCK` | Accepted | Configurable (default attention required) | **Blocked** | **Blocked** |

An approved, applicable waiver changes `BLOCKED` to `WAIVED` until expiry — the underlying outcome
and freshness stay visible. Blocking decisions must always state the function and version, the
latest evaluation and evidence, the failed/errored/stale/missing criteria, any applicable waiver,
and the squad's next available action.

## REST mapping

Lifecycle actions are modeled as **subordinate resources** so every decision is auditable with its
own evidence: `.../activations`, `.../retirements`, `.../archivals`, `.../transfers`,
`.../validations`, `.../approvals`. See the [REST API reference](/api/polaris-api).
