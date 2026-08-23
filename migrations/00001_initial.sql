-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tribes (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE,
    description text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

CREATE TABLE squads (
    id uuid PRIMARY KEY,
    tribe_id uuid NOT NULL REFERENCES tribes(id),
    name text NOT NULL,
    mission text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
    data jsonb NOT NULL DEFAULT '{}',
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (tribe_id, name)
);

CREATE TABLE fitness_targets (
    id uuid PRIMARY KEY,
    squad_id uuid NOT NULL REFERENCES squads(id),
    name text NOT NULL,
    lifecycle text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('PROPOSED','ACTIVE','DEPRECATED','RETIRED')),
    data jsonb NOT NULL DEFAULT '{}',
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (squad_id, name)
);

CREATE TABLE measurement_sources (
    id uuid PRIMARY KEY,
    squad_id uuid NOT NULL REFERENCES squads(id),
    name text NOT NULL,
    provider_type text NOT NULL CHECK (provider_type IN ('PROMETHEUS')),
    base_url text NOT NULL,
    status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','UNAVAILABLE','RETIRED')),
    data jsonb NOT NULL DEFAULT '{}',
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (squad_id, name)
);

CREATE TABLE source_connection_checks (
    id uuid PRIMARY KEY,
    source_id uuid NOT NULL REFERENCES measurement_sources(id),
    status text NOT NULL CHECK (status IN ('SUCCEEDED','FAILED')),
    detail text NOT NULL DEFAULT '',
    checked_at timestamptz NOT NULL
);

CREATE TABLE measurement_producers (
    id uuid PRIMARY KEY,
    squad_id uuid NOT NULL REFERENCES squads(id),
    name text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL,
    UNIQUE (squad_id, name)
);

CREATE TABLE fitness_functions (
    id uuid PRIMARY KEY,
    squad_id uuid NOT NULL REFERENCES squads(id),
    name text NOT NULL,
    lifecycle text NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle IN ('DRAFT','ACTIVE','RETIRED')),
    active_version integer,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (squad_id, name)
);

CREATE TABLE fitness_function_versions (
    fitness_function_id uuid NOT NULL REFERENCES fitness_functions(id),
    version integer NOT NULL,
    state text NOT NULL CHECK (state IN ('DRAFT','ACTIVE','SUPERSEDED')),
    definition jsonb NOT NULL,
    characteristic text NOT NULL DEFAULT '',
    acquisition_mode text NOT NULL CHECK (acquisition_mode IN ('PUSH','PULL')),
    source_id uuid REFERENCES measurement_sources(id),
    created_at timestamptz NOT NULL,
    activated_at timestamptz,
    PRIMARY KEY (fitness_function_id, version)
);
CREATE UNIQUE INDEX one_active_function_version ON fitness_function_versions(fitness_function_id) WHERE state = 'ACTIVE';

