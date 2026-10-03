# ADR 0001: Human-readable slugs for Tribe, Squad, and Fitness Function

Status: Accepted (contract delivered; storage/logic implementation pending — see Implementation plan)
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

2. **Uniqueness is scoped to where collisions actually happen, not global:**
   - `Tribe.slug` — unique across all tribes (there are few; global scope is fine).
   - `Squad.slug` — unique within its tribe (`UNIQUE (tribe_id, slug)`), mirroring the
     existing `UNIQUE (tribe_id, name)` constraint. Two tribes will each want a squad called
     `checkout` or `platform`; forcing global uniqueness would just push every squad into
     ugly disambiguated slugs.
   - `FitnessFunction.slug` — unique within its owning squad (`UNIQUE (squad_id, slug)`),
     mirroring `UNIQUE (squad_id, name)`. Every squad will want a `code-quality` and a
     `security` fitness function; that's the exact case that motivated this ADR.

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
- **Global uniqueness for all three kinds.** Rejected per point 2: `code-quality`/`security`-
  style fitness-function slugs and generic squad names will recur constantly across tribes
  and squads; global uniqueness would force ugly disambiguation on exactly the names people
  most want to reuse.
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

Delivered in this change (contract-first):
- `api/openapi.yaml`: `Slug` schema; `slug` field on `Tribe`, `Squad`, `FitnessFunction`;
  optional `slug` on `CreateTribeRequest`, `CreateSquadRequest`, and the new
  `CreateFitnessFunctionRequest`; `TribeId`/`SquadId`/`FitnessFunctionId` path parameters
  widened to accept a UUID or a slug; `409` added to `createFitnessFunction`.
- `gen/api/server.gen.go` regenerated from the above (`make generate`); `go build ./...`
  and `go test ./internal/...` verified green with the new, as-yet-unused generated fields.

Pending as a follow-up change (storage/logic):
- `migrations/00002_add_slugs.sql`: `slug text` column on `tribes`, `squads`,
  `fitness_functions`; `UNIQUE (slug)` on `tribes`; `UNIQUE (tribe_id, slug)` on `squads`;
  `UNIQUE (squad_id, slug)` on `fitness_functions`.
- A new `internal/domain/slug` package: `Generate(name string) string` (kebab-case
  derivation) and `Validate(s string) error` (format/length), unit-tested in isolation.
- `internal/adapters/postgres/store.go`: generate-or-validate slug on `CreateRecord` for
  `tribe`/`squad` and on `CreateFitnessFunction`; a lenient lookup (`GetRecord`,
  `GetFitnessFunction`) that tries a UUID parse first and falls back to a scoped slug lookup.
- `internal/adapters/httpapi`: route the widened path parameters through the lenient lookup;
  map the new unique-violation to the existing `409 RESOURCE_CONFLICT` problem response.
- `docs-site`: mention slugs in `domain/aggregates` and the relevant `modules/*` pages;
  regenerate the REST API reference pages from the updated spec.
