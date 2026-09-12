---

title: "Control tower (web)"
description: "React + TypeScript front end for discovering and creating fitness functions."
---

# Control tower — `web`

The browser face of Polaris: a React 19 + TypeScript single-page application built with Vite and
served by its own container (nginx in production, Vite dev server locally).

## Source map

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Application shell and routing |
| `src/auth.ts` | Google OIDC sign-in (`VITE_GOOGLE_CLIENT_ID`) |
| `src/api.ts` | Typed API client for the REST contract |
| `src/types.ts` | Shared TypeScript types mirroring the OpenAPI schemas |
| `src/components/SignIn.tsx` | Google identity sign-in flow |
| `src/components/SetupWorkspace.tsx` | Topology setup (tribes, squads, targets, sources, producers) |
| `src/components/CreateFitnessFunction.tsx` | Guided fitness-function creation |
| `src/components/FitnessDetails.tsx` | Function detail: versions, evaluations, evidence |
| `src/utils.ts` | Formatting and helper utilities |

## Build and run

```sh
make web-install   # npm ci
make web-dev       # Vite dev server at http://localhost:5173, proxying /api to :8080
make web-test      # unit tests
make web-build     # production build
```

In Compose the tower is served at http://localhost:3000 behind nginx with security headers
(`security-headers.conf`); the Google client ID is injected at build time via
`VITE_GOOGLE_CLIENT_ID`.

## CI

The `web` job runs `npm run test`, `npm run lint`, and `npm run build` on every push and pull
request; container scans (Trivy) cover the tower image on PRs to `main`.
