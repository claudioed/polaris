import { describe, expect, it, vi } from "vitest";
import type { Catalog, FitnessFunction } from "./types";
import { activeDefinition, initials, matchesQuery, relativeTime } from "./utils";

const fn: FitnessFunction = {
  id: "function-1",
  ownerSquadId: "squad-1",
  lifecycle: "ACTIVE",
  revision: 2,
  activeVersion: 1,
  versions: [
    {
      number: 1,
      state: "ACTIVE",
      createdAt: "2026-07-20T10:00:00Z",
      activatedAt: "2026-07-21T10:00:00Z",
      definition: {
        name: "Checkout availability",
        purpose: "Protect revenue",
        objective: "Checkout remains available",
        characteristic: "Reliability",
        targetIds: ["target-1"],
        criteria: [],
        acquisition: {
          mode: "PULL",
          sourceId: "source-1",
          trigger: "ON_DEMAND",
          timeoutSeconds: 10,
          queries: [],
        },
        freshnessSeconds: 300,
        enforcement: "BLOCK",
      },
    },
  ],
};

const catalog: Catalog = {
  tribes: [],
  squads: [
    {
      id: "squad-1",
      parentId: "tribe-1",
      tribeId: "tribe-1",
      tribeName: "Commerce",
      kind: "squad",
      status: "ACTIVE",
      revision: 1,
      data: { name: "Checkout" },
      createdAt: "",
      updatedAt: "",
    },
  ],
  functions: [fn],
};

describe("fitness catalog utilities", () => {
  it("selects the active definition", () => {
    expect(activeDefinition(fn)?.name).toBe("Checkout availability");
  });

  it("searches across definition and ownership terms", () => {
    expect(matchesQuery(fn, catalog, "checkout reliability")).toBe(true);
    expect(matchesQuery(fn, catalog, "commerce block")).toBe(true);
    expect(matchesQuery(fn, catalog, "security")).toBe(false);
  });

  it("formats initials and relative dates", () => {
    expect(initials("Performance efficiency")).toBe("PE");
    vi.setSystemTime(new Date("2026-07-25T10:00:00Z"));
    expect(relativeTime("2026-07-24T10:00:00Z")).toBe("Yesterday");
    expect(relativeTime()).toBe("Not activated");
  });
});
