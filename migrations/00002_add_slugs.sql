-- +goose Up
-- Human-readable slugs for Tribe, Squad, and FitnessFunction (see
-- adr/0001-human-readable-slugs.md). id (uuid) remains the canonical
-- identifier everywhere; slug is an additional, globally unique, immutable
-- alternate key usable anywhere the resource's own {id} path parameter is
-- accepted (application/httpapi resolves "looks like a uuid vs. not" by
-- simply trying both columns -- see store.go).
--
-- Global (not per-parent) uniqueness is deliberate: all three identity
-- lookups (GET/POST by {tribeId}/{squadId}/{fitnessFunctionId}, including
-- when that id scopes a child-creation/listing endpoint) are flat routes
-- with no parent segment in the URL, so a slug must be able to resolve a
-- row on its own.

ALTER TABLE tribes ADD COLUMN slug text;
ALTER TABLE squads ADD COLUMN slug text;
ALTER TABLE fitness_functions ADD COLUMN slug text;

-- Backfill: derive from the existing name, deduplicating collisions (e.g.
-- "Checkout" and "Checkout!!" would otherwise both derive "checkout") with a
-- stable numeric suffix. This mirrors internal/domain/slug.Generate closely
-- enough for a one-time backfill; it does not need to match it exactly,
-- since every row it touches predates slugs and has no CI config depending
-- on a specific derived value yet.
WITH derived AS (
    SELECT id, NULLIF(regexp_replace(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), '(^-+)|(-+$)', '', 'g'), '') AS base
    FROM tribes
), ranked AS (
    SELECT id, COALESCE(base, 'tribe') AS base, row_number() OVER (PARTITION BY COALESCE(base, 'tribe') ORDER BY id) AS rn
    FROM derived
)
UPDATE tribes t SET slug = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || '-' || r.rn END
FROM ranked r WHERE r.id = t.id;

WITH derived AS (
    SELECT id, NULLIF(regexp_replace(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), '(^-+)|(-+$)', '', 'g'), '') AS base
    FROM squads
), ranked AS (
    SELECT id, COALESCE(base, 'squad') AS base, row_number() OVER (PARTITION BY COALESCE(base, 'squad') ORDER BY id) AS rn
    FROM derived
)
UPDATE squads t SET slug = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || '-' || r.rn END
FROM ranked r WHERE r.id = t.id;

WITH derived AS (
    SELECT id, NULLIF(regexp_replace(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), '(^-+)|(-+$)', '', 'g'), '') AS base
    FROM fitness_functions
), ranked AS (
    SELECT id, COALESCE(base, 'fitness-function') AS base, row_number() OVER (PARTITION BY COALESCE(base, 'fitness-function') ORDER BY id) AS rn
    FROM derived
)
UPDATE fitness_functions t SET slug = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || '-' || r.rn END
FROM ranked r WHERE r.id = t.id;

ALTER TABLE tribes ALTER COLUMN slug SET NOT NULL;
ALTER TABLE squads ALTER COLUMN slug SET NOT NULL;
ALTER TABLE fitness_functions ALTER COLUMN slug SET NOT NULL;

ALTER TABLE tribes ADD CONSTRAINT tribes_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 63);
ALTER TABLE squads ADD CONSTRAINT squads_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 63);
ALTER TABLE fitness_functions ADD CONSTRAINT fitness_functions_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 63);

ALTER TABLE tribes ADD CONSTRAINT tribes_slug_unique UNIQUE (slug);
ALTER TABLE squads ADD CONSTRAINT squads_slug_unique UNIQUE (slug);
ALTER TABLE fitness_functions ADD CONSTRAINT fitness_functions_slug_unique UNIQUE (slug);

-- +goose Down
ALTER TABLE fitness_functions DROP CONSTRAINT IF EXISTS fitness_functions_slug_unique;
ALTER TABLE squads DROP CONSTRAINT IF EXISTS squads_slug_unique;
ALTER TABLE tribes DROP CONSTRAINT IF EXISTS tribes_slug_unique;
ALTER TABLE fitness_functions DROP CONSTRAINT IF EXISTS fitness_functions_slug_format;
ALTER TABLE squads DROP CONSTRAINT IF EXISTS squads_slug_format;
ALTER TABLE tribes DROP CONSTRAINT IF EXISTS tribes_slug_format;
ALTER TABLE fitness_functions DROP COLUMN IF EXISTS slug;
ALTER TABLE squads DROP COLUMN IF EXISTS slug;
ALTER TABLE tribes DROP COLUMN IF EXISTS slug;
