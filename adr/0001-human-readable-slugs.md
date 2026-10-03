# ADR 0001: Human-readable slugs for Tribe, Squad, and Fitness Function

Status: Accepted; implemented (contract, storage, and lookup logic all delivered — see
Amendment below for a correction made during implementation)
Date: 2026-10-03

## Context

Tribe, Squad, and FitnessFunction are addressed exclusively by UUID (`Id`, `format: uuid`)
today. Every caller that is not reading from the control-tower UI — CI workflows,
`polaris-mcp`, scripts — has to resolve a human-meaningful name to a UUID once, then paste
or cache that UUID everywhere it's needed.

This became concrete friction while designing a multi-fitness-function CI workflow for a
consuming repo: a per-repo manifest (`.polaris/fitness-functions.yml`) listing which fitness
function each CI job submits to needs a `fitnessFunctionId` per entry, and the only way to
get one is `vars.POLARIS_CODE_QUALITY_FF_ID`-style indirection — an opaque UUID hidden behind
a repository variable, copy-pasted once from a `polaris-mcp` lookup and never looked at again.
That indirection exists purely because there is no human-typeable identifier to use directly.

The same friction hits `polaris-mcp`: an LLM driving `polaris_fitness_functions.get` has to
already know or have just looked up a UUID; a wrong digit produces a `404` with no hint about
which fitness function was meant, versus a slug typo which is at least legible.

## Decision

Add an optional, human-readable `slug` to **Tribe**, **Squad**, and **FitnessFunction** only
— not to every resource kind, and explicitly not to `producerId` (see Non-goals).

1. **`id` stays the one true identifier everywhere internally.** Slug is an addressing
   convenience at the API edge, never a foreign key, never written into events, audit
   records, or the `outbox_events` payload. `polaris.md`'s existing principle for Tribe/Squad
   — "Polaris uses its own stable identifiers so that historical ownership remains
   understandable" — extends to the new field: slug does not become a second identity to
   reconcile.

2. **Uniqueness is global for all three kinds** (corrected during implementation — see
   Amendment; originally specced as scoped per-parent):
   - `Tribe.slug` — unique across all tribes.
   - `Squad.slug` — unique across all squads.
   - `FitnessFunction.slug` — unique across all fitness functions.

3. **Auto-generate from `name`, allow explicit override, validate like a DNS label.**
   Default is a kebab-case derivation of `name` (lowercase, strip diacritics/punctuation,
   collapse whitespace to single hyphens) computed at creation time; callers may supply an
   explicit `slug` instead. Format: `^[a-z0-9]+(-[a-z0-9]+)*$`, 1–63 characters — DNS-label
   safe, in case a slug ever ends up in a URL path, subdomain, or Kubernetes label.

4. **Slug assignment is a create-time decision for `FitnessFunction`, not a per-version one.**
   `FitnessFunction`'s only "name" today lives inside `Definition` (`FitnessDefinition.name`),
   which is versioned — a new version can rename the function's definition. Slug must not
   inherit that versioning: it is set once from the initial (version-1) definition's name (or
   an explicit override) and stored on the `FitnessFunction` aggregate itself, sibling to
   `id`, unaffected by later `addVersion`/`updateDraft` calls. The request body for
   `createFitnessFunction` therefore gets its own wrapper schema
   (`CreateFitnessFunctionRequest`) carrying an optional `slug` alongside the reused
   `FitnessDefinition` body; `addVersion` and `updateDraftVersion` keep using bare
   `FitnessDefinition`, unchanged.

5. **Renames are rare and explicit, not silently derived.** Slugs get pasted into CI configs,
   `.polaris/fitness-functions.yml` manifests, dashboards, and bookmarks; a silent rename
   (e.g. triggered by renaming the resource) turns all of those into a `404` with no clue why.
   For v1: slug is immutable after creation. No redirect-on-rename (GitHub-style old-slug-
   still-resolves) — that is real complexity for a problem avoided entirely by not allowing
   casual renames. If a genuine rename is needed later, it should be its own explicit,
   audited operation, scoped and specced separately.

