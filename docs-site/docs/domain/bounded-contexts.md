---

title: "Bounded contexts"
description: "Five contexts keep provider mechanics out of the fitness domain."
---

# Bounded contexts

Polaris separates five contexts (domain specification, section 5). Context boundaries are what let
Prometheus be "an adapter, not a concept".

```
┌─────────────────────┐   ┌──────────────────────────┐
│  Team Topology      │   │  Fitness Management      │
│  Tribe, Squad       │──▶│  Target, Function,       │
│  squad↔tribe status │   │  Version, Waiver,        │
└─────────────────────┘   │  Template  (core domain) │
                          └───────────┬──────────────┘
                                      │ normalized measurements
┌─────────────────────┐   ┌───────────▼──────────────┐
│  Insight            │   │  Evaluation              │
│  overview, history, │◀──│  request, evaluate,      │
│  drift, coverage    │   │  evidence, outcome       │
└─────────────────────┘   └───────────▲──────────────┘
                          ┌───────────┴──────────────┐
                          │  Measurement Acquisition │
                          │  source, producer,       │
                          │  plan, attempt, batch    │
                          │  (Prometheus lives here) │
                          └──────────────────────────┘
```

| Context | Owns | Note |
| --- | --- | --- |
| **Team Topology** | Tribe, Squad, squad status, squad↔tribe relationship | Uses its own stable identifiers so historical ownership stays understandable even if an enterprise directory changes. |
| **Fitness Management** *(core)* | Fitness target, fitness function, version, characteristic reference, criteria, evaluation design, enforcement, waiver, template adoption | Where "what does fit mean" is expressed and governed. |
| **Measurement Acquisition** | Measurement source, provider types/capabilities, producer authorization, collection attempt, schedule, normalized batch | A generic receiver: validates/dedups pushes, schedules/executes pulls, converts provider responses into typed unit-aware measurements. Prometheus is an adapter inside this boundary. |
| **Evaluation** | Evaluation request, evaluation, evidence, outcome | Requests evaluations, accepts normalized measurements, calculates outcomes deterministically. |
| **Insight** | Overviews, history, trends, staleness, coverage | Read-side views for squads and tribes (the `/fitness-overview` and `/fitness-history` resources). |
| **Integration** | Outbound domain events (`POLL` / acknowledgement) | The transactional-outbox delivery surface. |

The dependency rule: Acquisition hands **normalized measurements** to Evaluation; nothing in
Fitness Management or Evaluation knows which provider produced them.
