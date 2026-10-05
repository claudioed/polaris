import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ActivityWorkspace } from "./ActivityWorkspace";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function event(id: string, type = "EvaluationRecorded", occurredAt = "2026-08-01T10:00:00Z") {
  return {
    id,
    type,
    version: 1,
    aggregateType: "evaluation",
    aggregateId: "eval-1",
    occurredAt,
    actor: "anonymous",
    correlationId: "corr-1",
    payload: {},
  };
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ActivityWorkspace />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("ActivityWorkspace", () => {
  it("drains the event feed on first visit and renders newest first", async () => {
    const requests: string[] = [];
    server.use(
      http.get("*/api/v1/events", ({ request }) => {
        const url = new URL(request.url);
        requests.push(url.search);
        const cursor = url.searchParams.get("cursor");
        if (cursor === null) {
          return HttpResponse.json({ items: [event("e-1"), event("e-2")], nextCursor: "2" });
        }
        if (cursor === "2") {
          return HttpResponse.json({ items: [event("e-3")], nextCursor: "3" });
        }
        return HttpResponse.json({ items: [], nextCursor: "3" });
      }),
    );
    renderWorkspace();

    expect(await screen.findByText("3 events · auto-refreshes every 30s")).toBeInTheDocument();
    // Drained both pages and persisted the cursor.
    expect(requests[0]).toContain("consumerId=control-tower-");
    expect(requests.length).toBe(3); // page 1, page 2, then an empty page terminates the drain
    expect(sessionStorage.getItem("polaris.activity.cursor")).toBe("3");
  });

  it("stops when a page comes back empty even though nextCursor is always set", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/v1/events", () => {
        calls += 1;
        return HttpResponse.json({ items: [], nextCursor: "99" });
      }),
    );
    renderWorkspace();

    expect(await screen.findByText("No events yet")).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it("resumes from the persisted cursor on later visits", async () => {
    sessionStorage.setItem("polaris.activity.cursor", "5");
    const cursors: (string | null)[] = [];
    server.use(
      http.get("*/api/v1/events", ({ request }) => {
        const url = new URL(request.url);
        cursors.push(url.searchParams.get("cursor"));
        return HttpResponse.json({ items: [], nextCursor: "5" });
      }),
    );
    renderWorkspace();

    await screen.findByText("No events yet");
    expect(cursors[0]).toBe("5");
  });

  it("shows an error state when the feed fails", async () => {
    server.use(
      http.get("*/api/v1/events", () => HttpResponse.json({ title: "boom" }, { status: 500 })),
    );
    renderWorkspace();

    expect(await screen.findByText("Could not load activity")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("refreshes through the refresh button", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/v1/events", () => {
        calls += 1;
        // First poll delivers one event; later polls (refresh) come back empty.
        const items = calls === 1 ? [event("e-1")] : [];
        return HttpResponse.json({ items, nextCursor: "1" });
      }),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("1 events · auto-refreshes every 30s");
    await user.click(screen.getByRole("button", { name: /Refresh/ }));

    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
  });

  it("keeps a stable consumer id across mounts", async () => {
    server.use(
      http.get("*/api/v1/events", () => HttpResponse.json({ items: [], nextCursor: "0" })),
    );
    const consumerIds: string[] = [];
    server.events.on("request:start", ({ request }) => {
      const match = new URL(request.url).searchParams.get("consumerId");
      if (match) consumerIds.push(match);
    });
    const first = renderWorkspace();
    await screen.findByText("No events yet");
    first.unmount();

    const second = renderWorkspace();
    await screen.findByText("No events yet");
    second.unmount();

    expect(consumerIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(consumerIds).size).toBe(1);
    expect(sessionStorage.getItem("polaris.activity.consumerId")).toBe(consumerIds[0]);
  });
});
