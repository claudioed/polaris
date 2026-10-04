import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  ApiError,
  activateFitnessFunction,
  adoptFitnessFunctionTemplate,
  cancelEvaluationRequest,
  collectNow,
  createEvaluationRequest,
  createFitnessFunction,
  createFitnessFunctionTemplate,
  createFitnessFunctionVersion,
  createFitnessTarget,
  createSquad,
  createTribe,
  createWaiver,
  getCollectionAttempt,
  getEvaluation,
  getEvaluationRequest,
  getFitnessTargetHistory,
  getSquadFitnessOverview,
  getSquadSources,
  getSquadTargets,
  getTribeFitnessOverview,
  listCollectionAttempts,
  listEvaluations,
  listFitnessFunctionTemplates,
  loadCatalog,
  retryCollectionAttempt,
  transitionFitnessTarget,
  transitionWaiver,
} from "./api";
import {
  collectionAttempt,
  evaluation,
  evaluationRequest,
  fitnessFunction,
  page,
  problem,
  pullDefinition,
  resourceRecord,
  squad as squadFixture,
  tribe as tribeFixture,
  waiver,
} from "./test/fixtures";

function fakeToken(): string {
  const payload = btoa(JSON.stringify({ sub: "user-1" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

function signIn(): void {
  sessionStorage.setItem("polaris.idToken", fakeToken());
}

interface CapturedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body?: unknown;
}

// The server is configured per test with `server.use`; any request without a
// matching handler fails the test instead of hitting the network.
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Installs a handler for `pattern` returning `json` and records the request. */
function useCapture(
  pattern: string,
  json: Parameters<typeof HttpResponse.json>[0],
  init?: ResponseInit,
) {
  const requests: CapturedRequest[] = [];
  const handler = http.all(pattern, async ({ request }) => {
    const url = new URL(request.url);
    const clone = request.clone();
    let body: unknown;
    try {
      body = await clone.json();
    } catch {
      body = undefined;
    }
    requests.push({
      method: request.method,
      path: url.pathname,
      query: url.searchParams,
      headers: request.headers,
      body,
    });
    return HttpResponse.json(json, init);
  });
  server.use(handler);
  return {
    requests,
    only(): CapturedRequest {
      if (requests.length !== 1) {
        throw new Error(`expected exactly one request, got ${requests.length}`);
      }
      return requests[0];
    },
  };
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("request fundamentals", () => {
  it("attaches the bearer token and JSON accept header when signed in", async () => {
    signIn();
    const captured = useCapture(
      "*/api/v1/squads/:squadId/fitness-targets",
      page([resourceRecord()]),
    );

    await getSquadTargets("squad-1");

    const request = captured.only();
    expect(request.method).toBe("GET");
    expect(request.path).toBe("/api/v1/squads/squad-1/fitness-targets");
    expect(request.headers.get("Authorization")).toBe(`Bearer ${fakeToken()}`);
    expect(request.headers.get("Accept")).toBe("application/json");
    expect(request.headers.get("Content-Type")).toBeNull();
  });

  it("omits the Authorization header when signed out", async () => {
    const captured = useCapture(
      "*/api/v1/squads/:squadId/fitness-targets",
      page([resourceRecord()]),
    );

    await getSquadTargets("squad-1");

    expect(captured.only().headers.get("Authorization")).toBeNull();
  });

  it("parses successful JSON responses", async () => {
    const item = resourceRecord({ id: "target-9", data: { name: "Orders API" } });
    useCapture("*/api/v1/squads/:squadId/fitness-targets", page([item]));

    await expect(getSquadTargets("squad-1")).resolves.toEqual(page([item]));
  });

  it("propagates network failures", async () => {
    server.use(
      http.all("*/api/v1/squads/:squadId/fitness-targets", () => HttpResponse.error()),
    );

    await expect(getSquadTargets("squad-1")).rejects.toThrow(TypeError);
  });
});

describe("error handling", () => {
  it("rejects with ApiError and clears the session on 401", async () => {
    signIn();
    useCapture(
      "*/api/v1/squads/:squadId/fitness-targets",
      problem({ status: 401, title: "Unauthorized" }),
      { status: 401 },
    );

    const failure = await getSquadTargets("squad-1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(401);
    expect((failure as ApiError).problem?.title).toBe("Unauthorized");
    expect(sessionStorage.getItem("polaris.idToken")).toBeNull();
  });

  it("rejects with ApiError and clears the session on 403", async () => {
    signIn();
    useCapture(
      "*/api/v1/squads/:squadId/fitness-targets",
      problem({ status: 403, title: "Forbidden", code: "FORBIDDEN" }),
      { status: 403 },
    );

    const failure = await getSquadTargets("squad-1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(403);
    expect(sessionStorage.getItem("polaris.idToken")).toBeNull();
  });

  it("prefers the problem detail as the message", async () => {
    useCapture(
      "*/api/v1/squads/:squadId/fitness-targets",
      problem({ status: 409, title: "Conflict", detail: "Revision mismatch" }),
      { status: 409 },
    );

    const failure = await getSquadTargets("squad-1").catch((error: unknown) => error);
    expect((failure as ApiError).message).toBe("Revision mismatch");
  });

  it("falls back to the problem title when detail is absent", async () => {
    useCapture(
      "*/api/v1/squads/:squadId/fitness-targets",
      problem({ status: 422, detail: undefined, title: "Validation failed" }),
      { status: 422 },
    );

    const failure = await getSquadTargets("squad-1").catch((error: unknown) => error);
    expect((failure as ApiError).message).toBe("Validation failed");
  });

  it("falls back to a status message for non-JSON error bodies", async () => {
    server.use(
      http.all("*/api/v1/squads/:squadId/fitness-targets", () =>
        new HttpResponse("gateway timeout", { status: 504, headers: { "Content-Type": "text/plain" } }),
      ),
    );

    const failure = await getSquadTargets("squad-1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(504);
    expect((failure as ApiError).problem).toBeUndefined();
    expect((failure as ApiError).message).toBe("Polaris request failed (504)");
  });

  it("falls back to a status message when the error body is malformed JSON", async () => {
    server.use(
      http.all("*/api/v1/squads/:squadId/fitness-targets", () =>
        new HttpResponse("<html>broken", {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const failure = await getSquadTargets("squad-1").catch((error: unknown) => error);
    expect((failure as ApiError).message).toBe("Polaris request failed (500)");
  });
});

describe("loadCatalog", () => {
  const commerce = tribeFixture({ id: "tribe-commerce", data: { name: "Commerce" } });
  const platform = tribeFixture({ id: "tribe-platform", data: { name: "Platform" } });
  const checkout = squadFixture({
    id: "squad-checkout",
    parentId: "tribe-commerce",
    data: { name: "Checkout" },
  });
  const identity = squadFixture({
    id: "squad-identity",
    parentId: "tribe-platform",
    data: { name: "Identity" },
  });
  const availability = fitnessFunction({ id: "fn-availability", ownerSquadId: "squad-checkout" });
  const latency = fitnessFunction({ id: "fn-latency", ownerSquadId: "squad-identity" });

  function useCatalogStack() {
    const squadsRequests: string[] = [];
    const functionsRequests: string[] = [];
    server.use(
      http.get("*/api/v1/tribes", () => HttpResponse.json(page([commerce, platform]))),
      http.get("*/api/v1/tribes/:tribeId/squads", ({ params, request }) => {
        squadsRequests.push(String(params.tribeId));
        void request;
        const items =
          params.tribeId === "tribe-commerce" ? [checkout] : [identity];
        return HttpResponse.json(page(items));
      }),
      http.get("*/api/v1/squads/:squadId/fitness-functions", ({ params }) => {
        functionsRequests.push(String(params.squadId));
        const items =
          params.squadId === "squad-checkout" ? [availability] : [latency];
        return HttpResponse.json(page(items));
      }),
    );
    return { squadsRequests, functionsRequests };
  }

  it("fans out across tribes, squads, and functions", async () => {
    useCatalogStack();

    const loaded = await loadCatalog();

    expect(loaded.tribes).toEqual([commerce, platform]);
    expect(loaded.squads).toEqual([
      { ...checkout, tribeId: "tribe-commerce", tribeName: "Commerce" },
      { ...identity, tribeId: "tribe-platform", tribeName: "Platform" },
    ]);
    expect(loaded.functions.map((item) => item.id)).toEqual(["fn-availability", "fn-latency"]);
  });

  it("labels squads under unnamed tribes as Unnamed tribe", async () => {
    const unnamed = tribeFixture({ id: "tribe-x", data: {} });
    server.use(
      http.get("*/api/v1/tribes", () => HttpResponse.json(page([unnamed]))),
      http.get("*/api/v1/tribes/:tribeId/squads", () =>
        HttpResponse.json(page([squadFixture({ id: "squad-x", parentId: "tribe-x" })])),
      ),
      http.get("*/api/v1/squads/:squadId/fitness-functions", () => HttpResponse.json(page([]))),
    );

    const loaded = await loadCatalog();

    expect(loaded.squads[0].tribeName).toBe("Unnamed tribe");
    expect(loaded.functions).toEqual([]);
  });

  it("returns an empty catalog without follow-up requests when no tribes exist", async () => {
    const { squadsRequests, functionsRequests } = useCatalogStack();
    server.use(http.get("*/api/v1/tribes", () => HttpResponse.json(page([]))));

    const loaded = await loadCatalog();

    expect(loaded).toEqual({ tribes: [], squads: [], functions: [] });
    expect(squadsRequests).toEqual([]);
    expect(functionsRequests).toEqual([]);
  });

  it("URL-encodes identifiers in nested paths", async () => {
    const squadsCapture = useCapture("*/api/v1/tribes/:tribeId/squads", page([]));
    server.use(http.get("*/api/v1/tribes", () => HttpResponse.json(page([tribeFixture({ id: "tribe one" })]))));
    await loadCatalog();
    expect(squadsCapture.only().path).toBe("/api/v1/tribes/tribe%20one/squads");
  });
});

describe("endpoints", () => {
  it("requests squad sources from the measurement-sources collection", async () => {
    const captured = useCapture(
      "*/api/v1/squads/:squadId/measurement-sources",
      page([resourceRecord({ id: "source-1", kind: "measurement-source" })]),
    );

    await getSquadSources("squad-1");

    const request = captured.only();
    expect(request.method).toBe("GET");
    expect(request.path).toBe("/api/v1/squads/squad-1/measurement-sources");
    expect(request.query.get("limit")).toBe("200");
  });

  it("creates fitness functions with a JSON body", async () => {
    const definition = pullDefinition();
    const created = fitnessFunction({ id: "fn-new" });
    const captured = useCapture("*/api/v1/squads/:squadId/fitness-functions", created);

    await expect(createFitnessFunction("squad-1", definition)).resolves.toEqual(created);

    const request = captured.only();
    expect(request.method).toBe("POST");
    expect(request.headers.get("Content-Type")).toBe("application/json");
    expect(request.body).toEqual(definition);
  });

  it("activates a fitness function version with a rationale", async () => {
    const activated = fitnessFunction({ id: "fn-1", activeVersion: 1 });
    const captured = useCapture(
      "*/api/v1/fitness-functions/:id/versions/:version/activations",
      activated,
    );

    await activateFitnessFunction("fn-1", 1);

    const request = captured.only();
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/api/v1/fitness-functions/fn-1/versions/1/activations");
    expect(request.body).toEqual({ rationale: "Activated from Polaris Control Tower" });
  });

  it("creates tribes with name and description", async () => {
    const created = tribeFixture({ id: "tribe-new" });
    const captured = useCapture("*/api/v1/tribes", created);

    await createTribe({ name: "Commerce", description: "Trading" });

    const request = captured.only();
    expect(request.method).toBe("POST");
    expect(request.body).toEqual({ name: "Commerce", description: "Trading" });
  });

  it("creates squads under a tribe", async () => {
    const created = squadFixture({ id: "squad-new" });
    const captured = useCapture("*/api/v1/tribes/:tribeId/squads", created);

    await createSquad("tribe-1", { name: "Checkout", mission: "Fast checkout" });

    const request = captured.only();
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/api/v1/tribes/tribe-1/squads");
    expect(request.body).toEqual({ name: "Checkout", mission: "Fast checkout" });
  });

  it("creates fitness targets under a squad", async () => {
    const created = resourceRecord({ id: "target-new", kind: "fitness-target" });
    const captured = useCapture("*/api/v1/squads/:squadId/fitness-targets", created);

    await createFitnessTarget("squad-1", { name: "Orders API", kind: "SERVICE" });

    const request = captured.only();
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/api/v1/squads/squad-1/fitness-targets");
    expect(request.body).toEqual({ name: "Orders API", kind: "SERVICE" });
  });

  it("follows pagination cursors until a page has no next cursor", async () => {
    const first = resourceRecord({ id: "target-1" });
    const second = resourceRecord({ id: "target-2" });
    const queries: string[] = [];
    server.use(
      http.get("*/api/v1/squads/:squadId/fitness-targets", ({ request }) => {
        const url = new URL(request.url);
        queries.push(url.search);
        if (url.searchParams.get("cursor") === null) {
          return HttpResponse.json(page([first], "cursor-1"));
        }
        return HttpResponse.json(page([second]));
      }),
    );

    const result = await getSquadTargets("squad-1");

    expect(result.items).toEqual([first, second]);
    expect(queries).toEqual(["?limit=200", "?limit=200&cursor=cursor-1"]);
  });

  it("rejects collections that never stop paginating", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/fitness-targets", () =>
        HttpResponse.json(page([resourceRecord()], "loop-forever")),
      ),
    );

    await expect(getSquadTargets("squad-1")).rejects.toThrow(
      "exceeded 100 pages",
    );
  });

  it("creates versions guarded by If-Match revisions", async () => {
    const definition = pullDefinition();
    const versioned = fitnessFunction({ id: "fn-1", revision: 3, activeVersion: 2 });
    const captured = useCapture("*/api/v1/fitness-functions/:id/versions", versioned);

    await expect(createFitnessFunctionVersion("fn-1", 3, definition)).resolves.toEqual(versioned);

    const request = captured.only();
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/api/v1/fitness-functions/fn-1/versions");
    expect(request.headers.get("If-Match")).toBe('"3"');
    expect(request.body).toEqual(definition);
  });
});

describe("fitness target lifecycle + history", () => {
  it("transitions a target's lifecycle with an optional reason", async () => {
    const transitioned = resourceRecord({ id: "target-1", status: "DEPRECATED" });
    const captured = useCapture("*/api/v1/fitness-targets/:targetId/lifecycle-transitions", transitioned);

    await expect(transitionFitnessTarget("target-1", "DEPRECATED", "Replacement available")).resolves.toEqual(
      transitioned,
    );

    const request = captured.only();
    expect(request.method).toBe("POST");
    expect(request.body).toEqual({ status: "DEPRECATED", reason: "Replacement available" });
  });

  it("omits the reason field when none is given", async () => {
    const captured = useCapture(
      "*/api/v1/fitness-targets/:targetId/lifecycle-transitions",
      resourceRecord({ id: "target-1", status: "RETIRED" }),
    );

    await transitionFitnessTarget("target-1", "RETIRED");

    expect(captured.only().body).toEqual({ status: "RETIRED" });
  });

  it("paginates through a target's fitness history", async () => {
    const entry = resourceRecord({ id: "history-1", kind: "fitness-history" });
    useCapture("*/api/v1/fitness-targets/:targetId/fitness-history", page([entry]));

    await expect(getFitnessTargetHistory("target-1")).resolves.toEqual([entry]);
  });
});

describe("evaluations and evaluation requests", () => {
  it("lists evaluations for a fitness function", async () => {
    const recorded = evaluation({ evaluationId: "evaluation-9" });
    const captured = useCapture("*/api/v1/fitness-functions/:id/evaluations", page([recorded]));

    await expect(listEvaluations("fn-1")).resolves.toEqual([recorded]);
    expect(captured.only().path).toBe("/api/v1/fitness-functions/fn-1/evaluations");
  });

  it("gets a single evaluation", async () => {
    const recorded = evaluation({ evaluationId: "evaluation-9" });
    useCapture("*/api/v1/evaluations/:evaluationId", recorded);

    await expect(getEvaluation("evaluation-9")).resolves.toEqual(recorded);
  });

  it("creates an evaluation request with an empty body", async () => {
    const created = evaluationRequest({ id: "request-9" });
    const captured = useCapture("*/api/v1/fitness-functions/:id/evaluation-requests", created);

    await expect(createEvaluationRequest("fn-1")).resolves.toEqual(created);
    const request = captured.only();
    expect(request.method).toBe("POST");
    expect(request.body).toEqual({});
  });

  it("gets and cancels an evaluation request", async () => {
    const pending = evaluationRequest({ id: "request-9", status: "PENDING" });
    const cancelled = evaluationRequest({ id: "request-9", status: "CANCELLED" });
    useCapture("*/api/v1/evaluation-requests/:requestId", pending);
    await expect(getEvaluationRequest("request-9")).resolves.toEqual(pending);

    const captured = useCapture("*/api/v1/evaluation-requests/:requestId/cancellations", cancelled);
    await expect(cancelEvaluationRequest("request-9")).resolves.toEqual(cancelled);
    expect(captured.only().method).toBe("POST");
  });
});

describe("collection attempts", () => {
  it("lists collection attempts for a fitness function", async () => {
    const attempt = collectionAttempt({ id: "attempt-9" });
    useCapture("*/api/v1/fitness-functions/:id/collection-attempts", page([attempt]));

    await expect(listCollectionAttempts("fn-1")).resolves.toEqual([attempt]);
  });

  it("gets a single collection attempt", async () => {
    const attempt = collectionAttempt({ id: "attempt-9" });
    useCapture("*/api/v1/collection-attempts/:attemptId", attempt);

    await expect(getCollectionAttempt("attempt-9")).resolves.toEqual(attempt);
  });

  it("triggers an on-demand collection", async () => {
    const recorded = evaluation();
    const captured = useCapture("*/api/v1/fitness-functions/:id/collection-attempts", recorded);

    await expect(collectNow("fn-1")).resolves.toEqual(recorded);
    expect(captured.only().method).toBe("POST");
  });

  it("retries a failed collection attempt", async () => {
    const recorded = evaluation();
    const captured = useCapture("*/api/v1/collection-attempts/:attemptId/retries", recorded);

    await expect(retryCollectionAttempt("attempt-9")).resolves.toEqual(recorded);
    expect(captured.only().method).toBe("POST");
  });
});

describe("waivers", () => {
  it("proposes a waiver with the given data", async () => {
    const proposed = waiver({ id: "waiver-9" });
    const captured = useCapture("*/api/v1/fitness-functions/:id/waivers", proposed);

    await expect(
      createWaiver("fn-1", { reason: "Infra replacement", expiresAt: "2026-08-01T10:00:00Z" }),
    ).resolves.toEqual(proposed);
    expect(captured.only().body).toEqual({ reason: "Infra replacement", expiresAt: "2026-08-01T10:00:00Z" });
  });

  it("transitions a waiver with an optional reason", async () => {
    const approved = waiver({ id: "waiver-9", status: "APPROVED" });
    const captured = useCapture("*/api/v1/waivers/:waiverId/:transition", approved);

    await expect(transitionWaiver("waiver-9", "approvals", "Risk accepted")).resolves.toEqual(approved);
    const request = captured.only();
    expect(request.path).toBe("/api/v1/waivers/waiver-9/approvals");
    expect(request.body).toEqual({ reason: "Risk accepted" });
  });

  it("omits the reason field when transitioning without one", async () => {
    const captured = useCapture("*/api/v1/waivers/:waiverId/:transition", waiver({ status: "REJECTED" }));

    await transitionWaiver("waiver-9", "rejections");

    expect(captured.only().body).toEqual({});
  });
});

describe("fitness function templates", () => {
  it("lists a tribe's templates", async () => {
    const template = resourceRecord({ id: "template-1", kind: "fitness-function-template", data: { name: "Resilience baseline" } });
    useCapture("*/api/v1/tribes/:tribeId/fitness-function-templates", page([template]));

    await expect(listFitnessFunctionTemplates("tribe-1")).resolves.toEqual([template]);
  });

  it("publishes a new template", async () => {
    const created = resourceRecord({ id: "template-new", kind: "fitness-function-template" });
    const captured = useCapture("*/api/v1/tribes/:tribeId/fitness-function-templates", created);

    await createFitnessFunctionTemplate("tribe-1", { name: "Resilience baseline" });
    expect(captured.only().body).toEqual({ name: "Resilience baseline" });
  });

  it("adopts a template into a squad", async () => {
    const adoption = resourceRecord({ id: "adoption-1", kind: "template-adoption" });
    const captured = useCapture("*/api/v1/fitness-function-templates/:templateId/adoptions", adoption);

    await adoptFitnessFunctionTemplate("template-1", { squadId: "squad-1" });
    expect(captured.only().body).toEqual({ squadId: "squad-1" });
  });
});

describe("fitness overview", () => {
  it("gets a squad overview", async () => {
    const overview = { scope: "squad" as const, scopeId: "squad-1", generatedAt: "2026-08-01T10:00:00Z", status: "AVAILABLE" as const };
    useCapture("*/api/v1/squads/:squadId/fitness-overview", overview);

    await expect(getSquadFitnessOverview("squad-1")).resolves.toEqual(overview);
  });

  it("gets a tribe overview", async () => {
    const overview = { scope: "tribe" as const, scopeId: "tribe-1", generatedAt: "2026-08-01T10:00:00Z", status: "AVAILABLE" as const };
    useCapture("*/api/v1/tribes/:tribeId/fitness-overview", overview);

    await expect(getTribeFitnessOverview("tribe-1")).resolves.toEqual(overview);
  });
});
