---

title: "Aggregates"
description: "Ten aggregates, their attributes, and the invariants each one guards."
---

# Aggregates

From the domain specification (section 7). Each aggregate root guards its own invariants; every
mutation is an explicit, auditable resource in the REST API.

## Tribe (`tribeId`)

- Attributes: name, description, status `ACTIVE | ARCHIVED`, audit info.
- Invariants: unique name in the organization; archived tribes accept no new squads or templates;
  archiving never deletes squad or evaluation history.
- Squads are separate aggregates referenced by `tribeId` — a tribe may contain many.

## Squad (`squadId`)

- Attributes: `tribeId`, name, mission, status, business/technical owners, audit info.
- Invariants: belongs to exactly one tribe at a time; only active squads create targets or
  functions; archiving requires an explicit plan for active targets/functions; **transferring a
  squad moves its fitness functions with it** — ownership never changes.

## Fitness Target (`targetId`)

- Attributes: owner squad, name, `kind` (`PRODUCT` … `DEPLOYMENT_UNIT`), optional
  `externalReference`, criticality, lifecycle `PROPOSED | ACTIVE | DEPRECATED | RETIRED`.
- Invariants: exactly one accountable squad; only active/deprecated targets may be evaluated; an
  active fitness function cannot be left without an active target.

## Measurement Source (`sourceId`)

- Attributes: squad owner, provider type, base URL, outbound auth mode (`NONE` today), activation
  state.
- Operations: connection checks, query validations, activation, retirement — each retained.

## Measurement Producer (`producerId`)

- Attributes: squad owner, identity, allowed functions.
- `producerId` + `externalRunId` is the natural dedup key for pushed submissions.

## Fitness Function (`fitnessFunctionId`) — *the central aggregate*

- Entities: `FitnessFunctionVersion` (`DRAFT | ACTIVE | SUPERSEDED`), `Criterion`.
- Value objects: `Objective`, `FitnessScope`, acquisition design.
- Invariants: one active version; active versions are immutable; revisions guard concurrent
  mutation (`If-Match`, `409` on staleness); lifecycle `DRAFT | ACTIVE | RETIRED` per the rules on
  the [lifecycle page](./lifecycle-and-evaluation.md).

## Collection Attempt (`attemptId`)

- One execution of a pull plan with evidence, timing, and outcome (including failure); retryable
  via `.../retries`.

## Evaluation Request (`requestId`)

- Async evaluation ask: `202 Accepted` + polling; cancellable via `.../cancellations`.

## Evaluation (`evaluationId`)

- **Immutable.** Version used, measurements, per-criterion results, outcome, evidence, producer or
  collection attribution, freshness fields.

## Waiver (`waiverId`)

- Justification, approver, expiry, scope (function + criteria); transitions (approval/rejection)
  are explicit sub-resources; an approved waiver changes `BLOCKED` to `WAIVED` **until expiry only**.

## Fitness Function Template (`templateId`)

- Tribe-published reusable definition; squads adopt explicitly via `.../adoptions`, which copies
  into a squad-owned draft — the tribe never gains ownership.
