import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { CreateFitnessFunction } from "./CreateFitnessFunction";
import {
  catalog,
  fitnessFunction,
  page,
  problem,
  resourceRecord,
} from "../test/fixtures";

const server = setupServer();

const targetA = resourceRecord({
  id: "target-a",
  kind: "fitness-target",
  data: { name: "Orders API", type: "SERVICE" },
});
const targetB = resourceRecord({
  id: "target-b",
  kind: "fitness-target",
  data: { name: "Catalog UI", type: "APPLICATION" },
});
const activeSource = resourceRecord({
  id: "source-active",
  kind: "measurement-source",
  status: "ACTIVE",
  data: { name: "Prometheus prod" },
});
const inactiveSource = resourceRecord({
  id: "source-inactive",
  kind: "measurement-source",
  status: "INACTIVE",
  data: { name: "Prometheus legacy" },
});
const producerA = resourceRecord({
  id: "producer-a",
  kind: "measurement-producer",
  data: { name: "ci-pipeline" },
});

interface Captured {
  path: string;
  body?: unknown;
}

function useEndpoint(
  method: "get" | "post",
  pattern: string,
  json: Parameters<typeof HttpResponse.json>[0],
  status = 200,
) {
  const requests: Captured[] = [];
  server.use(
    http[method](pattern, async ({ request }) => {
      const url = new URL(request.url);
      let body: unknown;
      try {
        body = await request.clone().json();
      } catch {
        body = undefined;
      }
      requests.push({ path: url.pathname, body });
      return HttpResponse.json(json, { status });
    }),
  );
  return requests;
}

function renderCreate() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CreateFitnessFunction
        catalog={catalog()}
        onClose={onClose}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
  return { onClose, onCreated };
}

function useWorkspaceData() {
  useEndpoint("get", "*/api/v1/squads/:squadId/fitness-targets", page([targetA, targetB]));
  useEndpoint(
    "get",
    "*/api/v1/squads/:squadId/measurement-sources",
    page([activeSource, inactiveSource]),
  );
  useEndpoint("get", "*/api/v1/squads/:squadId/measurement-producers", page([producerA]));
}

/** Fills steps 0 and 1 and lands on the data acquisition step. */
async function fillWizardToAcquisition(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Orders API");
  await user.type(screen.getByLabelText("Name"), "Latency budget");
  await user.type(
    screen.getByLabelText("Purpose"),
    "Protect the checkout journey from latency regressions.",
  );
  await user.type(
    screen.getByLabelText("Objective"),
    "Keep the p95 response time within the agreed budget.",
  );
  await user.click(screen.getByRole("button", { name: /Orders API/ }));
  await user.click(screen.getByRole("button", { name: /Continue/ }));

  await user.type(screen.getByLabelText("Key"), "p95_latency");
  await user.type(screen.getByLabelText("Unit"), "ms");
  await user.type(screen.getByLabelText("Failure value"), "250");
  await user.click(screen.getByRole("button", { name: /Continue/ }));
}

/** Walks the wizard from step 0 to the review step with valid PULL values. */
async function fillPullWizard(user: ReturnType<typeof userEvent.setup>) {
  await fillWizardToAcquisition(user);
  await user.selectOptions(screen.getByLabelText("Measurement source"), "source-active");
  await user.type(
    screen.getByLabelText(/PromQL for p95_latency/),
    "p95_http_request_duration_milliseconds",
  );
  await user.click(screen.getByRole("button", { name: /Continue/ }));
}

