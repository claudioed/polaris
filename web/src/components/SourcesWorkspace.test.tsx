import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SourcesWorkspace } from "./SourcesWorkspace";
import { catalog, page, resourceRecord } from "../test/fixtures";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SourcesWorkspace catalog={catalog()} />
    </QueryClientProvider>,
  );
}

describe("SourcesWorkspace", () => {
  it("lists a squad's measurement sources", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-sources", () =>
        HttpResponse.json(
          page([
            resourceRecord({
              id: "source-1",
              kind: "measurement-source",
              status: "ACTIVE",
              data: { name: "prod-prometheus", providerType: "PROMETHEUS", baseUrl: "https://prom.internal" },
            }),
          ]),
        ),
      ),
    );
    renderWorkspace();

    expect(await screen.findByText("prod-prometheus")).toBeInTheDocument();
    expect(screen.getByText("PROMETHEUS")).toBeInTheDocument();
    expect(screen.getByText("https://prom.internal")).toBeInTheDocument();
  });

  it("creates a source, rejecting an invalid base URL first", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-sources", () => HttpResponse.json(page([]))),
      http.post("*/api/v1/squads/:squadId/measurement-sources", () =>
        HttpResponse.json(
          resourceRecord({ id: "source-new", kind: "measurement-source", status: "DRAFT", data: { name: "staging", providerType: "PROMETHEUS", baseUrl: "https://staging.internal" } }),
          { status: 201 },
        ),
      ),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("No measurement sources yet");
    await user.click(screen.getAllByRole("button", { name: "New source" })[0]);
    await user.type(screen.getByLabelText("Source name"), "staging");
    await user.type(screen.getByLabelText(/^Base URL/), "not-a-url");
    await user.click(screen.getByRole("button", { name: "Create source" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid base URL");
  });

  it("falls back to placeholder text when optional fields are missing", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-sources", () =>
        HttpResponse.json(page([resourceRecord({ id: "source-bare", kind: "measurement-source", status: "DRAFT", data: {} })])),
      ),
    );
    renderWorkspace();
    expect(await screen.findByText("Unnamed source")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("requires a source name before submitting", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-sources", () => HttpResponse.json(page([]))),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("No measurement sources yet");
    await user.click(screen.getAllByRole("button", { name: "New source" })[0]);
    await user.click(screen.getByRole("button", { name: "Create source" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a source name.");
  });

  it("creates a source with a valid URL and shows it in the list", async () => {
    let created = false;
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-sources", () =>
        HttpResponse.json(page(created ? [resourceRecord({ id: "source-new", kind: "measurement-source", status: "DRAFT", data: { name: "staging" } })] : [])),
      ),
      http.post("*/api/v1/squads/:squadId/measurement-sources", () => {
        created = true;
        return HttpResponse.json(
          resourceRecord({ id: "source-new", kind: "measurement-source", status: "DRAFT", data: { name: "staging" } }),
          { status: 201 },
        );
      }),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("No measurement sources yet");
    await user.click(screen.getAllByRole("button", { name: "New source" })[0]);
    await user.type(screen.getByLabelText("Source name"), "staging");
    await user.type(screen.getByLabelText(/^Base URL/), "https://prom.internal");
    await user.click(screen.getByRole("button", { name: "Create source" }));

    expect(await screen.findByText("staging")).toBeInTheDocument();
  });

  it("reports a failed connection check", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-sources", () =>
        HttpResponse.json(
          page([resourceRecord({ id: "source-1", kind: "measurement-source", status: "DRAFT", data: { name: "prod", providerType: "PROMETHEUS", baseUrl: "https://prom" } })]),
        ),
      ),
      http.post("*/api/v1/measurement-sources/:sourceId/connection-checks", () =>
        HttpResponse.json(
          resourceRecord({ id: "check-1", kind: "source-connection-check", data: { status: "FAILED", message: "timeout" } }),
        ),
      ),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("prod");
    await user.click(screen.getByRole("button", { name: "Test connection" }));

    expect(await screen.findByText("Failed")).toBeInTheDocument();
  });

  it("closes the create dialog via the close icon and cancel button", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-sources", () => HttpResponse.json(page([]))),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("No measurement sources yet");
    await user.click(screen.getAllByRole("button", { name: "New source" })[0]);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "New source" })[0]);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("runs a connection check from the row action", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-sources", () =>
        HttpResponse.json(
          page([resourceRecord({ id: "source-1", kind: "measurement-source", status: "DRAFT", data: { name: "prod", providerType: "PROMETHEUS", baseUrl: "https://prom" } })]),
        ),
      ),
      http.post("*/api/v1/measurement-sources/:sourceId/connection-checks", () =>
        HttpResponse.json(
          resourceRecord({ id: "check-1", kind: "source-connection-check", data: { status: "SUCCEEDED", checkedAt: "2026-08-01T10:00:00Z" } }),
        ),
      ),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("prod");
    await user.click(screen.getByRole("button", { name: "Test connection" }));

    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });

  it("activates a draft source and reflects the new status", async () => {
    let status: "DRAFT" | "ACTIVE" = "DRAFT";
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-sources", () =>
        HttpResponse.json(
          page([resourceRecord({ id: "source-1", kind: "measurement-source", status, data: { name: "prod", providerType: "PROMETHEUS", baseUrl: "https://prom" } })]),
        ),
      ),
      http.post("*/api/v1/measurement-sources/:sourceId/activations", () => {
        status = "ACTIVE";
        return HttpResponse.json(resourceRecord({ id: "source-1", kind: "measurement-source", status }), { status: 201 });
      }),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("prod");
    await user.click(screen.getByRole("button", { name: "Activate" }));

    expect(await screen.findByRole("button", { name: "Retire" })).toBeInTheDocument();
  });

  it("retires an active source and hides the action once retired", async () => {
    let status: "ACTIVE" | "RETIRED" = "ACTIVE";
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-sources", () =>
        HttpResponse.json(
          page([resourceRecord({ id: "source-1", kind: "measurement-source", status, data: { name: "prod", providerType: "PROMETHEUS", baseUrl: "https://prom" } })]),
        ),
      ),
      http.post("*/api/v1/measurement-sources/:sourceId/retirements", () => {
        status = "RETIRED";
        return HttpResponse.json(resourceRecord({ id: "source-1", kind: "measurement-source", status }), { status: 201 });
      }),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("prod");
    await user.click(screen.getByRole("button", { name: "Retire" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Retire" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
  });

  it("surfaces an error when activating a source fails", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-sources", () =>
        HttpResponse.json(
          page([resourceRecord({ id: "source-1", kind: "measurement-source", status: "DRAFT", data: { name: "prod", providerType: "PROMETHEUS", baseUrl: "https://prom" } })]),
        ),
      ),
      http.post("*/api/v1/measurement-sources/:sourceId/activations", () =>
        HttpResponse.json({ title: "Conflict" }, { status: 409 }),
      ),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("prod");
    await user.click(screen.getByRole("button", { name: "Activate" }));

    expect(await screen.findByText("Conflict")).toBeInTheDocument();
  });
});
