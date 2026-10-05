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

export type TargetLifecycle = "ACTIVE" | "DEPRECATED" | "RETIRED";

export type EvaluationRequestStatus = "PENDING" | "CANCELLED";

export interface EvaluationRequest extends ResourceRecord {
  kind: "evaluation-request";
  status: EvaluationRequestStatus;
}

export type WaiverStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "REVOKED";
export type WaiverTransition = "approvals" | "rejections" | "revocations";

export interface WaiverData {
  reason: string;
  criterionKeys?: string[];
  risk?: string;
  compensatingAction?: string;
  startsAt?: string;
  expiresAt?: string;
  [key: string]: unknown;
}

export interface Waiver extends ResourceRecord {
  kind: "waiver";
  status: WaiverStatus;
  data: WaiverData;
}

export type CollectionAttemptStatus = "SUCCEEDED" | "FAILED";

export interface Measurement {
  criterionKey: string;
  value: number;
  unit: string;
}

export interface CollectionAttemptData {
  sourceId?: string;
  measurements?: Measurement[];
  evidence?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface CollectionAttempt extends ResourceRecord {
  kind: "collection-attempt";
  status: CollectionAttemptStatus;
  data: CollectionAttemptData;
}

export interface FitnessFunctionTemplateData {
  name: string;
  description?: string;
  definition?: FitnessDefinition;
  [key: string]: unknown;
}

export interface FitnessFunctionTemplate extends ResourceRecord {
  kind: "fitness-function-template";
  status: "ACTIVE";
  data: FitnessFunctionTemplateData;
}

export interface TemplateAdoptionData {
  squadId: string;
  targetIds?: string[];
  reason?: string;
  [key: string]: unknown;
}

export interface TemplateAdoption extends ResourceRecord {
  kind: "template-adoption";
  status: "ACTIVE";
  data: TemplateAdoptionData;
}

export type EvaluationOutcome = "PASS" | "WARN" | "FAIL" | "ERROR" | "NOT_APPLICABLE";
export type EvaluationDisposition = "ACCEPTED" | "ATTENTION_REQUIRED" | "BLOCKED" | "WAIVED";

export interface CriterionResult {
  criterionKey: string;
  value?: number;
  unit?: string;
  outcome: "PASS" | "WARN" | "FAIL";
}

export interface Evaluation {
  evaluationId: string;
  fitnessFunctionId: string;
  fitnessFunctionVersion: number;
  acquisitionMode: AcquisitionMode;
  originId: string;
  outcome: EvaluationOutcome;
  disposition: EvaluationDisposition;
  observedAt: string;
  validUntil: string;
  criterionResults: CriterionResult[];
  data: Record<string, unknown>;
}

export interface SubmittedEvaluation extends Evaluation {
  replayed: boolean;
}

export interface FitnessOverview {
  scope: "squad" | "tribe";
  scopeId: string;
  generatedAt: string;
  status: "AVAILABLE";
}

export interface DomainEvent {
  id: string;
  type: string;
  version: number;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  actor: string;
  correlationId: string;
  payload: Record<string, unknown>;
}
