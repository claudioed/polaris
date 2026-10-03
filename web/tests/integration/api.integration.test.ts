import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FitnessDefinition } from "../../src/types";
import { INGEST_KEY, startStack, type Stack } from "./stack";

const suite = process.env.POLARIS_SKIP_INTEGRATION === "1" ? describe.skip : describe;

/**
 * Boots postgres (testcontainer), a fake OIDC issuer, and the real Go API —
 * then exercises the production control-tower client against it. Mirrors the
 * Go full-stack suite (tests/api_integration_test.go) from Node.
 */
suite("polaris full stack", () => {
  let stack: Stack | undefined;

  beforeAll(async () => {
    stack = await startStack();
  });

  afterAll(async () => {
    await stack?.stop();
  });

  it("serves anonymous health probes", async () => {
    for (const probe of ["live", "ready"]) {
      const response = await fetch(`${stack.baseUrl}/api/v1/health/${probe}`);
      expect(response.status).toBe(200);
    }
  });

  it("rejects malformed bearer tokens", async () => {
    const response = await fetch(`${stack.baseUrl}/api/v1/tribes`, {
      headers: { Authorization: "Bearer not-a-jwt" },
    });
    expect(response.status).toBe(401);
  });

  it("rejects expired tokens", async () => {
    const token = await stack.token({ expiresInSeconds: -60 });
    const response = await fetch(`${stack.baseUrl}/api/v1/tribes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(401);
  });

  it("rejects Google accounts outside the authorized email", async () => {
    const token = await stack.token({ sub: "intruder-1", email: "intruder@example.com" });
    const response = await fetch(`${stack.baseUrl}/api/v1/tribes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(403);
  });

  it("returns problem details for validation failures", async () => {
    const token = await stack.token();
    const response = await fetch(`${stack.baseUrl}/api/v1/tribes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(422);
    const problem = (await response.json()) as { status?: number; title?: string };
    expect(problem.status).toBe(422);
    expect(problem.title).toBeTruthy();
  });

  describe("control tower client against the real API", () => {
    let tribeId: string;
    let squadId: string;
    let producerId: string;
    let functionId: string;
    let functionRevision: number;
    let definition: FitnessDefinition;
    let api: typeof import("../../src/api");

    beforeAll(async () => {
      vi.stubEnv("VITE_API_BASE", `${stack.baseUrl}/api/v1`);
      vi.resetModules();
      sessionStorage.setItem("polaris.idToken", await stack.token());
      api = await import("../../src/api");
    });

    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it("drives the workspace golden path", async () => {
      const tribe = await api.createTribe({ name: "Commerce" });
      tribeId = tribe.id;
      expect(tribeId).toBeTruthy();

      const squad = await api.createSquad(tribeId, { name: "Checkout" });
      squadId = squad.id;
      expect(squadId).toBeTruthy();

      const target = await api.createFitnessTarget(squadId, {
        name: "checkout-api",
        kind: "SERVICE",
      });
      expect(target.id).toBeTruthy();

      const producerResponse = await fetch(
        `${stack.baseUrl}/api/v1/squads/${squadId}/measurement-producers`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sessionStorage.getItem("polaris.idToken")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: "ci-pipeline" }),
        },
      );
      expect(producerResponse.status).toBe(201);
      producerId = ((await producerResponse.json()) as { id: string }).id;

      definition = {
        name: "Checkout latency",
        purpose: "Protect the checkout journey from latency regressions.",
        objective: "Keep the p95 response time within the agreed budget.",
        targetIds: [target.id],
        criteria: [
          {
            key: "latency",
            unit: "ms",
            required: true,
            failureComparison: "GREATER_THAN",
            failureValue: 500,
          },
        ],
        acquisition: { mode: "PUSH", producerId, maximumObservationAgeSeconds: 600 },
        freshnessSeconds: 300,
        enforcement: "BLOCK",
      };
      const created = await api.createFitnessFunction(squadId, definition);
      functionId = created.id;
      expect(created.lifecycle).toBe("DRAFT");
      expect(created.versions[0]?.state).toBe("DRAFT");

      const activated = await api.activateFitnessFunction(functionId, 1);
      functionRevision = activated.revision;
      expect(activated.lifecycle).toBe("ACTIVE");
    });

    it("accepts keyed measurement submissions and replays duplicates", async () => {
      const submission = {
        producerId,
        externalRunId: "integration-run-1",
        fitnessFunctionVersion: 1,
        observedAt: new Date().toISOString(),
        measurements: [{ criterionKey: "latency", unit: "ms", value: 120 }],
      };
      const url = `${stack.baseUrl}/api/v1/fitness-functions/${functionId}/measurement-submissions`;
      const submit = (apiKey: string) =>
        fetch(url, {
          method: "POST",
          headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(submission),
        });

      const first = await submit(INGEST_KEY);
      expect(first.status).toBe(201);
      expect(((await first.json()) as { outcome: string }).outcome).toBe("PASS");

      const replay = await submit(INGEST_KEY);
      expect(replay.status).toBe(201);
      expect(((await replay.json()) as { replayed: boolean }).replayed).toBe(true);

      const rejected = await submit("wrong-key");
      expect(rejected.status).toBe(401);
    });

    it("collects every page when collections exceed the page limit", async () => {
      for (let index = 0; index < 60; index += 1) {
        await api.createTribe({ name: `Wave ${index}` });
      }

      const catalog = await api.loadCatalog();

      expect(catalog.tribes.length).toBeGreaterThanOrEqual(61);
      expect(catalog.squads).toHaveLength(1);
      expect(catalog.functions).toHaveLength(1);
    });

    it("guards version creation with If-Match and surfaces conflicts", async () => {
      const nextDefinition: FitnessDefinition = { ...definition, name: "Checkout latency v2" };

      const versioned = await api.createFitnessFunctionVersion(
        functionId,
        functionRevision,
        nextDefinition,
      );
      expect(versioned.versions).toHaveLength(2);

      await expect(
        api.createFitnessFunctionVersion(functionId, functionRevision, nextDefinition),
      ).rejects.toMatchObject({ status: 409 });
    });
  });
});
