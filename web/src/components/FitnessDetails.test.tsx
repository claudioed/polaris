import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { FitnessDetails } from "./FitnessDetails";
import {
  catalog,
  collectionAttempt,
  criterion,
  evaluation,
  evaluationRequest,
  fitnessFunction,
  fitnessVersion,
  page,
  pullDefinition,
  pushDefinition,
  squad,
  waiver,
} from "../test/fixtures";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderWithQuery(item: ReturnType<typeof fitnessFunction> = fitnessFunction()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FitnessDetails item={item} catalog={catalog()} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("FitnessDetails", () => {
  it("renders the active definition, lifecycle, and owning squad", () => {
    render(
      <FitnessDetails
        item={fitnessFunction()}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Checkout availability" })).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("Checkout · Commerce")).toBeInTheDocument();
    expect(screen.getByText("Remain available for customers at all times.")).toBeInTheDocument();
  });

  it("renders enforcement, acquisition, freshness, and activation metrics", () => {
    render(
      <FitnessDetails
        item={fitnessFunction({
          activeVersion: 2,
          versions: [
            fitnessVersion({ number: 1, state: "SUPERSEDED", definition: pushDefinition() }),
            fitnessVersion({
              number: 2,
              definition: pullDefinition({
                name: "Latency budget",
                enforcement: "BLOCK",
                freshnessSeconds: 1800,
              }),
            }),
          ],
        })}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("BLOCK")).toBeInTheDocument();
    expect(screen.getByText("PULL")).toBeInTheDocument();
    expect(screen.getByText("30 min")).toBeInTheDocument();
  });

  it("reports Not activated when the active version was never activated", () => {
    render(
      <FitnessDetails
        item={fitnessFunction({
          versions: [fitnessVersion({ activatedAt: undefined })],
        })}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Not activated")).toBeInTheDocument();
  });

  it("renders criterion cards with comparison labels and warnings", () => {
    render(
      <FitnessDetails
        item={fitnessFunction({
          versions: [
            fitnessVersion({
              definition: pushDefinition({
                criteria: [
                  criterion({
                    key: "p95_latency",
                    unit: "ms",
                    failureComparison: "GREATER_THAN_OR_EQUAL",
                    failureValue: 250,
                    warningValue: 150,
                  }),
                ],
              }),
            }),
          ],
        })}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("p95_latency")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByText("≥ 250 ms")).toBeInTheDocument();
    expect(screen.getByText("Warning at 150 ms")).toBeInTheDocument();
  });

  it("renders the definition history newest first", () => {
    render(
      <FitnessDetails
        item={fitnessFunction({
          versions: [
            fitnessVersion({ number: 1, state: "SUPERSEDED" }),
            fitnessVersion({ number: 2, state: "ACTIVE" }),
          ],
          activeVersion: 2,
        })}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("2 versions")).toBeInTheDocument();
    const rows = screen.getAllByText(/^Version \d$/);
    expect(rows.map((row) => row.textContent)).toEqual(["Version 2", "Version 1"]);
  });

  it("shows protected targets as truncated tags and links to the API resource", () => {
    render(
      <FitnessDetails
        item={fitnessFunction()}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("target-1".slice(0, 8))).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Open API resource/ });
    expect(link).toHaveAttribute("href", "/api/v1/fitness-functions/fn-1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("falls back to Unknown squad when the owner squad is not in the catalog", () => {
    render(
      <FitnessDetails
        item={fitnessFunction({ ownerSquadId: "squad-gone" })}
        catalog={catalog({ squads: [squad({ id: "squad-other" })] })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Unknown squad/)).toBeInTheDocument();
  });

  it("renders nothing when the function has no definition", () => {
    const { container } = render(
      <FitnessDetails
        item={fitnessFunction({ versions: [] })}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("falls back to the raw comparison label for unknown comparisons", () => {
    render(
      <FitnessDetails
        item={fitnessFunction({
          versions: [
            fitnessVersion({
              definition: pushDefinition({
                criteria: [
                  criterion({ failureComparison: "WITHIN", failureValue: 10 }),
                  criterion({ key: "p95_latency", unit: "ms", failureValue: 250 }),
                ],
              }),
            }),
          ],
        })}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("WITHIN 10 percent")).toBeInTheDocument();
    expect(screen.getByText("2 criteria")).toBeInTheDocument();
  });

  it("closes through the close button", async () => {
    const onClose = vi.fn();
    render(
      <FitnessDetails item={fitnessFunction()} catalog={catalog()} onClose={onClose} />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Close details" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("FitnessDetails evaluations tab", () => {
  it("lists recorded evaluations and lets a new one be requested", async () => {
    server.use(
      http.get("*/api/v1/fitness-functions/:id/evaluations", () =>
        HttpResponse.json(page([evaluation({ evaluationId: "evaluation-1", outcome: "WARN", disposition: "ATTENTION_REQUIRED" })])),
      ),
      http.post("*/api/v1/fitness-functions/:id/evaluation-requests", () =>
        HttpResponse.json(evaluationRequest({ id: "request-1" }), { status: 202 }),
      ),
    );
    renderWithQuery();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Evaluations" }));

    expect(await screen.findByText("WARN")).toBeInTheDocument();
    expect(screen.getByText("ATTENTION_REQUIRED")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Request evaluation" }));

    expect(await screen.findByText("PENDING")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByText("Checkout availability")).toBeInTheDocument();
  });

  it("refreshes a pending request until it is fulfilled", async () => {
    server.use(
      http.get("*/api/v1/fitness-functions/:id/evaluations", () => HttpResponse.json(page([]))),
      http.post("*/api/v1/fitness-functions/:id/evaluation-requests", () =>
        HttpResponse.json(evaluationRequest({ id: "request-1" }), { status: 202 }),
      ),
      http.get("*/api/v1/evaluation-requests/:requestId", () =>
        HttpResponse.json(evaluationRequest({ id: "request-1", status: "CANCELLED" })),
      ),
    );
    renderWithQuery();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Evaluations" }));
    await screen.findByText("No evaluations recorded yet.");
    await user.click(screen.getByRole("button", { name: "Request evaluation" }));
    await screen.findByText("PENDING");

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("CANCELLED")).toBeInTheDocument();
  });

  it("surfaces an error when the evaluation list fails to load", async () => {
    server.use(
      http.get("*/api/v1/fitness-functions/:id/evaluations", () =>
        HttpResponse.json({ title: "Server error" }, { status: 500 }),
      ),
    );
    renderWithQuery();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Evaluations" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server error");
  });

  it("surfaces an error when refreshing a request fails", async () => {
    server.use(
      http.get("*/api/v1/fitness-functions/:id/evaluations", () => HttpResponse.json(page([]))),
      http.post("*/api/v1/fitness-functions/:id/evaluation-requests", () =>
        HttpResponse.json(evaluationRequest({ id: "request-1" }), { status: 202 }),
      ),
      http.get("*/api/v1/evaluation-requests/:requestId", () =>
        HttpResponse.json({ title: "Not found" }, { status: 404 }),
      ),
    );
    renderWithQuery();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Evaluations" }));
    await screen.findByText("No evaluations recorded yet.");
    await user.click(screen.getByRole("button", { name: "Request evaluation" }));
    await screen.findByText("PENDING");

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not found");
  });

  it("surfaces an error when cancelling a request fails", async () => {
    server.use(
      http.get("*/api/v1/fitness-functions/:id/evaluations", () => HttpResponse.json(page([]))),
      http.post("*/api/v1/fitness-functions/:id/evaluation-requests", () =>
        HttpResponse.json(evaluationRequest({ id: "request-1" }), { status: 202 }),
      ),
      http.post("*/api/v1/evaluation-requests/:requestId/cancellations", () =>
        HttpResponse.json({ title: "Conflict" }, { status: 409 }),
      ),
    );
    renderWithQuery();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Evaluations" }));
    await screen.findByText("No evaluations recorded yet.");
    await user.click(screen.getByRole("button", { name: "Request evaluation" }));
    await screen.findByText("PENDING");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Conflict");
  });

  it("cancels a pending evaluation request", async () => {
    server.use(
      http.get("*/api/v1/fitness-functions/:id/evaluations", () => HttpResponse.json(page([]))),
      http.post("*/api/v1/fitness-functions/:id/evaluation-requests", () =>
        HttpResponse.json(evaluationRequest({ id: "request-1" }), { status: 202 }),
      ),
      http.post("*/api/v1/evaluation-requests/:requestId/cancellations", () =>
        HttpResponse.json(evaluationRequest({ id: "request-1", status: "CANCELLED" })),
      ),
    );
    renderWithQuery();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Evaluations" }));
    await screen.findByText("No evaluations recorded yet.");
    await user.click(screen.getByRole("button", { name: "Request evaluation" }));
    await screen.findByText("PENDING");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("CANCELLED")).toBeInTheDocument();
  });

  it("surfaces an error when requesting an evaluation fails", async () => {
    server.use(
      http.get("*/api/v1/fitness-functions/:id/evaluations", () => HttpResponse.json(page([]))),
      http.post("*/api/v1/fitness-functions/:id/evaluation-requests", () =>
        HttpResponse.json({ title: "Bad request", detail: "Already pending" }, { status: 400 }),
      ),
    );
    renderWithQuery();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Evaluations" }));
    await screen.findByText("No evaluations recorded yet.");
    await user.click(screen.getByRole("button", { name: "Request evaluation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Already pending");
  });
});

describe("FitnessDetails collection tab", () => {
  it("only offers the Collection tab for PULL-acquired functions", () => {
    renderWithQuery(fitnessFunction({ versions: [fitnessVersion({ definition: pushDefinition() })] }));
    expect(screen.queryByRole("tab", { name: "Collection" })).not.toBeInTheDocument();
  });

  it("lists attempts, triggers a collection, and retries a failed one", async () => {
    const item = fitnessFunction({ versions: [fitnessVersion({ definition: pullDefinition() })] });
    server.use(
      http.get("*/api/v1/fitness-functions/:id/collection-attempts", () =>
        HttpResponse.json(page([collectionAttempt({ id: "attempt-1", status: "FAILED" })])),
      ),
      http.post("*/api/v1/fitness-functions/:id/collection-attempts", () =>
        HttpResponse.json(evaluation(), { status: 202 }),
      ),
      http.post("*/api/v1/collection-attempts/:attemptId/retries", () =>
        HttpResponse.json(evaluation(), { status: 202 }),
      ),
    );
    renderWithQuery(item);
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Collection" }));

    expect(await screen.findByText("FAILED")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(screen.getByRole("button", { name: "Collect now" }));
  });

  it("surfaces an error when the collection attempt list fails to load", async () => {
    const item = fitnessFunction({ versions: [fitnessVersion({ definition: pullDefinition() })] });
    server.use(
      http.get("*/api/v1/fitness-functions/:id/collection-attempts", () =>
        HttpResponse.json({ title: "Server error" }, { status: 500 }),
      ),
    );
    renderWithQuery(item);
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Collection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server error");
  });

  it("surfaces an error when collect-now fails", async () => {
    const item = fitnessFunction({ versions: [fitnessVersion({ definition: pullDefinition() })] });
    server.use(
      http.get("*/api/v1/fitness-functions/:id/collection-attempts", () => HttpResponse.json(page([]))),
      http.post("*/api/v1/fitness-functions/:id/collection-attempts", () =>
        HttpResponse.json({ title: "Conflict" }, { status: 409 }),
      ),
    );
    renderWithQuery(item);
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Collection" }));
    await screen.findByText("No collection attempts recorded yet.");
    await user.click(screen.getByRole("button", { name: "Collect now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Conflict");
  });
});

describe("FitnessDetails waivers tab", () => {
  it("proposes a waiver and walks it through approval", async () => {
    server.use(
      http.post("*/api/v1/fitness-functions/:id/waivers", () =>
        HttpResponse.json(waiver({ id: "waiver-1", status: "PROPOSED" }), { status: 201 }),
      ),
      http.post("*/api/v1/waivers/:waiverId/:transition", () =>
        HttpResponse.json(waiver({ id: "waiver-1", status: "APPROVED" }), { status: 201 }),
      ),
    );
    renderWithQuery();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Waivers" }));
    await screen.findByText(/doesn't expose a waiver list endpoint/);
    await user.click(screen.getByRole("button", { name: "Propose waiver" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Infra replacement window");
    await user.type(within(dialog).getByLabelText("Expires at"), "2026-08-01T10:00");
    await user.click(within(dialog).getByRole("button", { name: "Propose waiver" }));

    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByText("APPROVED")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Revoke" })).toBeInTheDocument();
  });

  it("requires a reason and an expiry before proposing", async () => {
    renderWithQuery();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Waivers" }));
    await user.click(screen.getByRole("button", { name: "Propose waiver" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Propose waiver" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a reason.");

    await user.type(within(dialog).getByLabelText("Reason"), "Infra replacement window");
    await user.click(within(dialog).getByRole("button", { name: "Propose waiver" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose when the waiver expires.");
  });

  it("rejects a proposed waiver and reports a failed decision", async () => {
    server.use(
      http.post("*/api/v1/fitness-functions/:id/waivers", () =>
        HttpResponse.json(waiver({ id: "waiver-1", status: "PROPOSED" }), { status: 201 }),
      ),
      http.post("*/api/v1/waivers/:waiverId/:transition", () =>
        HttpResponse.json({ title: "Conflict" }, { status: 409 }),
      ),
    );
    renderWithQuery();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Waivers" }));
    await user.click(screen.getByRole("button", { name: "Propose waiver" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Infra replacement window");
    await user.type(within(dialog).getByLabelText("Risk"), "Delayed checkout recovery");
    await user.type(within(dialog).getByLabelText("Compensating action"), "Manual failover runbook");
    await user.type(within(dialog).getByLabelText("Expires at"), "2026-08-01T10:00");
    await user.click(within(dialog).getByRole("button", { name: "Propose waiver" }));

    await screen.findByRole("button", { name: "Reject" });
    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Conflict");
  });

  it("closes the propose-waiver dialog from the close icon", async () => {
    renderWithQuery();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Waivers" }));
    await user.click(screen.getByRole("button", { name: "Propose waiver" }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