6. **Archived/retired resources keep their slug reserved.** An archived tribe or retired
   fitness function does not free its slug for reuse — avoids a new resource silently
   inheriting inbound links/configs aimed at the old one. (Matches `ARCHIVED` tribes already
   staying queryable for history.)

7. **Lookup accepts a UUID or a slug on the same path parameter — no separate `/by-slug/`
   route.** `GET /tribes/{tribeId}`, `GET /squads/{squadId}`,
   `GET /fitness-functions/{fitnessFunctionId}`, and the measurement-submission endpoint all
   already take a single path parameter; widen it to accept either form instead of adding a
   parallel endpoint every client has to remember to use instead. A slug can never parse as a
   UUID, so the two forms are unambiguous to disambiguate server-side. 404 semantics are
   identical for both forms.

## Non-goals

- **`producerId` is not sluggable.** Producers are machine-to-machine identities (CI
  runners), never typed by a human or picked from a list — the existing
  UUID-behind-a-repository-secret pattern is already the right shape for that one.
- **No slug redirect/history on rename** (see point 5) — rename is simply disallowed in v1.
- **No slug on every resource kind** — `fitness-target`, `measurement-source`,
  `measurement-producer`, `waiver`, `evaluation-request`, etc. keep UUID-only addressing;
  they are not things a human types into a CI config or a chat prompt.

## Alternatives considered

- **Separate `GET .../by-slug/{slug}` endpoint instead of a lenient path parameter.** Rejected:
  every existing and future client (including `polaris-mcp` and `polaris-measurements-action`)
  would need to know to call the alternate route; a lenient parameter benefits the primary
  use case — CI configs and LLM tool calls typing a slug directly — with zero client changes.
- **Scoped (per-parent) uniqueness instead of global.** This was the original decision (see
  Amendment) and was reversed during implementation: every lenient lookup (`GET
  /tribes/{tribeId}`, `GET /squads/{squadId}`, `GET /fitness-functions/{fitnessFunctionId}`,
  and the same path parameters reused by child-creation/listing endpoints like `POST
  /squads/{squadId}/fitness-functions`) is a flat route with no parent segment, so a
  parent-scoped slug cannot be resolved from the URL alone — the server would need the
  parent's id *before* it could even look up the child, which defeats the purpose. Global
  uniqueness is the only scope that works with flat routes; the "ugly disambiguation" cost is
  real but smaller than it first appears, since `code-quality`/`security`-style names are
  exactly the ones worth keeping distinguishable across squads anyway (`checkout-code-quality`
  vs. `platform-code-quality` reads fine, and the auto-derivation still saves the common case
  of one tribe/squad per name).
- **Slug as the primary key / replacing `id`.** Rejected: contradicts the project's own
  stated identity-stability principle and makes every rename a cascading-FK migration
  instead of a single bounded, auditable operation.

## Consequences

Positive:
- `.polaris/fitness-functions.yml`-style manifests (and any `polaris-measurements-action`
  config) can reference `fitness-function-id: code-quality` directly — no
  `vars.POLARIS_CODE_QUALITY_FF_ID` indirection, no per-repo copy-paste-a-UUID step.
- `polaris-mcp` tool calls become slug-addressable, cutting UUID-hallucination risk for an
  LLM driving the control plane.
- Control-tower URLs can become `/tribes/platform/squads/checkout/fitness-functions/code-quality`
  instead of three chained UUIDs.

Costs / risks:
- One more uniqueness constraint to enforce per kind, and a 409 response to add to
  `createFitnessFunction` (`createTribe`/`createSquad` already return 409 for name conflicts
  today and will reuse the same response for slug conflicts).
- Slug immutability is a product constraint, not just a technical one — needs to be
  documented prominently wherever slugs are introduced (SDK docs, `polaris-mcp` tool
  descriptions) so callers don't expect rename support that doesn't exist.

## Implementation plan

Delivered in PR #11 (contract-first):
- `api/openapi.yaml`: `Slug` schema; `slug` field on `Tribe`, `Squad`, `FitnessFunction`;
  optional `slug` on `CreateTribeRequest`, `CreateSquadRequest`, and the new
  `CreateFitnessFunctionRequest`; `TribeId`/`SquadId`/`FitnessFunctionId` path parameters
  widened to accept a UUID or a slug; `409` added to `createFitnessFunction`.
