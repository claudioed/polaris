import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SetupWorkspace } from "./SetupWorkspace";
import { catalog, problem, resourceRecord, tribe as tribeFixture } from "../test/fixtures";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

interface Captured {
  method: string;
  path: string;
  body?: unknown;
}

function useCapture(
  pattern: string,
  json: Parameters<typeof HttpResponse.json>[0],
  status = 200,
) {
  const requests: Captured[] = [];
  server.use(
    http.all(pattern, async ({ request }) => {
      const url = new URL(request.url);
      let body: unknown;
      try {
        body = await request.clone().json();
      } catch {
        body = undefined;
      }
      requests.push({ method: request.method, path: url.pathname, body });
      return HttpResponse.json(json, { status });
    }),
  );
  return requests;
}

function renderSetup(overrides?: Partial<Parameters<typeof SetupWorkspace>[0]>) {
  const onClose = vi.fn();
  const onReady = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SetupWorkspace catalog={catalog()} onClose={onClose} onReady={onReady} {...overrides} />
    </QueryClientProvider>,
  );
  return { onClose, onReady };
}

describe("SetupWorkspace", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("renders the dialog with existing tribes and the new-tribe option", () => {
    renderSetup();

    expect(screen.getByRole("dialog", { name: "Prepare your squad" })).toBeInTheDocument();
    const tribeSelect = screen.getByLabelText("Tribe");
    expect(tribeSelect).toHaveValue("tribe-1");
    expect(
      screen.getByRole("option", { name: "Create a new tribe…" }),
    ).toBeInTheDocument();
  });

  it("defaults to creating a new tribe when the workspace has none", () => {
    renderSetup({ catalog: { tribes: [], squads: [], functions: [] } });

    expect(screen.getByLabelText("New tribe name")).toBeInTheDocument();
  });

  it("labels unnamed tribes in the tribe selector", () => {
    renderSetup({
      catalog: {
        tribes: [tribeFixture({ id: "tribe-x", data: {} })],
        squads: [],
        functions: [],
      },
    });

    expect(screen.getByRole("option", { name: "Unnamed tribe" })).toBeInTheDocument();
  });

  it("requires a squad name before submitting", async () => {
    renderSetup();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Create squad and target" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a squad name.");
  });

  it("requires a tribe name when creating a new tribe", async () => {
    renderSetup();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Tribe"), "new");
    await user.click(screen.getByRole("button", { name: "Create squad and target" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a tribe name.");
  });

  it("requires the first fitness target before submitting", async () => {
    renderSetup();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Squad name"), "Checkout");
    await user.click(screen.getByRole("button", { name: "Create squad and target" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the first fitness target.");
  });

  it("creates the squad and target under an existing tribe", async () => {
    const squadRequests = useCapture(
      "*/api/v1/tribes/:tribeId/squads",
      resourceRecord({ id: "squad-created", kind: "squad" }),
    );
    const targetRequests = useCapture(
      "*/api/v1/squads/:squadId/fitness-targets",
      resourceRecord({ id: "target-created", kind: "fitness-target" }),
    );
    const { onReady } = renderSetup();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Squad name"), "  Checkout  ");
    await user.type(screen.getByLabelText("Squad mission"), "Fast checkout");
    await user.type(screen.getByLabelText("First fitness target"), "Orders API");
    await user.selectOptions(screen.getByLabelText("Target type"), "APPLICATION");
    await user.click(screen.getByRole("button", { name: "Create squad and target" }));

    await vi.waitFor(() => expect(onReady).toHaveBeenCalled());
    expect(onReady.mock.calls[0]?.[0]).toBe("squad-created");
    expect(squadRequests).toEqual([
      {
        method: "POST",
        path: "/api/v1/tribes/tribe-1/squads",
        body: { name: "Checkout", mission: "Fast checkout" },
      },
    ]);
    expect(targetRequests).toEqual([
      {
        method: "POST",
        path: "/api/v1/squads/squad-created/fitness-targets",
        body: {
          name: "Orders API",
          type: "APPLICATION",
          description: "Initial target created during control-tower setup",
        },
      },
    ]);
  });

  it("creates the tribe first when a new tribe is selected", async () => {
    const tribeRequests = useCapture(
      "*/api/v1/tribes",
      resourceRecord({ id: "tribe-created", kind: "tribe" }),
    );
    const squadRequests = useCapture(
      "*/api/v1/tribes/:tribeId/squads",
      resourceRecord({ id: "squad-created", kind: "squad" }),
    );
    useCapture(
      "*/api/v1/squads/:squadId/fitness-targets",
      resourceRecord({ id: "target-created", kind: "fitness-target" }),
    );
    const { onReady } = renderSetup();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Tribe"), "new");
    await user.type(screen.getByLabelText("New tribe name"), " Platform ");
    await user.type(screen.getByLabelText("Squad name"), "Foundations");
    await user.type(screen.getByLabelText("First fitness target"), "Orders API");
    await user.click(screen.getByRole("button", { name: "Create squad and target" }));

    await vi.waitFor(() => expect(onReady).toHaveBeenCalled());
    expect(onReady.mock.calls[0]?.[0]).toBe("squad-created");
    expect(tribeRequests).toEqual([
      {
        method: "POST",
        path: "/api/v1/tribes",
        body: { name: "Platform", description: "Created from Polaris Control Tower" },
      },
    ]);
    expect(squadRequests[0].path).toBe("/api/v1/tribes/tribe-created/squads");
  });

  it("surfaces API failures as alerts", async () => {
    useCapture(
      "*/api/v1/tribes/:tribeId/squads",
      problem({ status: 409, detail: "Tribe is being archived" }),
      409,
    );
    renderSetup();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Squad name"), "Checkout");
    await user.type(screen.getByLabelText("First fitness target"), "Orders API");
    await user.click(screen.getByRole("button", { name: "Create squad and target" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Tribe is being archived");
  });

  it("closes through the cancel button", async () => {
    const { onClose } = renderSetup();

    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
