import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { OverviewWorkspace } from "./OverviewWorkspace";
import {
  catalog,
  fitnessFunction,
  fitnessVersion,
  pullDefinition,
  pushDefinition,
  squad as squadFixture,
  tribe as tribeFixture,
} from "../test/fixtures";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderWorkspace(overrides?: Parameters<typeof catalog>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OverviewWorkspace catalog={catalog(overrides)} />
    </QueryClientProvider>,
  );
}

describe("OverviewWorkspace", () => {
  it("shows empty states when there are no squads or tribes", () => {
    renderWorkspace({ squads: [], tribes: [], functions: [] });
    expect(screen.getByText("No squads yet.")).toBeInTheDocument();
    expect(screen.getByText("No tribes yet.")).toBeInTheDocument();
  });

  it("computes per-squad counts from the catalog and shows freshness", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/fitness-overview", () =>
        HttpResponse.json({ scope: "squad", scopeId: "squad-1", generatedAt: "2026-08-01T10:00:00Z", status: "AVAILABLE" }),
      ),
      http.get("*/api/v1/tribes/:tribeId/fitness-overview", () =>
        HttpResponse.json({ scope: "tribe", scopeId: "tribe-1", generatedAt: "2026-08-01T10:00:00Z", status: "AVAILABLE" }),
      ),
    );
    renderWorkspace({
      functions: [
        fitnessFunction({ id: "fn-active-block", lifecycle: "ACTIVE", versions: [fitnessVersion({ definition: pushDefinition({ enforcement: "BLOCK" }) })] }),
        fitnessFunction({ id: "fn-draft-pull", lifecycle: "DRAFT", versions: [fitnessVersion({ definition: pullDefinition() })] }),
      ],
    });

    expect(await screen.findByText("Checkout")).toBeInTheDocument();
    const squadCard = screen.getByText("Checkout").closest("article");
    expect(squadCard).not.toBeNull();
    const withinSquad = within(squadCard as HTMLElement);
    const activeLabel = withinSquad.getByText("Active");
    expect(activeLabel.nextElementSibling).toHaveTextContent("1");
    const draftLabel = withinSquad.getByText("Draft");
    expect(draftLabel.nextElementSibling).toHaveTextContent("1");

    expect(await screen.findByText(/Insights generated/)).toBeInTheDocument();
  });

  it("surfaces an error when the squad overview fails to load", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/fitness-overview", () =>
        HttpResponse.json({ title: "Server error" }, { status: 500 }),
      ),
      http.get("*/api/v1/tribes/:tribeId/fitness-overview", () =>
        HttpResponse.json({ scope: "tribe", scopeId: "tribe-1", generatedAt: "2026-08-01T10:00:00Z", status: "AVAILABLE" }),
      ),
    );
    renderWorkspace();

    expect(await screen.findByText("Server error")).toBeInTheDocument();
  });

  it("aggregates functions across every squad in a tribe", async () => {
    const platform = tribeFixture({ id: "tribe-platform", data: { name: "Platform" } });
    const identity = squadFixture({ id: "squad-identity", parentId: "tribe-platform", tribeId: "tribe-platform", tribeName: "Platform", data: { name: "Identity" } });
    server.use(
      http.get("*/api/v1/squads/:squadId/fitness-overview", () =>
        HttpResponse.json({ scope: "squad", scopeId: "squad-1", generatedAt: "2026-08-01T10:00:00Z", status: "AVAILABLE" }),
      ),
      http.get("*/api/v1/tribes/:tribeId/fitness-overview", () =>
        HttpResponse.json({ scope: "tribe", scopeId: "tribe-platform", generatedAt: "2026-08-01T10:00:00Z", status: "AVAILABLE" }),
      ),
    );
    renderWorkspace({
      tribes: [tribeFixture(), platform],
      squads: [squadFixture(), identity],
      functions: [
        fitnessFunction({ id: "fn-1", ownerSquadId: "squad-1" }),
        fitnessFunction({ id: "fn-2", ownerSquadId: "squad-identity" }),
      ],
    });

    expect(await screen.findByText("Platform", { selector: "strong" })).toBeInTheDocument();
    const tribeCard = screen.getByText("Platform", { selector: "strong" }).closest("article");
    expect(within(tribeCard as HTMLElement).getByText("1 squad")).toBeInTheDocument();
  });

  it("falls back to placeholder names when data has no name", () => {
    renderWorkspace({
      tribes: [tribeFixture({ data: {} })],
      squads: [squadFixture({ data: {} })],
      functions: [],
    });
    expect(screen.getByText("Unnamed squad")).toBeInTheDocument();
    expect(screen.getByText("Unnamed tribe")).toBeInTheDocument();
  });

  it("pluralizes the squad count for tribes with more than one squad", async () => {
    const second = squadFixture({ id: "squad-2", data: { name: "Fulfillment" } });
    server.use(
      http.get("*/api/v1/squads/:squadId/fitness-overview", () =>
        HttpResponse.json({ scope: "squad", scopeId: "squad-1", generatedAt: "2026-08-01T10:00:00Z", status: "AVAILABLE" }),
      ),
      http.get("*/api/v1/tribes/:tribeId/fitness-overview", () =>
        HttpResponse.json({ scope: "tribe", scopeId: "tribe-1", generatedAt: "2026-08-01T10:00:00Z", status: "AVAILABLE" }),
      ),
    );
    renderWorkspace({ squads: [squadFixture(), second], functions: [] });

    expect(
      await screen.findByText((_, element) => element?.tagName === "SMALL" && element.textContent === "2 squads"),
    ).toBeInTheDocument();
  });
});