- `gen/api/server.gen.go` regenerated from the above (`make generate`); `go build ./...`
  and `go test ./internal/...` verified green with the new, as-yet-unused generated fields.

Delivered in this follow-up change (storage and lookup logic):
- `internal/domain/slug`: `Generate`, `Validate`, `Resolve` (derive-or-validate), unit-tested
  in isolation (100% coverage).
- `migrations/00002_add_slugs.sql`: `slug text NOT NULL` column on `tribes`, `squads`,
  `fitness_functions`, each with a format `CHECK` and a **global** `UNIQUE` constraint (see
  Amendment for why global, not per-parent); backfills existing rows by deriving from `name`
  with a numeric-suffix dedup.
- `internal/application/service.go`: `CreateRecord` resolves slug (explicit-or-derived) for
  `tribe`/`squad`; `CreateFitnessFunction` takes an explicit-slug parameter and resolves it
  after `fitness.New` succeeds (so a bad name still fails with the clearer definition-invalid
  error, not a confusing slug error); a new `resolveParentID`/`parentKindOf` mechanism resolves
  every sluggable parent path parameter (tribeId, squadId, fitnessFunctionId) to its real id
  before it reaches any SQL filter or foreign key, covering not just the resource's own GET but
  every child-creation/listing endpoint scoped by it.
- `internal/adapters/postgres/store.go`: `CreateRecord` (tribe/squad) and
  `CreateFitnessFunction` persist the resolved slug (with a defensive `slug.Generate` fallback
  for direct/test callers that bypass `Service`); `GetRecord` and `GetFitnessFunction` resolve
  `WHERE id::text = $1 OR slug = $1`, returning the real id either way.
- `internal/adapters/httpapi/handler.go`: `createTribe`/`createSquad`/`createFitnessFunction`
  accept an optional `slug` body field; no other handler changes were needed because lenient
  lookup lives entirely behind the existing `GetRecord`/`GetFitnessFunction` calls already used
  by every relevant handler.
- Tests: unit coverage for `slug` package and the new resolution/derivation paths in
  `internal/application`; two new Postgres integration test functions
  (`TestRecordSlugDerivationAndLookup`, `TestFitnessFunctionSlugDerivationAndLookup`) covering
  auto-derivation, explicit slugs, global-conflict rejection, and id-or-slug lookup against a
  real database. `make coverage` = 92.6% (gate 90%); `make test`, `make integration` green.

Not done (explicitly out of scope for this change):
- `docs-site` updates (mention slugs in `domain/aggregates`/`modules/*`, regenerate the REST
  API reference pages) — tracked separately, not required for the API/storage to work.
- No automatic suffix-retry when an *auto-derived* slug collides (e.g. two fitness functions
  both named "Code Quality" in different squads, which the old per-squad scope would never have
  collided on but global scope now can): it surfaces as the same `409` a duplicate `name` would,
  and the caller supplies an explicit `slug` to resolve it. A retry-with-suffix loop was
  considered and rejected as unnecessary complexity for a rare case with a simple workaround.

## Amendment (2026-10-03, during implementation)

While implementing the storage/logic half of this ADR, point 2's original per-parent scoping
(`Squad.slug` unique within its tribe, `FitnessFunction.slug` unique within its squad) turned
out to be incompatible with point 7's lenient-lookup design: `GET /squads/{squadId}` and `GET
/fitness-functions/{fitnessFunctionId}` are flat routes with no parent segment in the URL. A
per-tribe-scoped squad slug can only be resolved if the tribe is already known, which the
lenient `{squadId}` parameter alone never provides — the two decisions in the same ADR
contradicted each other, and this was only discovered once lookup queries were written out.

**Resolution: uniqueness is global for all three kinds**, documented in the revised point 2
and the revised Alternatives entry above. The practical cost is that two squads in different
tribes can no longer both be named (and slugged) exactly `checkout`; this is judged acceptable
since the primary motivating use case (CI manifests, `polaris-mcp` tool calls) already wants a
distinguishable slug like `commerce-checkout` vs. `logistics-checkout` for clarity anyway, and
the auto-derivation default still works unmodified for the common case of non-colliding names.

No other part of the original decision changed.
