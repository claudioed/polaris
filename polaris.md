# Polaris

## Domain and REST API specification

Status: Initial design  
Audience: solution architects, tribe leaders, squad leaders, engineers, risk partners, and product stakeholders

## 1. Purpose

Polaris enables engineering squads to define, operate, and evolve architectural fitness functions for the systems they own.

A tribe contains many squads. Every fitness function belongs to exactly one squad. The owning squad controls its intent, scope, acceptance criteria, evaluation method, enforcement level, and lifecycle. The tribe can see patterns across its squads and publish reusable guidance, but it does not silently take ownership of squad fitness functions.

Polaris answers five business questions:

1. What architectural characteristics does a squad intend to protect?
2. How will the squad determine whether those characteristics remain fit?
3. What was evaluated, when, using which definition, and with what evidence?
4. What response is expected when a fitness function is not satisfied?
5. Where is architectural fitness improving, degrading, stale, or unknown?

Polaris is both the control plane and the measurement receiver for fitness functions. It does not replace build pipelines, observability platforms, security scanners, test tools, or human review. It acquires measurements in two ways:

- `PUSH`: a pipeline or another authorized producer submits measurements to the Polaris API;
- `PULL`: Polaris runs a squad-defined query against a registered measurement source and collects the result.

Prometheus is the first pull provider. The domain depends on an abstract measurement-source contract rather than Prometheus itself, allowing providers such as Grafana to be added later without changing fitness-function, criterion, evaluation, or outcome semantics.

Polaris normalizes acquired data into measurements, calculates the declared outcome, preserves evidence and history, and applies the squad's enforcement decision.

## 2. Source principles

This design applies the following principles from the cited sources:

- An evolutionary architecture supports guided, incremental change across multiple dimensions.
- A fitness function makes the meaning of “fit” explicit and evaluates how close a system is to an architectural objective.
- Fitness functions may use tests, metrics, or other verification mechanisms.
- Architectural decisions and their trade-offs should be explicit and testable.
- Automation is preferred when it produces trustworthy feedback, but not every valuable architectural judgment is automatable.
- Continuous governance and governance by rule provide earlier feedback than governance by inspection alone.
- A fitness function is contextual. A threshold that is appropriate for one system or lifecycle stage is not automatically appropriate for another.
- Multiple fitness functions can conflict. Polaris exposes these trade-offs; it does not hide them inside a single universal score.

Primary references:

