---

title: "Ubiquitous language"
description: "The shared vocabulary of Polaris — every term has one meaning."
---

# Ubiquitous language

From the [domain specification](https://github.com/claudioed/polaris/blob/main/polaris.md) (section 4).
The code, API, and this documentation all use these terms with exactly these meanings.

## Organization

| Term | Meaning |
| --- | --- |
| **Tribe** | The topology level that groups squads. Publishes templates and sees cross-squad overviews; never takes ownership of squad fitness functions. |
| **Squad** | The owning unit of fitness targets, measurement sources, measurement producers, and fitness functions. Ownership survives tribe transfers. |

## What squads protect

| Term | Meaning |
| --- | --- |
| **Fitness target** | The system a squad is accountable for (`PRODUCT`, `SERVICE`, `DATA_PRODUCT`, …) with criticality and lifecycle (`PROPOSED` → `ACTIVE` → `DEPRECATED` → `RETIRED`). |
| **Architectural characteristic** | The quality dimension being protected, classified per ISO/IEC 25010 (performance, security, maintainability, …). |
| **Fitness function** | A named, versioned assertion that a characteristic remains fit, owned by exactly one squad. |
| **Objective** | The business-language statement of why the function exists. |
| **Criterion** | One observable, measurable rule: name, comparison, threshold, unit. |
| **Fitness-function version** | An immutable numbered definition (criteria + acquisition + enforcement). Only one version is active. |
| **Fitness-function template** | A tribe-published reusable definition that squads adopt explicitly. |

## Measuring

| Term | Meaning |
| --- | --- |
| **Acquisition mode** | `PUSH` (a producer submits) or `PULL` (Polaris collects). |
| **Measurement producer** | An authorized pipeline or system that pushes measurements (`producerId` + `externalRunId` form the dedup key). |
| **Measurement source** | A registered, checkable system Polaris can query — currently Prometheus. |
| **Provider adapter** | The implementation behind the source (Prometheus today, Grafana possible tomorrow). |
| **Metric query** | A PromQL instant or range query bound to a criterion key. |
| **Collection plan** | The schedule, timeout, and window for pull acquisition. |
| **Collection attempt** | One auditable execution of a plan — success or failure, with evidence. |
| **No data** | A condition, not a success: missing measurements yield `ERROR`, never `PASS`. |

## Judging

| Term | Meaning |
| --- | --- |
| **Evaluation request** | An ask for a function to be evaluated (async, `202` + polling). |
| **Evaluation** | The immutable, evidence-retaining result of applying the active version to measurements. |
| **Evidence** | Raw measurements, query text, and provider responses retained with the evaluation. |
| **Outcome** | `PASS`, `WARN`, `FAIL`, or `ERROR`. |
| **Disposition** | The required organizational reaction: `ACCEPTED`, `ATTENTION_REQUIRED`, `BLOCKED`, `WAIVED`. |
| **Enforcement** | The squad's declared response level: `OBSERVE`, `WARN`, `BLOCK`. |
| **Freshness** | `CURRENT`, `STALE`, or `NEVER_EVALUATED`, computed from `validUntil`. |
| **Architectural drift** | The gap between intended and observed characteristics, visible in trends and history. |
| **Waiver** | An explicit, justified, time-limited, approvable exception that changes `BLOCKED` to `WAIVED` until expiry — never hiding the underlying outcome. |
