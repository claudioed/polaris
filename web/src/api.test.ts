import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  ApiError,
  activateFitnessFunction,
  createFitnessFunction,
  createFitnessFunctionVersion,
  createFitnessTarget,
  createSquad,
  createTribe,
  getSquadSources,
  getSquadTargets,
  loadCatalog,
} from "./api";
import {
  fitnessFunction,
  page,
  problem,
  pullDefinition,
  resourceRecord,
  squad as squadFixture,
  tribe as tribeFixture,
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
