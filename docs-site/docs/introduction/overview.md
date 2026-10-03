---

title: "Overview"
description: "Polaris is a squad-owned architectural fitness-function control plane."
slug: "/"
---

# Polaris

Polaris is a squad-owned **architectural fitness-function control plane**. It receives pipeline
measurements, pulls Prometheus measurements, evaluates versioned criteria, and retains evidence,
lifecycle history, audit events, and delivery events.

It answers five business questions:

1. What architectural characteristics does a squad intend to protect?
2. How will the squad determine whether those characteristics remain fit?
3. What was evaluated, when, using which definition, and with what evidence?
4. What response is expected when a fitness function is not satisfied?
5. Where is architectural fitness improving, degrading, stale, or unknown?

Polaris is both the control plane and the measurement receiver. It acquires measurements in two
ways: producers `PUSH` measurements through the API, or Polaris `PULL`s them by executing
squad-defined queries against registered measurement sources — Prometheus is the first provider.
It normalizes acquired data into measurements, calculates the declared outcome deterministically
from the active version, preserves evidence and history, and applies the squad's enforcement
decision.

## What you will find here

| Section | Contents |
| --- | --- |
| [Getting started](./getting-started.md) | Run the full stack locally with Docker Compose. |
| [Authentication](./authentication.md) | Google OIDC for business routes, `X-API-Key` for ingest. |
| [Configuration](./configuration.md) | Every environment variable Polaris understands. |
| [Architecture](../modules/architecture.md) | Hexagonal architecture and module map. |
| [Domain model](../domain/ubiquitous-language.md) | Ubiquitous language, bounded contexts, aggregates, lifecycles. |
| [REST API](/api/polaris-api) | The full API reference generated from `api/openapi.yaml`. |

## Key properties

- **Spec-first**: the REST contract is [`api/openapi.yaml`](https://github.com/claudioed/polaris/blob/main/api/openapi.yaml);
  server bindings are generated and drift is rejected in CI. The live contract is served at
  `/openapi.yaml`.
- **Hexagonal Go core**: the domain has no dependency on HTTP, PostgreSQL, or Prometheus.
- **PostgreSQL as the system of record**: migrations, schedules, and a transactional outbox for
  domain events.
- **Deterministic evaluation**: outcomes are calculated from the active fitness-function version;
  evidence and history are immutable.
- **Auditable lifecycle decisions**: activation, retirement, archival, and waivers are explicit
  subordinate resources, never silent state changes.
- **Quality gates**: 90%+ coverage, mutation testing, PostgreSQL integration suites, OpenAPI
  linting, and container scans gate every change.

## Repository layout

```
polaris/
├── api/                  # OpenAPI contract (openapi.yaml) + oapi-codegen config
├── cmd/polaris/          # single process: HTTP API + scheduled-collection worker
├── internal/
│   ├── domain/fitness/   # aggregates, value objects, lifecycle rules, evaluation
│   ├── application/      # use cases and inbound/outbound ports
│   └── adapters/         # httpapi (REST), postgres (persistence), prometheus (pull)
├── migrations/           # embedded SQL migrations
├── web/                  # React + TypeScript control tower
├── tests/                # full-stack integration suites
└── docs-site/            # this documentation site (Docusaurus)
```

## Learn more

- [Domain and REST API specification (polaris.md)](https://github.com/claudioed/polaris/blob/main/polaris.md)
- [GitHub repository](https://github.com/claudioed/polaris)
- [Building Evolutionary Architectures](https://learning.oreilly.com/library/view/-/9781492097532/) — the conceptual foundation of fitness functions.
