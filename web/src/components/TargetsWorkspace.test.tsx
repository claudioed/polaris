import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { TargetsWorkspace } from "./TargetsWorkspace";
import { catalog, page, resourceRecord, squad as squadFixture } from "../test/fixtures";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderWorkspace(overrides?: Parameters<typeof catalog>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TargetsWorkspace catalog={catalog(overrides)} />
    </QueryClientProvider>,
  );
}

describe("TargetsWorkspace", () => {
  it("shows a prompt to set up a squad first when none exist", () => {
    renderWorkspace({ squads: [], functions: [] });
    expect(screen.getByText("Set up a squad first")).toBeInTheDocument();
  });

  it("lists a squad's fitness targets", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/fitness-targets", () =>
        HttpResponse.json(
          page([
            resourceRecord({
              id: "target-1",
              kind: "fitness-target",
              status: "ACTIVE",
              data: { name: "Checkout API", kind: "SERVICE", description: "Orders path" },
            }),
          ]),
        ),
      ),
    );
    renderWorkspace();

    expect(await screen.findByText("Checkout API")).toBeInTheDocument();
    expect(screen.getByText("SERVICE")).toBeInTheDocument();
    expect(screen.getByText("Orders path")).toBeInTheDocument();
  });

  it("shows an empty state with no targets yet", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/fitness-targets", () => HttpResponse.json(page([]))),
    );
    renderWorkspace();
    expect(await screen.findByText("No fitness targets yet")).toBeInTheDocument();
  });

  it("creates a target through the dialog and shows it in the list", async () => {
    let created = false;
    server.use(
      http.get("*/api/v1/squads/:squadId/fitness-targets", () =>
        HttpResponse.json(page(created ? [resourceRecord({ id: "target-new", kind: "fitness-target", data: { name: "Billing API" } })] : [])),
      ),
      http.post("*/api/v1/squads/:squadId/fitness-targets", async ({ request }) => {
        const body = (await request.json()) as { name: string };
        created = true;
        return HttpResponse.json(
          resourceRecord({ id: "target-new", kind: "fitness-target", data: { name: body.name } }),
          { status: 201 },
        );
      }),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("No fitness targets yet");
    await user.click(screen.getAllByRole("button", { name: "New target" })[0]);
    await user.type(screen.getByLabelText("Target name"), "Billing API");
    await user.click(screen.getByRole("button", { name: "Create target" }));

    expect(await screen.findByText("Billing API")).toBeInTheDocument();
  });

  it("falls back to placeholder text when optional fields are missing", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/fitness-targets", () =>
        HttpResponse.json(page([resourceRecord({ id: "target-bare", kind: "fitness-target", data: {} })])),
      ),
    );
    renderWorkspace();
    expect(await screen.findByText("Unnamed target")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows an error state and recovers through retry", async () => {
    let fail = true;
    server.use(
      http.get("*/api/v1/squads/:squadId/fitness-targets", () =>
        fail
          ? HttpResponse.json({ title: "boom" }, { status: 500 })
          : HttpResponse.json(page([resourceRecord({ id: "target-1", kind: "fitness-target", data: { name: "Checkout API" } })])),
      ),
    );
    renderWorkspace();
    const user = userEvent.setup();

    expect(await screen.findByText("Could not load fitness targets")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: /Retry/ }));

    expect(await screen.findByText("Checkout API")).toBeInTheDocument();
  });

  it("closes the create dialog via the close icon and cancel button", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/fitness-targets", () => HttpResponse.json(page([]))),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("No fitness targets yet");
    await user.click(screen.getAllByRole("button", { name: "New target" })[0]);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "New target" })[0]);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("switches squads via the picker", async () => {
    const squadB = squadFixture({ id: "squad-2", data: { name: "Platform" } });
    server.use(
      http.get("*/api/v1/squads/:squadId/fitness-targets", ({ params }) =>
        HttpResponse.json(
          page(
            params.squadId === "squad-2"
              ? [resourceRecord({ id: "t-2", kind: "fitness-target", data: { name: "Platform target" } })]
              : [resourceRecord({ id: "t-1", kind: "fitness-target", data: { name: "Checkout target" } })],
          ),
        ),
      ),
    );
    renderWorkspace({ squads: [squadFixture(), squadB] });

    expect(await screen.findByText("Checkout target")).toBeInTheDocument();

    await userEvent.setup().selectOptions(screen.getByLabelText("Squad"), "squad-2");

    expect(await screen.findByText("Platform target")).toBeInTheDocument();
  });
});
