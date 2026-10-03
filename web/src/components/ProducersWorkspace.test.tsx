import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ProducersWorkspace } from "./ProducersWorkspace";
import { catalog, page, resourceRecord } from "../test/fixtures";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProducersWorkspace catalog={catalog()} />
    </QueryClientProvider>,
  );
}

describe("ProducersWorkspace", () => {
  it("lists a squad's measurement producers", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-producers", () =>
        HttpResponse.json(
          page([
            resourceRecord({
              id: "producer-1",
              kind: "measurement-producer",
              data: { name: "ci-pipeline", description: "Nightly regression suite" },
            }),
          ]),
        ),
      ),
    );
    renderWorkspace();

    expect(await screen.findByText("ci-pipeline")).toBeInTheDocument();
    expect(screen.getByText("Nightly regression suite")).toBeInTheDocument();
  });

  it("shows an empty state with no producers yet", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-producers", () => HttpResponse.json(page([]))),
    );
    renderWorkspace();
    expect(await screen.findByText("No measurement producers yet")).toBeInTheDocument();
  });

  it("creates a producer through the dialog and shows it in the list", async () => {
    let created = false;
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-producers", () =>
        HttpResponse.json(
          page(
            created
              ? [resourceRecord({ id: "producer-new", kind: "measurement-producer", data: { name: "release-bot" } })]
              : [],
          ),
        ),
      ),
      http.post("*/api/v1/squads/:squadId/measurement-producers", async ({ request }) => {
        const body = (await request.json()) as { name: string };
        created = true;
        return HttpResponse.json(
          resourceRecord({ id: "producer-new", kind: "measurement-producer", data: { name: body.name } }),
          { status: 201 },
        );
      }),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("No measurement producers yet");
    await user.click(screen.getAllByRole("button", { name: "New producer" })[0]);
    await user.type(screen.getByLabelText("Producer name"), "release-bot");
    await user.click(screen.getByRole("button", { name: "Create producer" }));

    expect(await screen.findByText("release-bot")).toBeInTheDocument();
  });

  it("falls back to placeholder text when the name is missing", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-producers", () =>
        HttpResponse.json(page([resourceRecord({ id: "producer-bare", kind: "measurement-producer", data: {} })])),
      ),
    );
    renderWorkspace();
    expect(await screen.findByText("Unnamed producer")).toBeInTheDocument();
  });

  it("closes the create dialog via the close icon and cancel button", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-producers", () => HttpResponse.json(page([]))),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("No measurement producers yet");
    await user.click(screen.getAllByRole("button", { name: "New producer" })[0]);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "New producer" })[0]);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires a producer name before submitting", async () => {
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-producers", () => HttpResponse.json(page([]))),
    );
    renderWorkspace();
    const user = userEvent.setup();

    await screen.findByText("No measurement producers yet");
    await user.click(screen.getAllByRole("button", { name: "New producer" })[0]);
    await user.click(screen.getByRole("button", { name: "Create producer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a producer name.");
  });
});
