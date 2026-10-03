import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SettingsWorkspace } from "./SettingsWorkspace";
import { catalog, resourceRecord, squad, tribe } from "../test/fixtures";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderSettings(overrides?: Partial<Parameters<typeof catalog>[0]>, onCreated = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SettingsWorkspace catalog={catalog(overrides)} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return onCreated;
}

describe("SettingsWorkspace", () => {
  it("lists existing tribes and squads", async () => {
    renderSettings();
    expect(screen.getAllByText("Commerce").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Checkout")).toBeInTheDocument();
  });

  it("shows empty states when there are no tribes or squads", () => {
    renderSettings({ tribes: [], squads: [] });
    expect(screen.getByText("No tribes yet")).toBeInTheDocument();
    expect(screen.getByText("No squads yet")).toBeInTheDocument();
  });

  it("creates a new tribe", async () => {
    server.use(
      http.post("*/api/v1/tribes", async ({ request }) => {
        const body = (await request.json()) as { name: string };
        return HttpResponse.json(resourceRecord({ id: "tribe-new", kind: "tribe", data: { name: body.name } }), {
          status: 201,
        });
      }),
    );
    const onCreated = renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "New tribe" }));
    await user.type(screen.getByLabelText("Tribe name"), "Platform");
    await user.type(screen.getByLabelText("Description"), "Shared platform capabilities");
    await user.click(screen.getByRole("button", { name: "Create tribe" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires a tribe name before submitting", async () => {
    renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "New tribe" }));
    await user.click(screen.getByRole("button", { name: "Create tribe" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a tribe name.");
  });

  it("creates a tribe without an optional description", async () => {
    server.use(
      http.post("*/api/v1/tribes", () =>
        HttpResponse.json(resourceRecord({ id: "tribe-new", kind: "tribe", data: { name: "Platform" } }), {
          status: 201,
        }),
      ),
    );
    const onCreated = renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "New tribe" }));
    await user.type(screen.getByLabelText("Tribe name"), "Platform");
    await user.click(screen.getByRole("button", { name: "Create tribe" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it("creates a new squad under the selected tribe", async () => {
    server.use(
      http.post("*/api/v1/tribes/:tribeId/squads", async ({ request, params }) => {
        const body = (await request.json()) as { name: string };
        return HttpResponse.json(
          resourceRecord({ id: "squad-new", kind: "squad", parentId: params.tribeId as string, data: { name: body.name } }),
          { status: 201 },
        );
      }),
    );
    const onCreated = renderSettings({ tribes: [tribe(), tribe({ id: "tribe-2", data: { name: "Platform" } })] });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "New squad" }));
    await user.selectOptions(screen.getByLabelText("Tribe"), "tribe-2");
    await user.type(screen.getByLabelText("Squad name"), "Fulfillment");
    await user.type(screen.getByLabelText("Squad mission"), "Ship orders reliably");
    await user.click(screen.getByRole("button", { name: "Create squad" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires a squad name before submitting", async () => {
    renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "New squad" }));
    await user.click(screen.getByRole("button", { name: "Create squad" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a squad name.");
  });

  it("creates a squad without an optional mission", async () => {
    server.use(
      http.post("*/api/v1/tribes/:tribeId/squads", () =>
        HttpResponse.json(resourceRecord({ id: "squad-new", kind: "squad", data: { name: "Fulfillment" } }), {
          status: 201,
        }),
      ),
    );
    const onCreated = renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "New squad" }));
    await user.type(screen.getByLabelText("Squad name"), "Fulfillment");
    await user.click(screen.getByRole("button", { name: "Create squad" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it("disables New squad until a tribe exists", () => {
    renderSettings({ tribes: [], squads: [] });
    expect(screen.getByRole("button", { name: "New squad" })).toBeDisabled();
  });

  it("closes the tribe and squad dialogs via cancel", async () => {
    renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "New tribe" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New squad" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("also closes the tribe dialog via its close icon and the squad dialog via cancel", async () => {
    renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "New tribe" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New squad" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("falls back to placeholder text for unnamed tribes and squads", () => {
    renderSettings({
      tribes: [tribe({ id: "tribe-bare", data: {} })],
      squads: [squad({ id: "squad-bare", data: {}, tribeName: "Commerce" })],
    });
    expect(screen.getByText("Unnamed tribe")).toBeInTheDocument();
    expect(screen.getByText("Unnamed squad")).toBeInTheDocument();
  });
});
