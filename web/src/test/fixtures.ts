import type {
  Catalog,
  Criterion,
  FitnessDefinition,
  FitnessFunction,
  FitnessVersion,
  MetricQuery,
  Page,
  Problem,
  ResourceRecord,
  Squad,
} from "../types";

/**
 * Typed fixture factories mirroring the shapes published by api/openapi.yaml.
 * Every factory accepts a partial override so tests only spell out the
 * attributes they assert on.
 */

export function problem(partial: Partial<Problem> = {}): Problem {
  return {
    title: "Request failed",
    status: 400,
    code: "POLARIS_ERROR",
    detail: "The request could not be processed.",
    ...partial,
  };
}

export function page<T>(items: T[], nextCursor?: string): Page<T> {
  return nextCursor === undefined ? { items } : { items, nextCursor };
}

export function resourceRecord(partial: Partial<ResourceRecord> = {}): ResourceRecord {
  return {
    id: "resource-1",
    kind: "squad",
    status: "ACTIVE",
    revision: 1,
    data: { name: "Resource" },
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T10:00:00Z",
    ...partial,
  };
}

export function tribe(partial: Partial<ResourceRecord> = {}): ResourceRecord {
  return resourceRecord({
    id: "tribe-1",
    kind: "tribe",
    data: { name: "Commerce" },
    ...partial,
  });
}

export function squad(partial: Partial<Squad> = {}): Squad {
  return {
    ...resourceRecord({
      id: "squad-1",
      kind: "squad",
      parentId: "tribe-1",
      data: { name: "Checkout" },
    }),
    tribeId: "tribe-1",
    tribeName: "Commerce",
    ...partial,
  };
}

export function criterion(partial: Partial<Criterion> = {}): Criterion {
  return {
    key: "error_rate",
    unit: "percent",
    failureComparison: "GREATER_THAN",
    failureValue: 5,
    required: true,
    ...partial,
  };
}

export function metricQuery(partial: Partial<MetricQuery> = {}): MetricQuery {
  return {
    criterionKey: "error_rate",
    expression: "rate(errors_total[5m])",
    mode: "INSTANT",
    reduction: "LAST",
    seriesPolicy: "REQUIRE_SINGLE_SERIES",
    unit: "percent",
    ...partial,
  };
}

export function pushDefinition(partial: Partial<FitnessDefinition> = {}): FitnessDefinition {
  return {
    name: "Checkout availability",
    purpose: "Protect the checkout journey from regressions.",
    objective: "Remain available for customers at all times.",
    characteristic: "Reliability",
    targetIds: ["target-1"],
    criteria: [criterion()],
    acquisition: {
      mode: "PUSH",
      producerId: "producer-1",
      maximumObservationAgeSeconds: 300,
    },
    freshnessSeconds: 1800,
    enforcement: "WARN",
    ...partial,
  };
}

export function pullDefinition(partial: Partial<FitnessDefinition> = {}): FitnessDefinition {
  return {
    ...pushDefinition(),
    acquisition: {
      mode: "PULL",
      sourceId: "source-1",
      trigger: "ON_DEMAND",
      timeoutSeconds: 10,
      queries: [metricQuery()],
    },
    ...partial,
  };
}

export function fitnessVersion(partial: Partial<FitnessVersion> = {}): FitnessVersion {
  return {
    number: 1,
    state: "ACTIVE",
    definition: pushDefinition(),
    createdAt: "2026-08-01T10:00:00Z",
    activatedAt: "2026-08-02T10:00:00Z",
    ...partial,
  };
}

export function fitnessFunction(partial: Partial<FitnessFunction> = {}): FitnessFunction {
  return {
    id: "fn-1",
    ownerSquadId: "squad-1",
    lifecycle: "ACTIVE",
    revision: 1,
    activeVersion: 1,
    versions: [fitnessVersion()],
    ...partial,
  };
}

export function catalog(partial: Partial<Catalog> = {}): Catalog {
  return {
    tribes: [tribe()],
    squads: [squad()],
    functions: [fitnessFunction()],
    ...partial,
  };
}
