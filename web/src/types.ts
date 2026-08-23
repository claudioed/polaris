export type Lifecycle = "DRAFT" | "ACTIVE" | "RETIRED";
export type Enforcement = "OBSERVE" | "WARN" | "BLOCK";
export type AcquisitionMode = "PUSH" | "PULL";

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface ResourceRecord {
  id: string;
  parentId?: string;
  kind: string;
  status: string;
  revision: number;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Criterion {
  key: string;
  description?: string;
  unit: string;
  warningComparison?: string;
  warningValue?: number;
  failureComparison: string;
  failureValue: number;
  required: boolean;
}

export interface MetricQuery {
  criterionKey: string;
  expression: string;
  mode: "INSTANT" | "RANGE";
  lookbackSeconds?: number;
  stepSeconds?: number;
  reduction: "LAST" | "MIN" | "MAX" | "AVERAGE" | "SUM" | "COUNT";
  seriesPolicy:
    | "REQUIRE_SINGLE_SERIES"
    | "REDUCE_ACROSS_SERIES"
    | "ERROR_ON_MULTIPLE_SERIES";
  unit: string;
}

export type Acquisition =
  | {
      mode: "PUSH";
      producerId: string;
      maximumObservationAgeSeconds: number;
    }
  | {
      mode: "PULL";
      sourceId: string;
      trigger: "SCHEDULED" | "ON_DEMAND";
      intervalSeconds?: number;
      timeoutSeconds: number;
      queries: MetricQuery[];
    };

export interface FitnessDefinition {
  name: string;
  purpose: string;
  objective: string;
  characteristic?: string;
  targetIds: string[];
  criteria: Criterion[];
  acquisition: Acquisition;
  freshnessSeconds: number;
  enforcement: Enforcement;
  changeRationale?: string;
}

export interface FitnessVersion {
  number: number;
  state: "DRAFT" | "ACTIVE" | "SUPERSEDED";
  definition: FitnessDefinition;
  createdAt: string;
  activatedAt?: string;
}

export interface FitnessFunction {
  id: string;
  ownerSquadId: string;
  lifecycle: Lifecycle;
  revision: number;
  activeVersion?: number;
  versions: FitnessVersion[];
}

export interface Squad extends ResourceRecord {
  tribeId: string;
  tribeName: string;
}

export interface Catalog {
  tribes: ResourceRecord[];
  squads: Squad[];
  functions: FitnessFunction[];
}

export interface Problem {
  title?: string;
  detail?: string;
  code?: string;
  status?: number;
}
