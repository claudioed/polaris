import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { TemplatesWorkspace } from "./TemplatesWorkspace";
import { catalog, page, resourceRecord, tribe as tribeFixture } from "../test/fixtures";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderWorkspace(overrides?: Parameters<typeof catalog>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TemplatesWorkspace catalog={catalog(overrides)} />
    </QueryClientProvider>,
  );
}

function template(partial: Record<string, unknown> = {}) {
  return resourceRecord({
    id: "template-1",
    kind: "fitness-function-template",
    status: "ACTIVE",
    data: { name: "Resilience baseline", description: "Use for new services" },
    ...partial,
  });
}

describe("TemplatesWorkspace", () => {
  it("shows a prompt to set up a tribe first when none exist", () => {
    renderWorkspace({ tribes: [], squads: [], functions: [] });
    expect(screen.getByText("Set up a tribe first")).toBeInTheDocument();
  });

  it("lists a tribe's templates", async () => {
    server.use(
      http.get("*/api/v1/tribes/:tribeId/fitness-function-templates", () => HttpResponse.json(page([template()]))),
    );
    renderWorkspace();

    expect(await screen.findByText("Resilience baseline")).toBeInTheDocument();
    expect(screen.getByText("Use for new services")).toBeInTheDocument();
  });

  it("shows an empty state with no templates yet", async () => {
    server.use(
      http.get("*/api/v1/tribes/:tribeId/fitness-function-templates", () => HttpResponse.json(page([]))),
    );
    renderWorkspace();
    expect(await screen.findByText("No templates published yet")).toBeInTheDocument();
  });

  it("shows an error state when templates fail to load", async () => {
    server.use(
      http.get("*/api/v1/tribes/:tribeId/fitness-function-templates", () =>
        HttpResponse.json({ title: "boom" }, { status: 500 }),
      ),
    );
    renderWorkspace();
    expect(await screen.findByText("Could not load templates")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("publishes a template through the dialog and shows it in the list", async () => {
    let created = false;
    server.use(
      http.get("*/api/v1/tribes/:tribeId/fitness-function-templates", () =>
        HttpResponse.json(page(created ? [template({ id: "template-new", data: { name: "Security baseline" } })] : [])),
      ),
      http.post("*/api/v1/tribes/:tribeId/fitness-function-templates", async ({ request }) => {
        const body = (await request.json()) as { name: string };
        created = true;
        return HttpResponse.json(template({ id: "template-new", data: { name: body.name } }), { status: 201 });
      }),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("No templates published yet");
    await user.click(screen.getAllByRole("button", { name: "New template" })[0]);
    await user.type(screen.getByLabelText(/^Template name/), "Security baseline");
    await user.click(screen.getByRole("button", { name: "Publish template" }));

    expect(await screen.findByText("Security baseline")).toBeInTheDocument();
  });

  it("requires a template name before submitting", async () => {
    server.use(
      http.get("*/api/v1/tribes/:tribeId/fitness-function-templates", () => HttpResponse.json(page([]))),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("No templates published yet");
    await user.click(screen.getAllByRole("button", { name: "New template" })[0]);
    await user.click(screen.getByRole("button", { name: "Publish template" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a template name.");
  });

  it("closes the create dialog via the close icon and cancel button", async () => {
    server.use(
      http.get("*/api/v1/tribes/:tribeId/fitness-function-templates", () => HttpResponse.json(page([]))),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("No templates published yet");
    await user.click(screen.getAllByRole("button", { name: "New template" })[0]);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "New template" })[0]);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("switches tribes via the picker", async () => {
    const tribeB = tribeFixture({ id: "tribe-2", data: { name: "Platform" } });
    server.use(
      http.get("*/api/v1/tribes/:tribeId/fitness-function-templates", ({ params }) =>
        HttpResponse.json(
          page(
            params.tribeId === "tribe-2"
              ? [template({ id: "t-2", data: { name: "Platform baseline" } })]
              : [template({ id: "t-1", data: { name: "Commerce baseline" } })],
          ),
        ),
      ),
    );
    renderWorkspace({ tribes: [tribeFixture(), tribeB] });

    expect(await screen.findByText("Commerce baseline")).toBeInTheDocument();

    await userEvent.setup().selectOptions(screen.getByLabelText("Tribe"), "tribe-2");

    expect(await screen.findByText("Platform baseline")).toBeInTheDocument();
  });

  it("adopts a template into a squad and shows the success state", async () => {
    server.use(
      http.get("*/api/v1/tribes/:tribeId/fitness-function-templates", () => HttpResponse.json(page([template()]))),
      http.post("*/api/v1/fitness-function-templates/:templateId/adoptions", async ({ request }) => {
        const body = (await request.json()) as { squadId: string };
        return HttpResponse.json(
          resourceRecord({ id: "adoption-1", kind: "template-adoption", data: { squadId: body.squadId } }),
          { status: 201 },
        );
      }),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("Resilience baseline");
    await user.click(screen.getByRole("button", { name: "Adopt" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Adopt template" }));

    expect(await screen.findByText(/Draft created for/)).toBeInTheDocument();
  });

  it("disables adoption when the tribe has no squads", async () => {
    server.use(
      http.get("*/api/v1/tribes/:tribeId/fitness-function-templates", () => HttpResponse.json(page([template()]))),
    );
    renderWorkspace({ squads: [] });

    await screen.findByText("Resilience baseline");
    expect(screen.getByRole("button", { name: "Adopt" })).toBeDisabled();
  });

  it("surfaces an error when adoption fails", async () => {
    server.use(
      http.get("*/api/v1/tribes/:tribeId/fitness-function-templates", () => HttpResponse.json(page([template()]))),
      http.post("*/api/v1/fitness-function-templates/:templateId/adoptions", () =>
        HttpResponse.json({ title: "Conflict" }, { status: 409 }),
      ),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("Resilience baseline");
    await user.click(screen.getByRole("button", { name: "Adopt" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Adopt template" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Conflict");
  });

  it("closes the adopt dialog", async () => {
    server.use(
      http.get("*/api/v1/tribes/:tribeId/fitness-function-templates", () => HttpResponse.json(page([template()]))),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("Resilience baseline");
    await user.click(screen.getByRole("button", { name: "Adopt" }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