- [Building Evolutionary Architectures, 2nd Edition](https://learning.oreilly.com/library/view/-/9781492097532/?orm_source=mcp), Neal Ford, Rebecca Parsons, Patrick Kua, and Pramod Sadalage.
- [Building Evolutionary Architectures, first edition](https://learning.oreilly.com/library/view/-/9781491986356/?orm_source=mcp), Neal Ford, Rebecca Parsons, and Patrick Kua.
- [Evolutionary Architecture Fundamentals](https://learning.oreilly.com/videos/-/9781492027089/?orm_source=mcp), Neal Ford, Rebecca Parsons, and Patrick Kua.
- [Governing data products using fitness functions](https://martinfowler.com/articles/fitness-functions-data-products.html), Kiran Prakash on MartinFowler.com.
- [How to break a Monolith into Microservices](https://martinfowler.com/articles/break-monolith-into-microservices.html), Zhamak Dehghani on MartinFowler.com.
- [ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html), a reference vocabulary for product-quality characteristics.
- [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/) and [PromQL querying basics](https://prometheus.io/docs/prometheus/latest/querying/basics/), the authoritative contracts for the initial pull provider.
- [Grafana HTTP API](https://grafana.com/docs/grafana/latest/developer-resources/api-reference/http-api/), a reference for the planned provider adapter.

The domain model follows the bounded-context, ubiquitous-language, aggregate, entity, value-object, and domain-event patterns of domain-driven design. Supporting references include [Domain-Driven Design](https://learning.oreilly.com/library/view/-/0321125215/?orm_source=mcp) by Eric Evans and [Learning Domain-Driven Design](https://learning.oreilly.com/library/view/-/9781098100124/?orm_source=mcp) by Vlad Khononov.

## 3. Business scope

### 3.1 In scope

- Registering tribes, squads, and the systems for which squads are accountable.
- Defining and versioning fitness functions.
- Classifying fitness functions by architectural characteristic and evaluation style.
- Activating, superseding, and retiring fitness-function definitions.
- Requesting an evaluation from a connected evaluator.
- Receiving measurements and evidence pushed by authorized pipelines and other producers.
- Pulling measurements by executing squad-defined queries against registered sources.
- Supporting Prometheus as the first pull provider through its HTTP query API.
- Scheduling collection and retaining each collection attempt.
- Calculating outcomes from the active definition.
- Applying observe, warn, or block enforcement.
- Managing explicit, justified, time-limited waivers.
- Showing current status, history, trends, staleness, and coverage.
- Publishing tribe-level templates that squads may adopt.
- Maintaining a complete audit history.

### 3.2 Out of scope

- Replacing delivery pipelines, monitoring tools, test frameworks, or security scanners.
- Replacing Prometheus target discovery, storage, or scraping of application `/metrics` endpoints.
- Acting as the authoritative store for the raw telemetry retained by a measurement provider.
- Automatically deciding which architectural characteristics matter to a squad.
- Assigning a universal quality score to every system.
- Ranking squads.
- Treating the absence of measurements as success.
- Allowing a tribe template to become a squad-owned fitness function without an explicit adoption decision.
- Managing source code, deployment artifacts, incidents, or vulnerabilities as their system of record.

## 4. Ubiquitous language

The following terms have one meaning throughout conversations, APIs, reports, and implementation.

### Tribe

A business and engineering group that contains zero or more squads. A tribe provides organizational context, visibility, and reusable guidance.

A tribe does not own a squad's fitness functions.

### Squad

An autonomous team accountable for one or more fitness targets. A squad owns its fitness functions and the consequences of their outcomes.

### Fitness target

A system or a clearly bounded part of a system whose architectural fitness is evaluated. A target may be a product, application, service, component, data product, platform capability, integration, or deployment unit.

Every target has exactly one accountable squad in Polaris.

### Architectural characteristic

A quality or constraint that stakeholders consider important enough to protect while a system changes. Examples include performance efficiency, reliability, security, maintainability, interoperability, deployability, cost efficiency, data quality, and domain-specific constraints.

ISO/IEC 25010 may be used as a reference taxonomy, but Polaris also permits organization-specific and domain-specific characteristics.

### Fitness function

A squad-owned, versioned definition of how Polaris determines whether one or more fitness targets satisfy a stated architectural objective.

A fitness function contains intent, scope, criteria, evaluation design, freshness expectations, enforcement, and ownership. It is not the same thing as a test script or an individual test run.

### Objective

A business-readable statement of the desired architectural outcome and why it matters.

Example: “Customers must be able to place an order during the loss of one service instance.”

### Criterion

An observable rule used to judge the objective. A criterion declares a measurement, comparison, threshold, and unit.

Example: “Failed order requests must be at most 1 percent during the experiment.”

### Fitness-function version

An immutable snapshot of a fitness function's definition. An evaluation always references the exact version used to calculate its outcome.

### Evaluation design

The declared way in which measurements will be obtained. It identifies whether evaluation is automated or manual, static or dynamic, atomic or holistic, when it is triggered, and whether measurements are pushed to Polaris or pulled by Polaris.

### Acquisition mode

The direction in which measurements enter Polaris:

- `PUSH`: an authorized producer sends measurements to the Polaris receiver API.
- `PULL`: Polaris contacts a registered measurement source and executes the query declared by the squad.

Acquisition mode changes how data is obtained, not how criteria and outcomes are interpreted.

### Pull collection

Polaris-initiated retrieval of measurements from a source API. Teams may informally call this “scraping,” but Polaris documentation uses *pull collection* to distinguish it from Prometheus scraping application `/metrics` endpoints.

### Measurement producer

A pipeline, test runner, scanner, monitoring process, or authorized person that pushes measurements to Polaris.

### Measurement source

An external system from which Polaris can pull measurements. A source records the provider type, base endpoint, credential reference, ownership, status, and supported capabilities. Secrets are never exposed through the business API.

The initial provider type is `PROMETHEUS`. `GRAFANA` is a planned provider type, not an assumption embedded in the core domain.

### Provider adapter

An anti-corruption layer that translates a provider-neutral collection request into a provider-specific API request and translates the provider response into Polaris measurements.

### Collection plan

The immutable, versioned part of a fitness-function definition that tells Polaris how to pull measurements. It identifies a measurement source, schedule or trigger, timeout, and one or more metric queries mapped to criterion keys.

Because a query affects the meaning of a measurement, changing a collection plan requires a new fitness-function version.

### Metric query

A provider-specific expression plus provider-neutral result-mapping rules. A metric query maps one provider result to one fitness-function criterion.

For Prometheus, the expression is PromQL. Polaris records whether the expression is evaluated as an instant or range query and how a multi-sample result is reduced to the single measurement expected by a criterion.

### Collection attempt

An immutable record of Polaris trying to execute a collection plan. It records the source, provider, fitness-function version, query fingerprints, timing, status, and resulting evaluation or error.

### No data

A valid provider response that contains no usable value for a required criterion. No data is distinct from zero and never becomes a passing value implicitly.

### Evaluator

The actor that supplies normalized measurements for an evaluation. In push mode it is the measurement producer. In pull mode it is Polaris acting through a provider adapter and a registered measurement source.

### Evaluation request

A request for a connected evaluator to evaluate a fitness function. A request represents intent to run an evaluation; it is not proof that evaluation occurred.

### Evaluation

The immutable record of measurements, criterion results, evidence, and overall outcome for one fitness-function version at a particular time.

### Evidence

A reference to information that makes an evaluation explainable and auditable, such as a pipeline run, monitoring query, report, test result, change identifier, or manual-review record.

Polaris stores evidence references and essential metadata. The authoritative evidence may remain in the originating system.

### Outcome

The architectural result calculated for an evaluation:

- `PASS`: all required criteria were satisfied.
- `WARN`: the warning boundary was crossed, but the failure boundary was not.
- `FAIL`: one or more required criteria were not satisfied.
- `ERROR`: the evaluation could not be completed or its measurements were invalid.
- `NOT_APPLICABLE`: the function did not apply under the explicitly recorded conditions.

`ERROR`, missing, or stale is never treated as `PASS`.

### Enforcement

The squad's declared response to an outcome:

- `OBSERVE`: record and expose the result.
- `WARN`: record the result and notify accountable people or systems.
- `BLOCK`: deny the governed transition, such as release promotion, when an applicable current evaluation fails.

### Disposition

The action Polaris derives from an outcome, enforcement level, freshness, and any approved waiver. Example values are `ACCEPTED`, `ATTENTION_REQUIRED`, `BLOCKED`, and `WAIVED`.

Outcome and disposition are deliberately separate. An approved waiver can change a `BLOCKED` disposition to `WAIVED`; it never changes a `FAIL` outcome into `PASS`.

### Freshness

The maximum age of an evaluation before it no longer provides acceptable evidence of current fitness.

### Architectural drift

A sustained movement away from the objective, including repeated failures, deteriorating measurements, expired evidence, or loss of evaluation coverage.

### Waiver

An explicit, approved, time-limited acceptance of a failed, missing, or stale result. A waiver records justification, scope, owner, approver, compensating action, and expiry.

### Fitness-function template

Reusable tribe guidance from which a squad can create a draft fitness function. A template does not execute, enforce, or own anything. Adoption creates a new squad-owned fitness function that may be tailored to its context.

## 5. Domain boundaries

Polaris is divided into bounded contexts so that organizational structure, fitness policy, evaluation history, and reporting do not become one large model.

### 5.1 Team Topology context

Purpose: represent the tribe and squad accountability needed by Polaris.

Owns:

- Tribe
- Squad
- Squad status
- Relationship between a squad and its tribe

It may receive identity and organization information from an enterprise directory, but Polaris uses its own stable identifiers so that historical ownership remains understandable.

### 5.2 Fitness Management context

Purpose: allow squads to express and control what “fit” means for their targets.

Owns:

- Fitness target
- Fitness function
- Fitness-function version
- Architectural characteristic reference
- Criteria
- Evaluation design
- Enforcement
- Waiver
- Template adoption

This is the core domain.

### 5.3 Measurement Acquisition context

Purpose: receive pushed measurements and collect pulled measurements without exposing provider-specific behavior to the fitness domain.

Owns:

- Measurement source
- Provider type and capabilities
- Measurement producer authorization
- Collection attempt
- Collection schedule
- Normalized measurement batch

Responsibilities:

- Validate and deduplicate pushed measurement submissions.
- Schedule and execute pull collection plans.
- Select the provider adapter declared by a measurement source.
- Convert provider responses into typed, unit-aware Polaris measurements.
- Preserve collection evidence and errors.
- Hand normalized measurements to the Evaluation context.

This context is a generic receiver. Prometheus is an adapter inside this boundary, not a concept used by Evaluation or Fitness Management.

### 5.4 Evaluation context

Purpose: request evaluations, accept measurements, calculate outcomes, and preserve evidence.

Owns:

- Evaluator
- Evaluation request
- Evaluation
- Criterion result
- Outcome
- Disposition

This is also part of the core domain because trustworthy feedback is essential to architectural control.

### 5.5 Insight context

Purpose: provide squad and tribe views without changing ownership.

Owns derived views:

- Current fitness status
- Coverage
- Staleness
- Trend
- Architectural drift indicators
- Tribe overview

Insight data is derived from domain events. It is not authoritative for fitness-function definitions or evaluations.

### 5.6 Integration context

Purpose: protect Polaris from vendor-specific pipeline, monitoring, scanner, identity, and metric-source models.

Responsibilities:

- Implement provider adapters for external measurement sources.
- Translate external tool results into normalized Polaris measurements and evidence.
- Dispatch evaluation requests to registered evaluators.
- Map enterprise identities to Polaris actors.
- Publish decisions back to delivery or governance tools.

Every integration uses an anti-corruption layer so external terminology does not leak into the Polaris domain.

The initial Prometheus adapter:

- calls `/api/v1/query` for an instant query or `/api/v1/query_range` for a range query;
- passes the PromQL expression and the time parameters from the collection plan;
- validates the response type;
- reduces the returned value or series using the declared mapping;
- emits a normalized measurement or an explicit collection error.

Polaris does not take over Prometheus's responsibility for scraping application endpoints. Prometheus gathers and stores telemetry; Polaris queries Prometheus for the evidence required by a fitness function.

## 6. Context relationships

```text
Enterprise directory
        |
        v
Team Topology ---- supplies ownership ----> Fitness Management
                                              |
                                              | active definition
                                              v
Pipelines ----push----> Measurement Acquisition <----pull---- Measurement sources
                              |        ^
                              |        |
                       normalized      | provider adapters
                       measurements    |
                              v        |
                           Evaluation <---- Integration
                              |
                              | domain events
                              v
                           Insights
```

- Team Topology is upstream of Fitness Management for squad identity and status.
- Fitness Management is upstream of Measurement Acquisition for acquisition definitions.
- Measurement Acquisition is upstream of Evaluation for normalized measurements.
- Fitness Management is upstream of Evaluation for criteria and enforcement rules.
- Evaluation is upstream of Insights for immutable results.
- Integration translates provider and producer contracts into the Measurement Acquisition language.
- Insights never writes back into the core aggregates.

## 7. Aggregate model

### 7.1 Tribe aggregate

Aggregate root: `Tribe`

Attributes:

- `tribeId`
- `name`
- `description`
- `status`: `ACTIVE` or `ARCHIVED`
- audit information

Invariants:

- A tribe name is unique within its organization.
- An archived tribe cannot accept new squads or templates.
- Archiving a tribe does not delete squad or evaluation history.

Squads are separate aggregates referenced by `tribeId`; they are not embedded in the Tribe aggregate because a tribe may contain many squads.

### 7.2 Squad aggregate

Aggregate root: `Squad`

Attributes:

- `squadId`
- `tribeId`
- `name`
- `mission`
- `status`: `ACTIVE` or `ARCHIVED`
- business owners and technical owners
- audit information

Invariants:

- A squad belongs to exactly one tribe at a point in time.
- Only an active squad can create targets or fitness functions.
- Archiving a squad requires an explicit transfer or retirement plan for active targets and fitness functions.
- A squad transfer between tribes does not change ownership of its fitness functions; the functions move with the squad.

### 7.3 Fitness Target aggregate

Aggregate root: `FitnessTarget`

Attributes:

- `targetId`
- `ownerSquadId`
- `name`
- `description`
- `kind`: `PRODUCT`, `APPLICATION`, `SERVICE`, `COMPONENT`, `DATA_PRODUCT`, `PLATFORM`, `INTEGRATION`, or `DEPLOYMENT_UNIT`
- `externalReference`, when another catalog is the system of record
- `criticality`: `LOW`, `MODERATE`, `HIGH`, or `CRITICAL`
- `lifecycle`: `PROPOSED`, `ACTIVE`, `DEPRECATED`, or `RETIRED`
- business and technical contacts
- audit information

Invariants:

- A target has exactly one accountable squad.
- Only active or deprecated targets may be evaluated.
- Retiring a target does not remove its historical evaluations.
- An active fitness function cannot be left with no active target.

### 7.4 Fitness Function aggregate

Aggregate root: `FitnessFunction`

Entities:

- `FitnessFunctionVersion`
- `Criterion`

Value objects:

- `Objective`
- `FitnessScope`
- `CharacteristicReference`
- `MeasurementDefinition`
- `Threshold`
- `EvaluationDesign`
- `AcquisitionDefinition`
- `PushContract`
- `CollectionPlan`
- `MetricQuery`
- `ResultMapping`
- `FreshnessPolicy`
- `EnforcementPolicy`
- `Ownership`

Root attributes:

- `fitnessFunctionId`
- `ownerSquadId`
- `name`
- `lifecycle`: `DRAFT`, `ACTIVE`, or `RETIRED`
- `activeVersion`, when the function is active
- `latestVersion`, including an unactivated draft
- version history
- audit information

Version attributes:

- `version`
- `purpose`
- `objective`
- `characteristic`
- `scope`
- one or more criteria
- evaluation design
- freshness policy
- enforcement policy
- change rationale
- `state`: `DRAFT`, `ACTIVE`, or `SUPERSEDED`
- author and timestamps

Invariants:

- A fitness function belongs to exactly one squad.
- The owning squad must own every target in the function's scope.
- A function contains at least one target and one criterion.
- Every criterion has a stable key, measurement name, comparison, threshold, and unit.
- Criterion keys are unique within a version.
- Every version declares exactly one acquisition mode: `PUSH` or `PULL`.
- A push definition declares the accepted producer, measurement contract, and maximum accepted observation age.
- A pull definition contains a collection plan referencing an active measurement source owned by the same squad.
- Every required criterion in a pull definition is mapped by exactly one enabled metric query.
- A metric query maps to a criterion with a compatible value type and unit.
- Query text, query mode, reduction, no-data behavior, and timing parameters are immutable after activation.
- Only one version can be active.
- An active version is immutable.
- Activating a new version atomically supersedes the previous version.
- Evaluations already recorded continue to reference their original version.
- `BLOCK` enforcement requires an explicit freshness policy.
- A retired function accepts no new evaluation requests or evaluations, except delayed results for requests created before retirement.
- Retirement preserves the complete history.

### 7.5 Measurement Source aggregate

Aggregate root: `MeasurementSource`

Value objects:

- `ProviderType`
- `SourceEndpoint`
- `CredentialReference`
- `SourceCapabilities`
- `ConnectionPolicy`

Attributes:

- `measurementSourceId`
- `ownerSquadId`
- `name`
- `providerType`: initially `PROMETHEUS`
- `baseUrl`
- `credentialReference`
- TLS and connection policy references
- provider capabilities
- `status`: `DRAFT`, `ACTIVE`, `UNAVAILABLE`, or `RETIRED`
- last connection-check result
- audit information

Invariants:

- A source belongs to exactly one squad.
- A source endpoint uses HTTPS unless an explicitly approved internal-network policy permits otherwise.
- Credentials are referenced from a secret-management capability and are never stored or returned as clear text.
- Only an active source may be used by an active pull definition.
- Retiring a source is rejected while active fitness-function versions depend on it, unless a replacement or retirement plan is supplied.
- Changing provider type creates a new source; it does not reinterpret existing collection history.

Provider capabilities are discovered or declared, for example:

- instant query;
- range query;
- supported authentication methods;
- minimum scheduling interval;
- maximum query timeout.

### 7.6 Collection Attempt aggregate

Aggregate root: `CollectionAttempt`

Attributes:

- `collectionAttemptId`
- `fitnessFunctionId`
- `fitnessFunctionVersion`
- `measurementSourceId`
- `providerType`
- `trigger`: scheduled, on demand, release, or retry
- query fingerprints and criterion mappings
- `startedAt`
- `completedAt`
- `status`: `PENDING`, `RUNNING`, `SUCCEEDED`, `PARTIALLY_SUCCEEDED`, `FAILED`, `CANCELLED`, or `TIMED_OUT`
- normalized measurements
- provider evidence metadata
- optional resulting `evaluationId`
- error classification and retry information

Invariants:

- An attempt always references the exact active fitness-function version used to obtain its collection plan.
- Provider credentials and raw authorization headers are never recorded.
- A successful attempt contains all measurements required to create an evaluation.
- A partial, failed, or timed-out attempt never produces an implicit pass.
- Retrying creates a new attempt linked to the previous attempt.
- The raw provider response may be retained only under the declared evidence and data-retention policy.

### 7.7 Evaluation Request aggregate

Aggregate root: `EvaluationRequest`

Attributes:

- `evaluationRequestId`
- `fitnessFunctionId`
- `fitnessFunctionVersion`
- `acquisitionMode`
- optional `producerId`
- optional `measurementSourceId`
- `reason`
- `requestedBy`
- `requestedAt`
- `deadline`
- `status`: `PENDING`, `DISPATCHED`, `COMPLETED`, `FAILED`, `CANCELLED`, or `TIMED_OUT`
- related change or release reference

Invariants:

- A request uses the version that was active when the request was accepted.
- Its producer or source is derived from the immutable acquisition definition, not supplied by the requester.
- Completing a request requires a valid evaluation reference.
- A completed, cancelled, failed, or timed-out request is terminal.
- A request timeout produces an unknown or stale condition, never a passing evaluation.

### 7.8 Evaluation aggregate

Aggregate root: `Evaluation`

Entities:

- `CriterionResult`

Value objects:

- `Measurement`
- `EvidenceReference`
- `Outcome`
- `Disposition`
- `EvaluationTime`

Attributes:

- `evaluationId`
- `fitnessFunctionId`
- `fitnessFunctionVersion`
- optional `evaluationRequestId`
- `acquisitionMode`
- optional `measurementSubmissionId`
- optional `collectionAttemptId`
- `evaluatorId`
- target snapshot
- submitted measurements
- calculated criterion results
- overall outcome
- disposition
- evidence
- `observedAt`
- `receivedAt`
- `validUntil`
- optional external run identifier

Invariants:

- An evaluation is immutable after acceptance.
- Polaris, not the reporting client, calculates criterion results and overall outcome from the referenced definition.
- Every required criterion must have a valid measurement unless the outcome is `ERROR` or an approved `NOT_APPLICABLE`.
- The measurement unit must be compatible with the criterion unit.
- Duplicate reports from the same evaluator and external run identifier return the existing evaluation.
- Exactly one acquisition origin is recorded: a push submission or a pull collection attempt.
- Evidence must identify its origin and capture time.
- A later waiver does not rewrite the recorded outcome; disposition views are recalculated with the waiver shown explicitly.

### 7.9 Waiver aggregate

Aggregate root: `Waiver`

Attributes:

- `waiverId`
- `fitnessFunctionId`
- optional criterion keys
- optional target identifiers
- `reason`
- `risk`
- `compensatingAction`
- `requestedBy`
- `approvedBy`
- `startsAt`
- `expiresAt`
- `status`: `REQUESTED`, `APPROVED`, `REJECTED`, `REVOKED`, or `EXPIRED`
- audit information

Invariants:

- A waiver has a finite expiry.
- The requester and approver must be recorded.
- Approval follows the squad's configured authority policy.
- A waiver applies only to its declared function version or declared version range.
- Expiry is automatic and cannot be extended implicitly.
- Revocation is effective immediately.
- A waiver never changes an evaluation outcome.

### 7.10 Fitness Function Template aggregate

Aggregate root: `FitnessFunctionTemplate`

Attributes:

- `templateId`
- `tribeId`
- `name`
- `purpose`
- suggested characteristic, criteria, evaluation design, and enforcement
- version
- status
- audit information

Invariants:

- A template is guidance and cannot produce evaluations.
- A squad must explicitly adopt a template.
- Adoption copies a selected template version into a new squad-owned draft.
- Later template changes do not silently change adopted fitness functions.

## 8. Fitness-function classification

Polaris records classification because different fitness functions require different feedback mechanisms.

### Scope

- `ATOMIC`: evaluates one architectural component or narrowly bounded characteristic.
- `HOLISTIC`: evaluates the behavior of a complete target or multiple parts of one squad-owned system.

### Activation

- `TRIGGERED`: evaluated because an event occurred, such as a commit, merge, deployment, or release request.
- `CONTINUAL`: evaluated continuously or at a declared recurring interval.

### Observation

- `STATIC`: evaluates an artifact or structure without running the target.
- `DYNAMIC`: evaluates a running target or real operational behavior.

### Execution

- `AUTOMATED`: measurements are produced without a human judgment step.
- `MANUAL`: an authorized person records a structured assessment and evidence.

### Origin

- `INTENTIONAL`: explicitly created to protect a known architectural objective.
- `EMERGENT`: introduced after learning from incidents, delivery friction, regulatory change, or observed drift.

These classifications describe a function; they do not determine whether it is good. A manual holistic review can be more valuable than an automated metric that measures the wrong thing.

## 9. Measurement acquisition

### 9.1 Common acquisition contract

Push and pull converge on the same normalized measurement batch:

- fitness-function identifier and exact version;
- acquisition mode and origin identifier;
- observation time;
- one typed value and unit for each mapped criterion;
- evidence metadata;
- producer or source identity;
- correlation and idempotency identifiers.

After normalization, the Evaluation context applies the same criteria regardless of acquisition mode. Provider-specific fields never enter the Evaluation aggregate.

A submission or collection normally uses the active fitness-function version. An older version is accepted only when it belongs to a still-valid evaluation request created while that version was active. This prevents delayed pipeline data or collection work from being evaluated against a definition it was not designed to satisfy.

### 9.2 Push strategy

Push is intended for delivery pipelines, test runners, scanners, or other systems that already calculate the measurements needed by a fitness function.

Flow:

```text
Pipeline or producer
        |
        | measurement submission
        v
Polaris receiver API
        |
        | validate, authorize, deduplicate, normalize
        v
Evaluation
        |
        | calculate criteria and outcome
        v
Disposition
```

Rules:

- The producer submits measurements, not an authoritative outcome.
- Polaris calculates the outcome using the referenced fitness-function version.
- The producer must be authorized for the owning squad and fitness function.
- Each submission carries an idempotency key or stable external run identifier.
- Observation time and receipt time are recorded separately.
- Submissions older than the push contract permits are rejected or recorded as late; they cannot replace newer current evidence.
- Unknown criterion keys, incompatible units, and non-finite numbers are rejected.
- A batch is atomic for evaluation: partial required measurements result in an error, not a partial pass.
- Batch submission is supported for pipeline efficiency, but each item retains its own acceptance or rejection result.

### 9.3 Pull strategy

Pull is intended for measurements already available from a queryable platform.

Flow:

```text
Collection schedule or explicit request
        |
        v
Collection plan from active fitness-function version
        |
        v
Provider adapter ----query----> Measurement source
        |                              |
        <---------provider result------+
        |
        | normalize and map
        v
Evaluation
```

A collection plan declares:

- measurement source;
- trigger or schedule;
- timeout;
- queries;
- criterion mapping;
- instant or range semantics;
- lookback and step where applicable;
- reduction of multiple samples or series;
- expected result type and unit;
- no-data behavior;
- retry policy.

Supported triggers:

- `SCHEDULED`
- `ON_DEMAND`
- `RELEASE`
- `DEPLOYMENT`

For the initial release, scheduled and on-demand collection are required. Release and deployment triggers can use the same evaluation-request API when integrations are added.

### 9.4 Prometheus provider

The first provider adapter is `PROMETHEUS`.

Polaris uses the Prometheus HTTP query API:

- instant queries for a value at one evaluation time;
- range queries for values across a declared interval.

The squad supplies PromQL as part of the immutable collection plan. Polaris supplies controlled time parameters and never permits a caller to override the registered source endpoint.

Example criterion mapping:

```json
{
  "criterionKey": "request_failure_rate",
  "query": {
    "language": "PROMQL",
    "expression": "100 * sum(rate(http_requests_total{service=\"checkout\",status=~\"5..\"}[5m])) / sum(rate(http_requests_total{service=\"checkout\"}[5m]))",
    "mode": "INSTANT"
  },
  "resultMapping": {
    "expectedResultType": "VECTOR",
    "seriesPolicy": "REQUIRE_SINGLE_SERIES",
    "reduction": "LAST",
    "outputUnit": "PERCENT",
    "noData": "ERROR"
  }
}
```

For a range query, supported initial reductions are:

- `LAST`
- `MIN`
- `MAX`
- `AVERAGE`
- `SUM`
- `COUNT`

The collection plan must state how multiple series are handled:

- `REQUIRE_SINGLE_SERIES`
- `REDUCE_ACROSS_SERIES`
- `ERROR_ON_MULTIPLE_SERIES`

Ambiguous results fail collection. Polaris never selects an arbitrary series.

Prometheus remains responsible for discovering and scraping application targets, storing time series, and enforcing its telemetry-retention rules. Polaris queries the Prometheus API; it does not become another Prometheus server.

### 9.5 Provider abstraction

The provider adapter contract exposes provider-neutral operations:

```text
checkConnection(source)
discoverCapabilities(source)
validateQuery(source, query)
executeQuery(source, query, timeContext)
normalizeResult(providerResult, resultMapping)
```

The core domain knows only:

- the provider type;
- declared capabilities;
- query expression and language;
- result mapping;
- normalized measurement or collection error.

A future `GRAFANA` adapter may query an approved Grafana data source through Grafana APIs. It will implement the same contract and produce the same normalized measurements. Adding it must not require changes to criteria, thresholds, evaluation outcomes, enforcement, waivers, or historical evaluation records.

Provider-specific configuration is isolated:

| Concern | Provider-neutral domain | Prometheus adapter | Future Grafana adapter |
|---|---|---|---|
| Source | Measurement source | Prometheus server | Grafana instance and data source |
| Query | Metric query | PromQL | Provider/query model supported by Grafana |
| Collection | Execute query | Prometheus HTTP API | Grafana API |
| Result | Normalized measurement | Scalar/vector/matrix mapping | Data-frame mapping |
| Evidence | Collection metadata | Query time and response metadata | Query and data-source metadata |

### 9.6 Scheduling, concurrency, and failure

- A schedule uses an ISO 8601 interval and an optional aligned time zone.
- Polaris prevents overlapping attempts for the same function version unless the plan explicitly permits them.
- Collection has a bounded timeout.
- Retries use bounded backoff and create distinct attempts.
- Provider rate limiting is respected per measurement source.
- A circuit breaker may pause collection from an unavailable source without marking functions as passing.
- When collection remains unavailable past fitness freshness, current state becomes stale.
- Source failure, authentication failure, query error, timeout, invalid result, and no data are distinct error classifications.

### 9.7 Security

- Source credentials are referenced by secret identifier.
- Polaris retrieves credentials only while executing the adapter.
- API responses, events, and audit records never contain credentials.
- Queries are limited to the registered source and cannot provide an arbitrary URL.
- Outbound destinations are validated against organizational network policy.
- Query size, duration, lookback, result size, and execution frequency are bounded.
- Evidence access follows the owning squad's authorization boundary.
- Push producers receive the minimum scope needed to submit measurements.

## 10. Characteristic catalog

Polaris provides a reference catalog rather than a mandatory checklist.

The initial catalog contains the ISO/IEC 25010:2023 product-quality characteristics:

- Functional suitability
- Performance efficiency
- Compatibility
- Interaction capability
- Reliability
- Security
- Maintainability
- Flexibility
- Safety

Polaris also permits:

- organization-specific characteristics such as deployability, observability, sustainability, or cost efficiency;
- domain-specific characteristics such as financial reconciliation, order integrity, data timeliness, or regulatory traceability.

Every characteristic reference records its catalog, version, characteristic, and optional subcharacteristic. Updating a catalog does not rewrite existing fitness-function versions.

## 11. Lifecycle

### 11.1 Fitness-function lifecycle

```text
DRAFT --activate--> ACTIVE --retire--> RETIRED
                         |
                         +--activate new version--> ACTIVE
                             previous version becomes SUPERSEDED
```

Draft:

- editable by the owning squad;
- produces no governed evaluations;
- may be validated through a dry run.

Active:

- has one immutable active version;
- accepts evaluation requests and reports;
- participates in current status and enforcement.

Retired:

- terminal for normal operation;
- remains available for audit and historical analysis.

### 11.2 Recommended design workflow

1. Identify stakeholders and the architectural characteristic that matters.
2. Write the objective in business language.
3. State the scope and system conditions.
4. Define observable criteria, units, and thresholds.
5. Choose the evaluator and trigger.
6. Declare how fresh the evidence must be.
7. Choose observe, warn, or block based on business risk.
8. Dry-run the definition to validate signal quality.
9. Activate the version.
10. Review the function periodically and after material business or architectural change.

## 12. Outcome calculation

Polaris calculates results deterministically from the fitness-function version.

For each criterion:

1. Validate the measurement name, type, and unit.
2. Apply the declared comparison.
3. Calculate `PASS`, `WARN`, `FAIL`, or `ERROR`.
4. Preserve the raw measurement and evidence.

The overall outcome is:

- `ERROR` when required measurements are invalid or evaluation cannot be trusted;
- `FAIL` when at least one required criterion fails;
- `WARN` when none fail and at least one warns;
- `PASS` when all required criteria pass;
- `NOT_APPLICABLE` only when the definition permits it and the reason is recorded.

Polaris does not average a serious failure away. A function may define weighted informational measures, but required criteria remain explicit.

Freshness is evaluated separately:

- `CURRENT`: the latest accepted evaluation has not passed `validUntil`.
- `STALE`: an evaluation exists but is no longer current.
- `NEVER_EVALUATED`: no accepted evaluation exists.

## 13. Enforcement rules

| Enforcement | Passing | Warning | Failure | Error, stale, or missing |
|---|---|---|---|---|
| `OBSERVE` | Accepted | Recorded | Recorded | Recorded as unknown |
| `WARN` | Accepted | Attention required | Attention required | Attention required |
| `BLOCK` | Accepted | Configurable, default attention required | Blocked | Blocked |

An approved applicable waiver changes `BLOCKED` to `WAIVED` until expiry. The underlying outcome and freshness remain visible.

Blocking decisions must state:

- the fitness function and version;
- the latest evaluation and its evidence;
- the failed, errored, stale, or missing criteria;
- the applicable waiver, if any;
- the next action available to the squad.

## 14. Authorization and accountability

Business roles:

- `Tribe Viewer`: reads tribe and squad fitness views.
- `Tribe Template Manager`: manages tribe templates but cannot edit squad functions.
- `Squad Viewer`: reads its squad definitions and evaluations.
- `Squad Fitness Maintainer`: creates drafts and new versions.
- `Squad Fitness Approver`: activates and retires functions.
- `Measurement Source Manager`: registers and retires sources and validates provider queries.
- `Measurement Producer Reporter`: pushes measurements only for explicitly authorized functions.
- `Collection Operator`: requests and retries pull collection attempts.
- `Waiver Requester`: requests a waiver.
- `Waiver Approver`: approves or rejects a waiver according to the squad policy.
- `Topology Administrator`: manages tribes, squads, and transfers.
- `Auditor`: reads definitions, evaluations, evidence metadata, waivers, and audit history.

Rules:

- Mutation is authorized against the owning squad, not merely the tribe.
- Read access may be broader than mutation access.
- Producers, sources, and provider adapters cannot change definitions or enforcement.
- Source credentials can be used by the acquisition runtime but cannot be read through the REST API.
- A tribe role does not imply permission to mutate every squad's fitness functions.
- All state changes record actor, time, reason, and correlation identifier.

## 15. REST API principles

Base path:

```text
/api/v1
```

Principles:

- Resources use business language from this document.
- Identifiers are opaque strings.
- Dates and times use ISO 8601 UTC.
- Monetary and measured values use explicit units.
- Collection responses are paginated.
- Push payload size, batch size, observation age, and request rate are bounded.
- Pull query duration, lookback, result size, and scheduling frequency are bounded.
- Mutating requests accept `Idempotency-Key`.
- Versioned resources use `ETag` and `If-Match` to prevent lost updates.
- Errors use `application/problem+json`.
- Creation returns `201 Created` and a `Location` header.
- Asynchronous evaluation requests return `202 Accepted`.
- Historical evaluations and activated versions are immutable.
- Actions with business meaning are represented as subordinate resources such as activations, retirements, approvals, and revocations.

## 16. REST resources

### 16.1 Tribes

#### Create a tribe

```http
POST /api/v1/tribes
```

```json
{
  "name": "Commerce",
  "description": "Builds customer purchasing and order capabilities"
}
```

#### Get a tribe

```http
GET /api/v1/tribes/{tribeId}
```

#### List tribes

```http
GET /api/v1/tribes?status=ACTIVE&cursor={cursor}&limit=50
```

#### Archive a tribe

```http
POST /api/v1/tribes/{tribeId}/archivals
```

```json
{
  "reason": "Commerce capabilities moved to a new operating model"
}
```

### 16.2 Squads

#### Register a squad in a tribe

```http
POST /api/v1/tribes/{tribeId}/squads
```

```json
{
  "name": "Checkout",
  "mission": "Enable customers to complete purchases reliably",
  "businessOwners": ["person:8c83"],
  "technicalOwners": ["person:4b20"]
}
```

#### List squads in a tribe

```http
GET /api/v1/tribes/{tribeId}/squads?status=ACTIVE
```

#### Get a squad

```http
GET /api/v1/squads/{squadId}
```

#### Transfer a squad

```http
POST /api/v1/squads/{squadId}/transfers
```

```json
{
  "destinationTribeId": "tribe_fulfilment",
  "effectiveAt": "2026-08-01T00:00:00Z",
  "reason": "Operating model change"
}
```

The squad's targets and fitness functions remain owned by the squad.

### 16.3 Fitness targets

#### Register a target

```http
POST /api/v1/squads/{squadId}/fitness-targets
```

```json
{
  "name": "Checkout API",
  "description": "Accepts and confirms customer purchase requests",
  "kind": "SERVICE",
  "criticality": "CRITICAL",
  "externalReference": {
    "catalog": "enterprise-service-catalog",
    "id": "checkout-api"
  },
  "businessContacts": ["person:8c83"],
  "technicalContacts": ["group:checkout-on-call"]
}
```

#### List a squad's targets

```http
GET /api/v1/squads/{squadId}/fitness-targets?lifecycle=ACTIVE
```

#### Get a target

```http
GET /api/v1/fitness-targets/{targetId}
```

#### Change target lifecycle

```http
POST /api/v1/fitness-targets/{targetId}/lifecycle-transitions
```

```json
{
  "to": "DEPRECATED",
  "reason": "Replacement service is available"
}
```

### 16.4 Measurement sources

#### List supported provider types

```http
GET /api/v1/measurement-provider-types
```

```json
{
  "items": [
    {
      "providerType": "PROMETHEUS",
      "status": "SUPPORTED",
      "queryLanguages": ["PROMQL"],
      "capabilities": {
        "instantQuery": true,
        "rangeQuery": true,
        "connectionCheck": true,
        "queryValidation": true
      }
    }
  ]
}
```

Clients discover capabilities through this resource rather than assuming that every provider behaves like Prometheus. A future Grafana adapter will add another item without changing the source, collection-attempt, or evaluation resource shapes.

#### Register a Prometheus source

```http
POST /api/v1/squads/{squadId}/measurement-sources
Idempotency-Key: register-commerce-prometheus
```

```json
{
  "name": "Commerce production metrics",
  "providerType": "PROMETHEUS",
  "baseUrl": "https://prometheus.metrics.example.net",
  "credentialReference": "secret://polaris/commerce/prometheus-reader",
  "connectionPolicy": {
    "timeout": "PT10S",
    "tlsPolicy": "ORGANIZATION_DEFAULT"
  }
}
```

The response never contains credential material.

A newly registered source is `DRAFT` until a successful connection check is explicitly accepted through activation.

#### List a squad's sources

```http
GET /api/v1/squads/{squadId}/measurement-sources?providerType=PROMETHEUS&status=ACTIVE
```

#### Get a source

```http
GET /api/v1/measurement-sources/{measurementSourceId}
```

#### Check a source connection

```http
POST /api/v1/measurement-sources/{measurementSourceId}/connection-checks
Idempotency-Key: source-check-2026-07-25T1700
```

Response:

```json
{
  "connectionCheckId": "check_01K0RB",
  "status": "SUCCEEDED",
  "providerType": "PROMETHEUS",
  "capabilities": {
    "instantQuery": true,
    "rangeQuery": true
  },
  "checkedAt": "2026-07-25T17:00:02Z"
}
```

#### Validate a provider query

```http
POST /api/v1/measurement-sources/{measurementSourceId}/query-validations
```

```json
{
  "query": {
    "language": "PROMQL",
    "expression": "sum(rate(http_requests_total{service=\"checkout\"}[5m]))",
    "mode": "INSTANT"
  },
  "resultMapping": {
    "expectedResultType": "VECTOR",
    "seriesPolicy": "REQUIRE_SINGLE_SERIES",
    "reduction": "LAST",
    "outputUnit": "REQUESTS_PER_SECOND",
    "noData": "ERROR"
  }
}
```

Validation checks syntax, provider capability, configured limits, and result mapping. Query execution is optional and requires `"executeSample": true`; it creates an audited collection attempt.

#### Activate a source

```http
POST /api/v1/measurement-sources/{measurementSourceId}/activations
```

```json
{
  "connectionCheckId": "check_01K0RB",
  "reason": "Connectivity and read-only access verified"
}
```

Activation requires a recent successful connection check. It does not validate every future fitness-function query; those queries are validated with their draft definitions.

#### Retire a source

```http
POST /api/v1/measurement-sources/{measurementSourceId}/retirements
```

Retirement is rejected when an active fitness-function version still depends on the source.

### 16.5 Fitness functions

#### Create a draft

```http
POST /api/v1/squads/{squadId}/fitness-functions
```

```json
{
  "name": "Checkout remains available during one instance loss",
  "purpose": "Protect completed purchases and revenue during routine infrastructure failures",
  "objective": "Customers can complete checkout while one Checkout API instance is unavailable.",
  "characteristic": {
    "catalog": "ISO_IEC_25010",
    "catalogVersion": "2023",
    "characteristic": "RELIABILITY",
    "subcharacteristic": "FAULT_TOLERANCE"
  },
  "scope": {
    "targetIds": ["target_checkout_api"]
  },
  "classification": {
    "scope": "HOLISTIC",
    "activation": "TRIGGERED",
    "observation": "DYNAMIC",
    "execution": "AUTOMATED",
    "origin": "INTENTIONAL"
  },
  "criteria": [
    {
      "key": "request_failure_rate",
      "description": "Customer request failure rate during loss of one instance",
      "measurement": {
        "name": "request_failure_rate",
        "valueType": "DECIMAL",
        "unit": "PERCENT"
      },
      "warning": {
        "comparison": "GREATER_THAN",
        "value": 0.5
      },
      "failure": {
        "comparison": "GREATER_THAN",
        "value": 1.0
      },
      "required": true
    },
    {
      "key": "recovery_time",
      "description": "Time until normal service is restored",
      "measurement": {
        "name": "recovery_time",
        "valueType": "DECIMAL",
        "unit": "SECONDS"
      },
      "warning": {
        "comparison": "GREATER_THAN",
        "value": 45
      },
      "failure": {
        "comparison": "GREATER_THAN",
        "value": 60
      },
      "required": true
    }
  ],
  "evaluationDesign": {
    "trigger": "ON_DEMAND",
    "instructions": "Remove one instance while applying the declared representative load."
  },
  "acquisition": {
    "mode": "PULL",
    "collectionPlan": {
      "measurementSourceId": "source_commerce_prometheus",
      "trigger": "ON_DEMAND",
      "timeout": "PT10S",
      "queries": [
        {
          "criterionKey": "request_failure_rate",
          "query": {
            "language": "PROMQL",
            "expression": "100 * sum(rate(http_requests_total{service=\"checkout\",status=~\"5..\"}[5m])) / sum(rate(http_requests_total{service=\"checkout\"}[5m]))",
            "mode": "INSTANT"
          },
          "resultMapping": {
            "expectedResultType": "VECTOR",
            "seriesPolicy": "REQUIRE_SINGLE_SERIES",
            "reduction": "LAST",
            "outputUnit": "PERCENT",
            "noData": "ERROR"
          }
        },
        {
          "criterionKey": "recovery_time",
          "query": {
            "language": "PROMQL",
            "expression": "checkout_last_recovery_duration_seconds",
            "mode": "INSTANT"
          },
          "resultMapping": {
            "expectedResultType": "VECTOR",
            "seriesPolicy": "REQUIRE_SINGLE_SERIES",
            "reduction": "LAST",
            "outputUnit": "SECONDS",
            "noData": "ERROR"
          }
        }
      ],
      "retryPolicy": {
        "maximumAttempts": 2
      }
    }
  },
  "freshnessPolicy": {
    "maximumAge": "P30D"
  },
  "enforcementPolicy": {
    "level": "BLOCK",
    "governedTransition": "PRODUCTION_RELEASE"
  },
  "changeRationale": "Initial definition"
}
```

Response:

```http
HTTP/1.1 201 Created
Location: /api/v1/fitness-functions/ff_checkout_resilience
ETag: "1"
```

#### List fitness functions

```http
GET /api/v1/squads/{squadId}/fitness-functions?lifecycle=ACTIVE&characteristic=RELIABILITY&targetId={targetId}&cursor={cursor}&limit=50
```

#### Get a fitness function

```http
GET /api/v1/fitness-functions/{fitnessFunctionId}
```

The representation includes the active version, version history links, latest status, ownership, and available actions.

#### Create a new draft version

```http
POST /api/v1/fitness-functions/{fitnessFunctionId}/versions
If-Match: "4"
```

```json
{
  "basedOnVersion": 3,
  "changeRationale": "Peak traffic has doubled and the recovery objective is stricter",
  "definition": {
    "purpose": "Protect completed purchases and revenue during routine infrastructure failures",
    "objective": "Customers can complete checkout while one Checkout API instance is unavailable.",
    "characteristic": {
      "catalog": "ISO_IEC_25010",
      "catalogVersion": "2023",
      "characteristic": "RELIABILITY",
      "subcharacteristic": "FAULT_TOLERANCE"
    },
    "scope": {
      "targetIds": ["target_checkout_api"]
    },
    "criteria": [],
    "evaluationDesign": {},
    "freshnessPolicy": {
      "maximumAge": "P14D"
    },
    "enforcementPolicy": {
      "level": "BLOCK",
      "governedTransition": "PRODUCTION_RELEASE"
    }
  }
}
```

The omitted criterion, evaluation, and acquisition fields follow the same shapes as draft creation.

#### Get the version history

```http
GET /api/v1/fitness-functions/{fitnessFunctionId}/versions
```

The response distinguishes the active, superseded, and draft versions. It does not infer that the numerically latest version is active.

#### Update a draft version

```http
PATCH /api/v1/fitness-functions/{fitnessFunctionId}/versions/{version}
If-Match: "5"
Content-Type: application/merge-patch+json
```

Only a draft version can be changed. The request may change its objective, criteria, evaluation design, acquisition definition, freshness, or enforcement, while aggregate invariants continue to apply. Activated and superseded versions reject modification.

#### Validate a draft

```http
POST /api/v1/fitness-functions/{fitnessFunctionId}/versions/{version}/validations
```

Validation checks completeness, units, threshold consistency, producer or source availability, query mappings, target ownership, and enforcement prerequisites. It does not activate the definition.

#### Activate a version

```http
POST /api/v1/fitness-functions/{fitnessFunctionId}/versions/{version}/activations
Idempotency-Key: 6fa97c92-1179-4621-ad78-030d980b70b8
```

```json
{
  "reason": "Definition reviewed and dry-run evidence accepted"
}
```

Activation atomically supersedes the previous active version.

#### Retire a fitness function

```http
POST /api/v1/fitness-functions/{fitnessFunctionId}/retirements
```

```json
{
  "reason": "The target was retired",
  "effectiveAt": "2026-09-01T00:00:00Z"
}
```

### 16.6 Measurement producers

#### Register a push producer

```http
POST /api/v1/squads/{squadId}/measurement-producers
```

```json
{
  "name": "Checkout resilience runner",
  "kind": "PIPELINE",
  "supportedMeasurementNames": [
    "request_failure_rate",
    "recovery_time"
  ],
  "authorizedFitnessFunctionIds": [
    "ff_checkout_pipeline_resilience"
  ],
  "dispatchReference": "integration:resilience-runner/checkout",
  "evidenceOrigin": "https://delivery.example.net"
}
```

Authentication credentials and vendor-specific connection data belong to the Integration context and are not returned in this business resource.

A push fitness-function version references the producer through this acquisition definition:

```json
{
  "acquisition": {
    "mode": "PUSH",
    "pushContract": {
      "producerId": "producer_checkout_pipeline",
      "maximumObservationAge": "PT1H",
      "requiredCriterionKeys": [
        "request_failure_rate",
        "recovery_time"
      ]
    }
  }
}
```

### 16.7 Evaluation requests

#### Request an evaluation

```http
POST /api/v1/fitness-functions/{fitnessFunctionId}/evaluation-requests
Idempotency-Key: release-checkout-2026-07-25.4
```

```json
{
  "reason": "Production release candidate",
  "relatedChange": {
    "kind": "RELEASE",
    "id": "checkout-2026.07.25.4",
    "url": "https://delivery.example.net/releases/checkout-2026.07.25.4"
  },
  "deadline": "2026-07-25T18:00:00Z"
}
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /api/v1/evaluation-requests/er_01K0R7
```

For a pull definition, accepting the request creates a collection attempt using the collection plan in the referenced fitness-function version. For a push definition with a dispatch integration, Polaris notifies the registered producer and waits for a measurement submission. A push definition without dispatch remains pending until an authorized producer submits data or the request times out.

#### Get an evaluation request

```http
GET /api/v1/evaluation-requests/{evaluationRequestId}
```

#### Cancel a pending request

```http
POST /api/v1/evaluation-requests/{evaluationRequestId}/cancellations
```

### 16.8 Measurement submissions and evaluations

#### Submit measurements from a pipeline

```http
POST /api/v1/fitness-functions/{fitnessFunctionId}/measurement-submissions
Idempotency-Key: resilience-run-89031
```

```json
{
  "fitnessFunctionVersion": 3,
  "evaluationRequestId": "er_01K0R7",
  "producerId": "producer_checkout_pipeline",
  "externalRunId": "resilience-run-89031",
  "observedAt": "2026-07-25T16:31:04Z",
  "measurements": [
    {
      "criterionKey": "request_failure_rate",
      "value": 0.22,
      "unit": "PERCENT"
    },
    {
      "criterionKey": "recovery_time",
      "value": 37,
      "unit": "SECONDS"
    }
  ],
  "evidence": [
    {
      "kind": "TEST_RUN",
      "origin": "delivery-platform",
      "reference": "resilience-run-89031",
      "url": "https://delivery.example.net/runs/resilience-run-89031",
      "capturedAt": "2026-07-25T16:32:01Z",
      "digest": "sha256:4b2d..."
    }
  ]
}
```

Polaris validates, authorizes, deduplicates, and normalizes the submission, then calculates the outcome. The caller cannot submit `PASS`, `WARN`, or `FAIL`. A successful response contains both the accepted submission and the resulting evaluation:

```json
{
  "measurementSubmissionId": "submission_01K0R8",
  "acquisitionMode": "PUSH",
  "evaluationId": "eval_01K0R9",
  "fitnessFunctionId": "ff_checkout_pipeline_resilience",
  "fitnessFunctionVersion": 3,
  "outcome": "PASS",
  "disposition": "ACCEPTED",
  "criterionResults": [
    {
      "criterionKey": "request_failure_rate",
      "outcome": "PASS",
      "observedValue": 0.22,
      "unit": "PERCENT"
    },
    {
      "criterionKey": "recovery_time",
      "outcome": "PASS",
      "observedValue": 37,
      "unit": "SECONDS"
    }
  ],
  "observedAt": "2026-07-25T16:31:04Z",
  "validUntil": "2026-08-24T16:31:04Z",
  "links": {
    "self": "/api/v1/evaluations/eval_01K0R9",
    "fitnessFunction": "/api/v1/fitness-functions/ff_checkout_pipeline_resilience"
  }
}
```

#### Submit a pipeline batch

```http
POST /api/v1/measurement-submission-batches
Idempotency-Key: pipeline-run-2026-07-25.4
```

```json
{
  "producerId": "producer_checkout_pipeline",
  "submissions": [
    {
      "fitnessFunctionId": "ff_checkout_pipeline_resilience",
      "fitnessFunctionVersion": 3,
      "externalRunId": "resilience-run-89031",
      "observedAt": "2026-07-25T16:31:04Z",
      "measurements": [
        {
          "criterionKey": "request_failure_rate",
          "value": 0.22,
          "unit": "PERCENT"
        },
        {
          "criterionKey": "recovery_time",
          "value": 37,
          "unit": "SECONDS"
        }
      ],
      "evidence": []
    }
  ]
}
```

The response reports acceptance or rejection for each item. One invalid item does not hide the result of another item. A successfully accepted item is still atomic across its required criteria.

#### Get an evaluation

```http
GET /api/v1/evaluations/{evaluationId}
```

#### List evaluations

```http
GET /api/v1/fitness-functions/{fitnessFunctionId}/evaluations?outcome=FAIL&from=2026-01-01T00:00:00Z&to=2026-07-31T23:59:59Z&cursor={cursor}
```

### 16.9 Collection attempts

#### Collect a pull fitness function now

```http
POST /api/v1/fitness-functions/{fitnessFunctionId}/collection-attempts
Idempotency-Key: checkout-manual-collection-2026-07-25T1705
```

```json
{
  "reason": "Validate current checkout reliability before release",
  "fitnessFunctionVersion": 3
}
```

Polaris loads the immutable collection plan, selects the adapter from the registered source's provider type, executes its queries, and creates an evaluation when all required measurements are normalized.

Response:

```http
HTTP/1.1 202 Accepted
Location: /api/v1/collection-attempts/collect_01K0RC
```

#### Get a collection attempt

```http
GET /api/v1/collection-attempts/{collectionAttemptId}
```

Example completed representation:

```json
{
  "collectionAttemptId": "collect_01K0RC",
  "fitnessFunctionId": "ff_checkout_resilience",
  "fitnessFunctionVersion": 3,
  "measurementSourceId": "source_commerce_prometheus",
  "providerType": "PROMETHEUS",
  "trigger": "ON_DEMAND",
  "status": "SUCCEEDED",
  "startedAt": "2026-07-25T17:05:00Z",
  "completedAt": "2026-07-25T17:05:01Z",
  "queryResults": [
    {
      "criterionKey": "request_failure_rate",
      "queryFingerprint": "sha256:da39...",
      "status": "SUCCEEDED",
      "normalizedMeasurement": {
        "value": 0.22,
        "unit": "PERCENT"
      }
    },
    {
      "criterionKey": "recovery_time",
      "queryFingerprint": "sha256:25bf...",
      "status": "SUCCEEDED",
      "normalizedMeasurement": {
        "value": 37,
        "unit": "SECONDS"
      }
    }
  ],
  "evaluationId": "eval_01K0RD"
}
```

#### List collection attempts

```http
GET /api/v1/fitness-functions/{fitnessFunctionId}/collection-attempts?status=FAILED&from=2026-07-01T00:00:00Z
```

#### Retry a failed attempt

```http
POST /api/v1/collection-attempts/{collectionAttemptId}/retries
Idempotency-Key: retry-collect-01K0RC-1
```

A retry uses the same fitness-function version and collection plan. If the squad wants to change the query, it must create and activate a new fitness-function version.

### 16.10 Waivers

#### Request a waiver

```http
POST /api/v1/fitness-functions/{fitnessFunctionId}/waivers
```

```json
{
  "fitnessFunctionVersions": {
    "from": 3,
    "to": 3
  },
  "criterionKeys": ["recovery_time"],
  "reason": "Infrastructure replacement temporarily increases recovery time",
  "risk": "A single-zone failure can delay checkout recovery by up to two minutes",
  "compensatingAction": "Route traffic to the secondary region and keep the release rollback ready",
  "startsAt": "2026-07-25T17:00:00Z",
  "expiresAt": "2026-08-01T17:00:00Z"
}
```

#### Approve a waiver

```http
POST /api/v1/waivers/{waiverId}/approvals
```

```json
{
  "decisionReason": "Risk and compensating action accepted for the stated period"
}
```

#### Reject a waiver

```http
POST /api/v1/waivers/{waiverId}/rejections
```

#### Revoke an approved waiver

```http
POST /api/v1/waivers/{waiverId}/revocations
```

```json
{
  "reason": "Compensating control is no longer available"
}
```

### 16.11 Templates

#### Publish a tribe template

```http
POST /api/v1/tribes/{tribeId}/fitness-function-templates
```

#### List templates

```http
GET /api/v1/tribes/{tribeId}/fitness-function-templates?status=ACTIVE
```

#### Adopt a template

```http
POST /api/v1/fitness-function-templates/{templateId}/adoptions
```

```json
{
  "squadId": "squad_checkout",
  "targetIds": ["target_checkout_api"],
  "reason": "Use the tribe resilience starting point"
}
```

Response identifies the newly created squad-owned draft fitness function.

### 16.12 Insights

#### Squad overview

```http
GET /api/v1/squads/{squadId}/fitness-overview
```

Includes:

- active functions by characteristic;
- current outcomes and dispositions;
- stale and never-evaluated functions;
- approved waivers nearing expiry;
- improving or degrading measurements;
- functions with repeated evaluation errors.

#### Tribe overview

```http
GET /api/v1/tribes/{tribeId}/fitness-overview?characteristic=RELIABILITY&freshness=STALE
```

The tribe overview aggregates visibility while retaining squad and function identity. It does not calculate a squad league table or universal fitness score.

#### Target history

```http
GET /api/v1/fitness-targets/{targetId}/fitness-history?from=2026-01-01T00:00:00Z
```

## 17. Error contract

Example:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json
```

```json
{
  "type": "https://polaris.example.net/problems/fitness-function-version-conflict",
  "title": "Fitness-function version conflict",
  "status": 409,
  "detail": "Version 4 cannot be activated because version 5 is already active.",
  "instance": "/api/v1/fitness-functions/ff_checkout_resilience/versions/4/activations",
  "code": "FITNESS_FUNCTION_VERSION_CONFLICT",
  "correlationId": "corr_01K0RA"
}
```

Important business errors:

- `SQUAD_NOT_ACTIVE`
- `TARGET_NOT_OWNED_BY_SQUAD`
- `TARGET_NOT_EVALUATABLE`
- `FITNESS_FUNCTION_INCOMPLETE`
- `FITNESS_FUNCTION_VERSION_CONFLICT`
- `FITNESS_FUNCTION_RETIRED`
- `THRESHOLD_INCONSISTENT`
- `MEASUREMENT_MISSING`
- `MEASUREMENT_UNIT_MISMATCH`
- `MEASUREMENT_PRODUCER_NOT_AUTHORIZED`
- `MEASUREMENT_SUBMISSION_TOO_OLD`
- `MEASUREMENT_SOURCE_NOT_ACTIVE`
- `MEASUREMENT_SOURCE_IN_USE`
- `MEASUREMENT_SOURCE_UNAVAILABLE`
- `PROVIDER_NOT_SUPPORTED`
- `PROVIDER_AUTHENTICATION_FAILED`
- `QUERY_INVALID`
- `QUERY_RESULT_AMBIGUOUS`
- `QUERY_LIMIT_EXCEEDED`
- `COLLECTION_TIMED_OUT`
- `COLLECTION_NO_DATA`
- `EVALUATION_DUPLICATE`
- `EVIDENCE_INVALID`
- `WAIVER_EXPIRED`
- `WAIVER_NOT_APPLICABLE`
- `PRECONDITION_REQUIRED`

## 18. Domain events

Polaris publishes business events after committed state changes:

- `TribeCreated`
- `TribeArchived`
- `SquadRegistered`
- `SquadTransferred`
- `SquadArchived`
- `FitnessTargetRegistered`
- `FitnessTargetLifecycleChanged`
- `FitnessFunctionDrafted`
- `FitnessFunctionVersionCreated`
- `FitnessFunctionVersionActivated`
- `FitnessFunctionVersionSuperseded`
- `FitnessFunctionRetired`
- `MeasurementSourceRegistered`
- `MeasurementSourceConnectionChecked`
- `MeasurementSourceBecameUnavailable`
- `MeasurementSourceRetired`
- `MeasurementProducerRegistered`
- `MeasurementSubmissionReceived`
- `MeasurementSubmissionAccepted`
- `MeasurementSubmissionRejected`
- `CollectionScheduled`
- `CollectionStarted`
- `CollectionCompleted`
- `CollectionPartiallyCompleted`
- `CollectionFailed`
- `CollectionTimedOut`
- `EvaluationRequested`
- `EvaluationRequestTimedOut`
- `EvaluationRecorded`
- `FitnessFunctionPassed`
- `FitnessFunctionWarned`
- `FitnessFunctionFailed`
- `FitnessFunctionEvaluationErrored`
- `FitnessFunctionBecameStale`
- `WaiverRequested`
- `WaiverApproved`
- `WaiverRejected`
- `WaiverRevoked`
- `WaiverExpired`
- `TemplatePublished`
- `TemplateAdopted`

Every event contains:

- event identifier and type;
- occurred time;
- aggregate identifier and version;
- tribe and squad context when applicable;
- actor, producer, or source;
- correlation and causation identifiers;
- the minimum business data necessary for consumers.

Events do not contain secrets or unrestricted evidence payloads.

## 19. Audit and evidence retention

Polaris preserves:

- every activated fitness-function version;
- who proposed and activated it;
- the change rationale;
- all accepted evaluations;
- accepted and rejected measurement-submission metadata;
- collection attempts, query fingerprints, normalized results, and error classifications;
- measurement-source lifecycle and connection checks;
- calculated outcomes;
- evidence metadata and integrity digest;
- waiver decisions;
- ownership and topology changes;
- enforcement decisions.

Retention follows organizational and regulatory policy. Removing an external evidence object does not remove the Polaris audit record that the evidence existed. Sensitive evidence remains in the appropriate source system and is referenced through access-controlled links.

## 20. Business metrics for Polaris

Polaris measures its own usefulness without ranking squads:

- percentage of active fitness functions evaluated within their freshness policy;
- median time from failed evaluation to the next passing evaluation;
- number of stale and never-evaluated functions;
- repeated evaluator error rate;
- push submission acceptance, rejection, and duplication rates;
- pull collection success, timeout, no-data, and provider-error rates;
- source availability and query latency by provider type;
- waiver count, duration, and expiry compliance;
- percentage of blocking decisions with accessible evidence;
- percentage of active targets with at least one intentional fitness function;
- adoption and local modification rate of templates;
- fitness functions retired because they no longer represent a meaningful objective.

High function count is not automatically good. A small set of meaningful, trustworthy functions is preferable to a large set of ceremonial checks.

## 21. Initial release boundary

The first usable release should include:

1. Tribe and squad registration.
2. Fitness-target registration.
3. Squad-owned fitness-function drafting, validation, activation, versioning, and retirement.
4. Push measurement receiver API for individual and batch pipeline submissions.
5. Abstract measurement-source and provider-adapter contracts.
6. Prometheus source registration, connection checking, query validation, and instant/range querying.
7. Scheduled and on-demand pull collection with collection-attempt history.
8. Server-calculated outcomes for both acquisition modes.
9. Evaluation history and freshness.
10. Observe, warn, and block dispositions.
11. Time-limited waivers.
12. Squad and tribe overview endpoints.
13. Acquisition and evaluation audit events.

Grafana support, producer dispatch, manual assessment workflows, template management, and advanced drift detection may be delivered incrementally after push and Prometheus pull acquisition are trustworthy.

## 22. Acceptance scenarios

### Squad autonomy

Given an active squad, when its authorized maintainer creates a fitness-function draft for a target it owns, then the draft belongs to that squad and no tribe user can modify it without an explicit squad mutation role.

### Immutable evaluation

Given active version 3 and a passing evaluation against version 3, when version 4 becomes active, then the original evaluation continues to show version 3 and its original calculated outcome.

### Pipeline push

Given an active push fitness function and an authorized pipeline producer, when the producer submits a complete measurement batch, then Polaris validates and normalizes the batch, calculates the outcome itself, and returns the resulting evaluation.

### Duplicate pipeline delivery

Given an accepted push submission, when a pipeline retries with the same producer and external run identifier, then Polaris returns the existing submission and evaluation without creating duplicate history.

### Prometheus pull

Given an active pull fitness function using an active Prometheus source, when its schedule becomes due, then Polaris executes the PromQL queries through the Prometheus adapter, maps the results to criteria, records the collection attempt, and calculates an evaluation.

### No data is not success

Given a required Prometheus query that returns no data, when Polaris completes the collection attempt, then it records `COLLECTION_NO_DATA` and does not produce a passing evaluation.

### Provider isolation

Given a future Grafana provider adapter, when it returns a normalized measurement batch, then Evaluation applies the same criteria and outcome rules without a Grafana-specific change to the Fitness Function or Evaluation aggregates.

### No false success

Given a blocking function whose latest evaluation has expired, when a release asks for its disposition, then Polaris returns `BLOCKED` because the current fitness is unknown.

### Transparent waiver

Given a failed blocking evaluation and an applicable approved waiver, when a release asks for its disposition, then Polaris returns `WAIVED`, while the evaluation remains `FAIL` and the waiver expiry is visible.

### Tribe visibility without ownership

Given several squads in a tribe, when a tribe viewer requests the fitness overview, then Polaris shows function-level status grouped by squad and characteristic without producing a squad ranking or permitting definition changes.

### Safe evolution

Given an active fitness-function version, when the squad needs a new threshold, then it creates and activates a new version; Polaris never mutates the definition used by earlier evaluations.

## 23. Design decisions to revisit

The following decisions should be revisited with domain experts after the initial workflows are exercised:

- Whether a fitness function may span targets owned by different squads and what explicit agreement would be required.
- Whether waiver approval requires separation of duties for specific criticalities.
- Which governed transitions can be blocked beyond production release.
- Which Grafana APIs, data-source types, and query models should be supported by the future `GRAFANA` adapter.
- Whether collection plans may combine queries from more than one measurement source.
- Whether raw provider responses should be retained, and for how long, for each data classification.
- Which schedule limits and query budgets should vary by target criticality.
- Which ISO/IEC 25010 subcharacteristics and domain-specific catalogs should be preloaded.
- How evidence-access failures affect a previously calculated outcome.
- Which trend calculations are meaningful for each measurement type.

These are explicit extension points. They must not be resolved by weakening squad ownership or rewriting historical facts.