CREATE TABLE evaluation_requests (
    id uuid PRIMARY KEY,
    fitness_function_id uuid NOT NULL REFERENCES fitness_functions(id),
    fitness_function_version integer NOT NULL,
    status text NOT NULL CHECK (status IN ('PENDING','DISPATCHED','COMPLETED','FAILED','CANCELLED','TIMED_OUT')),
    data jsonb NOT NULL DEFAULT '{}',
    deadline timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

CREATE TABLE measurement_submissions (
    id uuid PRIMARY KEY,
    fitness_function_id uuid NOT NULL REFERENCES fitness_functions(id),
    fitness_function_version integer NOT NULL,
    producer_id uuid NOT NULL REFERENCES measurement_producers(id),
    external_run_id text NOT NULL,
    observed_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE (producer_id, external_run_id)
);

CREATE TABLE collection_attempts (
    id uuid PRIMARY KEY,
    fitness_function_id uuid NOT NULL REFERENCES fitness_functions(id),
    fitness_function_version integer NOT NULL,
    source_id uuid NOT NULL REFERENCES measurement_sources(id),
    trigger text NOT NULL,
    status text NOT NULL CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','PARTIALLY_SUCCEEDED','FAILED','CANCELLED','TIMED_OUT')),
    data jsonb NOT NULL DEFAULT '{}',
    retry_of uuid REFERENCES collection_attempts(id),
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL
);
CREATE INDEX due_collection_attempts ON collection_attempts(status, created_at) WHERE status = 'PENDING';

CREATE TABLE collection_schedules (
    fitness_function_id uuid PRIMARY KEY REFERENCES fitness_functions(id),
    fitness_function_version integer NOT NULL,
    next_run_at timestamptz NOT NULL,
    interval_seconds integer NOT NULL CHECK (interval_seconds >= 60),
    lease_until timestamptz,
    lease_owner text
);
CREATE INDEX due_collection_schedules ON collection_schedules(next_run_at) WHERE lease_until IS NULL;

CREATE TABLE evaluations (
    id uuid PRIMARY KEY,
    fitness_function_id uuid NOT NULL REFERENCES fitness_functions(id),
    fitness_function_version integer NOT NULL,
    acquisition_mode text NOT NULL CHECK (acquisition_mode IN ('PUSH','PULL')),
    origin_id uuid NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('PASS','WARN','FAIL','ERROR','NOT_APPLICABLE')),
    disposition text NOT NULL CHECK (disposition IN ('ACCEPTED','ATTENTION_REQUIRED','BLOCKED','WAIVED')),
    observed_at timestamptz NOT NULL,
    valid_until timestamptz NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE INDEX evaluations_by_function ON evaluations(fitness_function_id, observed_at DESC, id DESC);

CREATE TABLE waivers (
    id uuid PRIMARY KEY,
    fitness_function_id uuid NOT NULL REFERENCES fitness_functions(id),
    status text NOT NULL CHECK (status IN ('REQUESTED','APPROVED','REJECTED','REVOKED','EXPIRED')),
    starts_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    data jsonb NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CHECK (expires_at > starts_at)
);

CREATE TABLE fitness_function_templates (
    id uuid PRIMARY KEY,
    tribe_id uuid NOT NULL REFERENCES tribes(id),
    name text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    definition jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE (tribe_id, name)
);

CREATE TABLE idempotency_records (
    key text NOT NULL,
    method text NOT NULL,
    path text NOT NULL,
    request_hash text NOT NULL,
    status integer NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (key, method, path)
);

CREATE TABLE outbox_events (
    sequence bigserial PRIMARY KEY,
    id uuid NOT NULL UNIQUE,
    event_type text NOT NULL,
    event_version integer NOT NULL DEFAULT 1,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    occurred_at timestamptz NOT NULL,
    actor text NOT NULL,
    correlation_id text NOT NULL,
    payload jsonb NOT NULL
);

CREATE TABLE event_acknowledgements (
    consumer_id text NOT NULL,
    event_id uuid NOT NULL REFERENCES outbox_events(id),
    acknowledged_at timestamptz NOT NULL,
    PRIMARY KEY (consumer_id, event_id)
);

CREATE TABLE projection_checkpoints (
    projector text PRIMARY KEY,
    sequence bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL
);

CREATE TABLE fitness_status_projection (
    fitness_function_id uuid PRIMARY KEY,
    squad_id uuid NOT NULL,
    tribe_id uuid NOT NULL,
    target_ids uuid[] NOT NULL DEFAULT '{}',
    characteristic text NOT NULL DEFAULT '',
    outcome text,
    disposition text,
    observed_at timestamptz,
    valid_until timestamptz,
    updated_at timestamptz NOT NULL
);

CREATE TABLE resource_documents (
    id uuid PRIMARY KEY,
    parent_id uuid,
    kind text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    revision bigint NOT NULL DEFAULT 1,
    data jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE INDEX resource_documents_by_parent ON resource_documents(kind, parent_id, created_at, id);

-- +goose Down
DROP TABLE IF EXISTS resource_documents;
DROP TABLE IF EXISTS fitness_status_projection;
DROP TABLE IF EXISTS projection_checkpoints;
DROP TABLE IF EXISTS event_acknowledgements;
DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS idempotency_records;
DROP TABLE IF EXISTS fitness_function_templates;
DROP TABLE IF EXISTS waivers;
DROP TABLE IF EXISTS evaluations;
DROP TABLE IF EXISTS collection_schedules;
DROP TABLE IF EXISTS collection_attempts;
DROP TABLE IF EXISTS measurement_submissions;
DROP TABLE IF EXISTS evaluation_requests;
DROP TABLE IF EXISTS fitness_function_versions;
DROP TABLE IF EXISTS fitness_functions;
DROP TABLE IF EXISTS measurement_producers;
DROP TABLE IF EXISTS source_connection_checks;
DROP TABLE IF EXISTS measurement_sources;
DROP TABLE IF EXISTS fitness_targets;
DROP TABLE IF EXISTS squads;
DROP TABLE IF EXISTS tribes;