describe("CreateFitnessFunction", () => {
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterAll(() => server.close());
  afterEach(() => server.resetHandlers());
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("loads squad fitness targets as choice cards", async () => {
    useWorkspaceData();
    renderCreate();

    expect(await screen.findByText("Orders API")).toBeInTheDocument();
    expect(screen.getByText("Catalog UI")).toBeInTheDocument();
  });

  it("explains when the squad has no targets yet", async () => {
    useEndpoint("get", "*/api/v1/squads/:squadId/fitness-targets", page([]));
    renderCreate();

    expect(
      await screen.findByText("This squad has no fitness targets yet."),
    ).toBeInTheDocument();
  });

  it("blocks continuation until the identity step is valid", async () => {
    useWorkspaceData();
    renderCreate();
    const user = userEvent.setup();

    await screen.findByText("Orders API");
    await user.click(screen.getByRole("button", { name: /Continue/ }));

    expect(
      await screen.findByText("Complete the required information before continuing."),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Name"), "Latency budget");
    await user.type(
      screen.getByLabelText("Purpose"),
      "Protect the checkout journey from latency regressions.",
    );
    await user.type(
      screen.getByLabelText("Objective"),
      "Keep the p95 response time within the agreed budget.",
    );
    await user.click(screen.getByRole("button", { name: /Orders API/ }));
    await user.click(screen.getByRole("button", { name: /Continue/ }));

    expect(await screen.findByText("Measurable criteria")).toBeInTheDocument();
  });

  it("normalizes criterion keys to snake case", async () => {
    useWorkspaceData();
    renderCreate();
    const user = userEvent.setup();

    await screen.findByText("Orders API");
    await user.type(screen.getByLabelText("Name"), "Latency budget");
    await user.type(
      screen.getByLabelText("Purpose"),
      "Protect the checkout journey from latency regressions.",
    );
    await user.type(
      screen.getByLabelText("Objective"),
      "Keep the p95 response time within the agreed budget.",
    );
    await user.click(screen.getByRole("button", { name: /Orders API/ }));
    await user.click(screen.getByRole("button", { name: /Continue/ }));

    await user.type(screen.getByLabelText("Key"), "Error Rate");
    expect(screen.getByLabelText("Key")).toHaveValue("error_rate");
  });

  it("creates a PULL draft with the assembled definition", async () => {
    useWorkspaceData();
    const created = fitnessFunction({ id: "fn-created", lifecycle: "DRAFT", activeVersion: undefined });
    const creations = useEndpoint(
      "post",
      "*/api/v1/squads/:squadId/fitness-functions",
      created,
    );
    const activations = useEndpoint(
      "post",
      "*/api/v1/fitness-functions/:id/versions/:version/activations",
      created,
    );
    const { onCreated } = renderCreate();
    const user = userEvent.setup();

    await fillPullWizard(user);
    const review = document.querySelector("dl.review-grid");
    expect(review?.textContent).toContain("Targets1Criteria1AcquisitionPULLEnforcementWARN");

    await user.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("fn-created"));
    expect(activations).toEqual([]);
    expect(creations.length).toBe(1);
    expect(creations[0].path).toBe("/api/v1/squads/squad-1/fitness-functions");
    expect(creations[0].body).toEqual({
      name: "Latency budget",
      purpose: "Protect the checkout journey from latency regressions.",
      objective: "Keep the p95 response time within the agreed budget.",
      characteristic: "Reliability",
      targetIds: ["target-a"],
      criteria: [
        {
          key: "p95_latency",
          unit: "ms",
          failureComparison: "GREATER_THAN",
          failureValue: 250,
          required: true,
        },
      ],
      freshnessSeconds: 1800,
      enforcement: "WARN",
      acquisition: {
        mode: "PULL",
        sourceId: "source-active",
        trigger: "ON_DEMAND",
        timeoutSeconds: 10,
        queries: [
          {
            criterionKey: "p95_latency",
            expression: "p95_http_request_duration_milliseconds",
            mode: "INSTANT",
            reduction: "LAST",
            seriesPolicy: "REQUIRE_SINGLE_SERIES",
            unit: "ms",
          },
        ],
      },
    });
  });

  it("creates and activates a PUSH function from the pipeline mode", async () => {
    useWorkspaceData();
    const created = fitnessFunction({ id: "fn-created", lifecycle: "ACTIVE", activeVersion: 1 });
    const creations = useEndpoint(
      "post",
      "*/api/v1/squads/:squadId/fitness-functions",
      created,
    );
    const activations = useEndpoint(
      "post",
      "*/api/v1/fitness-functions/:id/versions/:version/activations",
      created,
    );
    const { onCreated } = renderCreate();
    const user = userEvent.setup();

    await screen.findByText("Orders API");
    await user.type(screen.getByLabelText("Name"), "Build stability");
    await user.type(
      screen.getByLabelText("Purpose"),
      "Keep the main branch build stable for releases.",
    );
    await user.type(
      screen.getByLabelText("Objective"),
      "Fail the pipeline when flaky tests exceed the budget.",
    );
    await user.click(screen.getByRole("button", { name: /Orders API/ }));
    await user.click(screen.getByRole("button", { name: /Continue/ }));

    await user.type(screen.getByLabelText("Key"), "flaky_tests");
    await user.type(screen.getByLabelText("Unit"), "count");
    await user.type(screen.getByLabelText("Failure value"), "3");
    await user.click(screen.getByRole("button", { name: /Continue/ }));

    await user.click(screen.getByRole("button", { name: "Receive from pipeline" }));
    await screen.findByRole("option", { name: "ci-pipeline" });
    await user.selectOptions(screen.getByLabelText(/^Producer/), "producer-a");
    await user.click(screen.getByRole("button", { name: /Continue/ }));

    await user.click(screen.getByLabelText(/Activate immediately/));
    const submit = screen.getByRole("button", { name: "Create and activate" });
    await user.click(submit);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("fn-created"));
    expect(creations.length).toBe(1);
    const definition = creations[0].body as { acquisition: { mode: string } };
    expect(definition.acquisition.mode).toBe("PUSH");
    expect(activations.length).toBe(1);
    expect(activations[0].path).toBe("/api/v1/fitness-functions/fn-created/versions/1/activations");
  });

  it("creates a new producer inline from the PUSH acquisition step", async () => {
    useWorkspaceData();
    let created = false;
    server.use(
      http.get("*/api/v1/squads/:squadId/measurement-producers", () =>
        HttpResponse.json(page(created ? [producerA, resourceRecord({ id: "producer-new", kind: "measurement-producer", data: { name: "new-pipeline" } })] : [producerA])),
      ),
    );
    const producerCreations = useEndpoint(
      "post",
      "*/api/v1/squads/:squadId/measurement-producers",
      resourceRecord({ id: "producer-new", kind: "measurement-producer", data: { name: "new-pipeline" } }),
      201,
    );
    renderCreate();
    const user = userEvent.setup();

    await fillWizardToAcquisition(user);
    await user.click(screen.getByRole("button", { name: "Receive from pipeline" }));
    await screen.findByRole("option", { name: "ci-pipeline" });

    await user.selectOptions(screen.getByLabelText(/^Producer/), "__new__");
    await user.type(screen.getByPlaceholderText("e.g. checkout-pipeline"), "new-pipeline");
    created = true;
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("option", { name: "new-pipeline" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Producer/)).toHaveValue("producer-new");
    expect(producerCreations).toEqual([
      { path: "/api/v1/squads/squad-1/measurement-producers", body: { name: "new-pipeline" } },
    ]);
  });

  it("surfaces a producer creation failure and supports cancelling", async () => {
    useWorkspaceData();
    server.use(
      http.post("*/api/v1/squads/:squadId/measurement-producers", () =>
        HttpResponse.json(problem({ status: 409, detail: "Producer name already in use" }), { status: 409 }),
      ),
    );
    renderCreate();
    const user = userEvent.setup();

    await fillWizardToAcquisition(user);
    await user.click(screen.getByRole("button", { name: "Receive from pipeline" }));
    await screen.findByRole("option", { name: "ci-pipeline" });

    await user.selectOptions(screen.getByLabelText(/^Producer/), "__new__");
    await user.type(screen.getByPlaceholderText("e.g. checkout-pipeline"), "dup");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Producer name already in use");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText(/^Producer/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("e.g. checkout-pipeline")).not.toBeInTheDocument();
  });

  it("offers only ACTIVE measurement sources for PULL acquisition", async () => {
    useWorkspaceData();
    renderCreate();
    const user = userEvent.setup();

    await fillWizardToAcquisition(user);

    const sourceSelect = await screen.findByLabelText("Measurement source");
    const options = Array.from(sourceSelect.querySelectorAll("option"));
    expect(options.map((option) => option.textContent)).toEqual([
      "Choose an active source",
      "Prometheus prod",
    ]);
  });

  it("surfaces creation failures as alerts", async () => {
    useWorkspaceData();
    useEndpoint(
      "post",
      "*/api/v1/squads/:squadId/fitness-functions",
      problem({ status: 422, detail: "Criterion key is already in use" }),
      422,
    );
    renderCreate();
    const user = userEvent.setup();

    await fillPullWizard(user);
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Criterion key is already in use",
    );
  });

  it("supports scheduled collection and range queries", async () => {
    useWorkspaceData();
    const created = fitnessFunction({ id: "fn-created" });
    const creations = useEndpoint(
      "post",
      "*/api/v1/squads/:squadId/fitness-functions",
      created,
    );
    renderCreate();
    const user = userEvent.setup();

    await fillWizardToAcquisition(user);
    await user.selectOptions(screen.getByLabelText("Measurement source"), "source-active");
    await user.type(screen.getByLabelText(/PromQL for p95_latency/), "p95_latency_rule");
    await user.selectOptions(screen.getByLabelText("Trigger"), "SCHEDULED");
    expect(await screen.findByLabelText(/Collection interval/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Query mode"), "RANGE");
    await user.click(screen.getByRole("button", { name: /Continue/ }));

    await user.click(await screen.findByRole("button", { name: "Create draft" }));

    await waitFor(() => expect(creations.length).toBe(1));
    const definition = creations[0].body as {
      acquisition: {
        trigger: string;
        intervalSeconds?: number;
        queries: Array<Record<string, unknown>>;
      };
    };
    expect(definition.acquisition.trigger).toBe("SCHEDULED");
    expect(definition.acquisition.intervalSeconds).toBe(300);
    expect(definition.acquisition.queries[0]).toEqual(
      expect.objectContaining({ mode: "RANGE", lookbackSeconds: 300, stepSeconds: 30 }),
    );
  });

  it("navigates back through wizard steps", async () => {
    useWorkspaceData();
    renderCreate();
    const user = userEvent.setup();

    await fillWizardToAcquisition(user);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Measurable criteria")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Intent and ownership")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("adds, removes, and enriches criteria with warning thresholds", async () => {
    useWorkspaceData();
    const created = fitnessFunction({ id: "fn-created" });
    const creations = useEndpoint(
      "post",
      "*/api/v1/squads/:squadId/fitness-functions",
      created,
    );
    renderCreate();
    const user = userEvent.setup();

    await screen.findByText("Orders API");
    await user.type(screen.getByLabelText("Name"), "Latency budget");
    await user.type(
      screen.getByLabelText("Purpose"),
      "Protect the checkout journey from latency regressions.",
    );
    await user.type(
      screen.getByLabelText("Objective"),
      "Keep the p95 response time within the agreed budget.",
    );
    await user.click(screen.getByRole("button", { name: /Orders API/ }));
    await user.click(screen.getByRole("button", { name: /Continue/ }));

    await user.click(screen.getByRole("button", { name: /Add criterion/ }));
    expect(screen.getAllByText(/^Criterion \d$/)).toHaveLength(2);
    await user.type(screen.getAllByLabelText("Key")[0], "p95_latency");
    await user.type(screen.getAllByLabelText("Key")[1], "error_rate");

    await user.click(screen.getAllByRole("button", { name: "Remove criterion" })[0]);
    expect(screen.getAllByText(/^Criterion \d$/)).toHaveLength(1);

    await user.type(screen.getByLabelText("Unit"), "percent");
    await user.type(screen.getByLabelText("Warning value"), "3");
    await user.type(screen.getByLabelText("Failure value"), "5");
    await user.click(screen.getByRole("button", { name: /Continue/ }));

    await user.selectOptions(screen.getByLabelText("Measurement source"), "source-active");
    await user.type(screen.getByLabelText(/PromQL for error_rate/), "error_rate_rule");
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    await user.click(await screen.findByRole("button", { name: "Create draft" }));

    await waitFor(() => expect(creations.length).toBe(1));
    const definition = creations[0].body as { criteria: Array<Record<string, unknown>> };
    expect(definition.criteria).toEqual([
      expect.objectContaining({
        key: "error_rate",
        unit: "percent",
        warningComparison: "GREATER_THAN",
        warningValue: 3,
        failureValue: 5,
      }),
    ]);
  });

  it("blocks step transitions until criteria and acquisition are complete", async () => {
    useWorkspaceData();
    renderCreate();
    const user = userEvent.setup();

    await screen.findByText("Orders API");
    await user.type(screen.getByLabelText("Name"), "Latency budget");
    await user.type(
      screen.getByLabelText("Purpose"),
      "Protect the checkout journey from latency regressions.",
    );
    await user.type(
      screen.getByLabelText("Objective"),
      "Keep the p95 response time within the agreed budget.",
    );
    await user.click(screen.getByRole("button", { name: /Orders API/ }));

    await user.click(screen.getByRole("button", { name: /Continue/ }));
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    expect(
      await screen.findByText("Complete the required information before continuing."),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Key"), "p95_latency");
    await user.type(screen.getByLabelText("Unit"), "ms");
    await user.type(screen.getByLabelText("Failure value"), "250");
    await user.click(screen.getByRole("button", { name: /Continue/ }));

    await user.click(screen.getByRole("button", { name: /Continue/ }));
    expect(
      await screen.findByText("Complete the required information before continuing."),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Measurement source"), "source-active");
    await user.type(screen.getByLabelText(/PromQL for p95_latency/), "p95_latency_rule");
    await user.click(screen.getByRole("button", { name: /Continue/ }));

    expect(await screen.findByText("Review the control")).toBeInTheDocument();
  });
});
