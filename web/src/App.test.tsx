import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import {
  activateFitnessFunction,
  createFitnessFunction,
  createFitnessTarget,
  createSquad,
  createTribe,
  getSquadSources,
  getSquadTargets,
  loadCatalog,
} from "./api";
import { currentUser, signOut, type GoogleUser } from "./auth";
import {
  catalog as catalogFixture,
  fitnessFunction,
  fitnessVersion,
  pushDefinition,
  resourceRecord,
  squad as squadFixture,
  tribe as tribeFixture,
} from "./test/fixtures";

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    loadCatalog: vi.fn(),
    getSquadTargets: vi.fn(),
    getSquadSources: vi.fn(),
    createTribe: vi.fn(),
    createSquad: vi.fn(),
    createFitnessTarget: vi.fn(),
    createFitnessFunction: vi.fn(),
    activateFitnessFunction: vi.fn(),
  };
});

const testUser: GoogleUser = {
  token: "header.eyJzdWIiOiJ1c2VyLTEifQ.signature",
  subject: "user-1",
  email: "engineer@example.com",
  name: "Ada Engineer",
};

vi.mock("./auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("./auth")>();
  return {
    ...original,
    currentUser: vi.fn(),
    onAuthChange: vi.fn(() => () => undefined),
    signOut: vi.fn(),
  };
});

const mockedCurrentUser = vi.mocked(currentUser);
const mockedSignOut = vi.mocked(signOut);
const mockedLoadCatalog = vi.mocked(loadCatalog);
const mockedGetSquadTargets = vi.mocked(getSquadTargets);
const mockedGetSquadSources = vi.mocked(getSquadSources);
const mockedCreateTribe = vi.mocked(createTribe);
const mockedCreateSquad = vi.mocked(createSquad);
const mockedCreateFitnessTarget = vi.mocked(createFitnessTarget);
const mockedCreateFitnessFunction = vi.mocked(createFitnessFunction);
const mockedActivateFitnessFunction = vi.mocked(activateFitnessFunction);

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe("Polaris control tower", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCurrentUser.mockReturnValue(testUser);
    mockedLoadCatalog.mockResolvedValue(catalogFixture());
    mockedGetSquadTargets.mockResolvedValue({ items: [] });
    mockedGetSquadSources.mockResolvedValue({ items: [] });
    mockedCreateTribe.mockResolvedValue(tribeFixture({ id: "tribe-created" }));
    mockedCreateSquad.mockResolvedValue(squadFixture({ id: "squad-created" }));
    mockedCreateFitnessTarget.mockResolvedValue(
      resourceRecord({ id: "target-created", kind: "fitness-target" }),
    );
    mockedCreateFitnessFunction.mockResolvedValue(fitnessFunction({ id: "fn-created" }));
    mockedActivateFitnessFunction.mockResolvedValue(fitnessFunction({ id: "fn-created" }));
  });

  it("renders live catalog metrics and search results", async () => {
    renderApp();
    expect(await screen.findByText("Checkout availability")).toBeInTheDocument();
    expect(screen.getByText("Total controls").parentElement).toHaveTextContent("1");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Search fitness functions"), "security");
    expect(screen.getByText("No matching controls")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Checkout availability")).toBeInTheDocument();
  });

  it("clears the search through the inline clear button", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Checkout availability");
    await user.type(screen.getByLabelText("Search fitness functions"), "nomatch");
    expect(await screen.findByText("No matching controls")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(await screen.findByText("Checkout availability")).toBeInTheDocument();
  });

  it("opens the definition details panel", async () => {
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByText("Checkout availability"));
    expect(
      await screen.findByLabelText("Checkout availability details"),
    ).toBeInTheDocument();
    expect(screen.getByText("Architectural objective")).toBeInTheDocument();
  });

  it("opens workspace setup instead of silently disabling creation", async () => {
    mockedLoadCatalog.mockResolvedValue(
      catalogFixture({ squads: [], functions: [] }),
    );
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New fitness function" }));
    expect(screen.getByRole("dialog", { name: "Prepare your squad" })).toBeInTheDocument();
    expect(screen.getByText("A fitness function needs an owner and a target")).toBeInTheDocument();
  });

  it("shows the signed-in user and signs out from the avatar", async () => {
    renderApp();
    const avatar = await screen.findByRole("button", {
      name: /Sign out \(engineer@example.com\)/,
    });
    expect(avatar).toHaveTextContent("AE");
    await userEvent.setup().click(avatar);
    expect(mockedSignOut).toHaveBeenCalled();
  });

  it("renders the sign-in gate while signed out", async () => {
    mockedCurrentUser.mockReturnValueOnce(null);
    renderApp();
    expect(await screen.findByText("Polaris Control Tower")).toBeInTheDocument();
    expect(
      screen.getByText("Sign in with your Google account to govern fitness functions."),
    ).toBeInTheDocument();
    expect(mockedLoadCatalog).not.toHaveBeenCalled();
  });

  it("shows the connecting state while the catalog loads", async () => {
    mockedLoadCatalog.mockReturnValue(new Promise(() => undefined));
    renderApp();

    expect(await screen.findByText("Connecting to Polaris")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New fitness function/ })).toBeDisabled();
  });

  it("shows an offline state and recovers through retry", async () => {
    mockedLoadCatalog.mockRejectedValueOnce(new Error("connection refused"));
    renderApp();

    expect(await screen.findByText("Control tower is offline")).toBeInTheDocument();
    expect(screen.getByText("connection refused")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /Retry/ }));

    expect(await screen.findByText("Checkout availability")).toBeInTheDocument();
    expect(mockedLoadCatalog).toHaveBeenCalledTimes(2);
  });

  it("filters by lifecycle, enforcement, and acquisition", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Checkout availability");

    await user.selectOptions(screen.getByLabelText("Lifecycle"), "DRAFT");
    expect(await screen.findByText("No matching controls")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Checkout availability")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Enforcement"), "BLOCK");
    expect(await screen.findByText("No matching controls")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Enforcement"), "WARN");
    expect(await screen.findByText("Checkout availability")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Acquisition"), "PULL");
    expect(await screen.findByText("No matching controls")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Acquisition"), "PUSH");
    expect(await screen.findByText("Checkout availability")).toBeInTheDocument();
  });

  it("sorts active controls first and then by name", async () => {
    mockedLoadCatalog.mockResolvedValue(
      catalogFixture({
        functions: [
          fitnessFunction({
            id: "fn-zulu",
            lifecycle: "DRAFT",
            activeVersion: undefined,
            versions: [
              fitnessVersion({
                state: "DRAFT",
                activatedAt: undefined,
                definition: pushDefinition({ name: "Zulu control" }),
              }),
            ],
          }),
          fitnessFunction({
            id: "fn-beta",
            versions: [fitnessVersion({ definition: pushDefinition({ name: "Beta control" }) })],
          }),
          fitnessFunction({
            id: "fn-alpha",
            versions: [fitnessVersion({ definition: pushDefinition({ name: "Alpha control" }) })],
          }),
          fitnessFunction({ id: "fn-empty", versions: [] }),
        ],
      }),
    );

    renderApp();
    const rows = await screen.findAllByRole("row");

    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent("Alpha control");
    expect(rows[2]).toHaveTextContent("Beta control");
    expect(rows[3]).toHaveTextContent("Zulu control");
  });

  it("opens and closes the mobile navigation", async () => {
    renderApp();
    await screen.findByText("Checkout availability");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    const closers = screen.getAllByRole("button", { name: "Close navigation" });
    expect(closers).toHaveLength(2);
    expect(document.querySelector(".nav-scrim")).not.toBeNull();

    await user.click(closers[1]);
    expect(screen.getAllByRole("button", { name: "Close navigation" })).toHaveLength(1);
    expect(document.querySelector(".nav-scrim")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    await user.click(screen.getAllByRole("button", { name: "Close navigation" })[0]);
    expect(document.querySelector(".nav-scrim")).toBeNull();
  });

  it("focuses the search through the keyboard shortcut and hint", async () => {
    renderApp();
    await screen.findByText("Checkout availability");
    const search = screen.getByLabelText("Search fitness functions");

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(search).toHaveFocus();

    search.blur();
    await userEvent.setup().click(screen.getByRole("button", { name: "Focus search" }));
    expect(search).toHaveFocus();
  });

  it("resets filters and search from the overview navigation", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Checkout availability");

    await user.type(screen.getByLabelText("Search fitness functions"), "nomatch");
    expect(await screen.findByText("No matching controls")).toBeInTheDocument();

    window.scrollTo = vi.fn();
    await user.click(screen.getByRole("button", { name: /Overview/ }));

    expect(await screen.findByText("Checkout availability")).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalled();
  });

  it("invites the first fitness function when squads exist but controls do not", async () => {
    mockedLoadCatalog.mockResolvedValue(catalogFixture({ functions: [] }));
    renderApp();

    expect(await screen.findByText("Create your first fitness function")).toBeInTheDocument();
    expect(screen.getByText("0% coverage")).toBeInTheDocument();
  });

  it("opens the create dialog when squads exist", async () => {
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Checkout availability");

    await user.click(screen.getByRole("button", { name: "New fitness function" }));

    expect(
      await screen.findByRole("dialog", { name: "Create fitness function" }),
    ).toBeInTheDocument();
  });

  it("chains workspace setup into control creation", async () => {
    mockedLoadCatalog
      .mockResolvedValueOnce(catalogFixture({ squads: [], functions: [] }))
      .mockResolvedValue(catalogFixture());
    renderApp();
    const user = userEvent.setup();
    await screen.findByText("Set up your first squad");

    await user.click(screen.getByRole("button", { name: "Set up workspace" }));
    await user.type(screen.getByLabelText("Squad name"), "Checkout");
    await user.type(screen.getByLabelText("First fitness target"), "Orders API");
    await user.click(screen.getByRole("button", { name: "Create squad and target" }));

    expect(
      await screen.findByRole("dialog", { name: "Create fitness function" }),
    ).toBeInTheDocument();
    expect(mockedCreateSquad).toHaveBeenCalledTimes(1);
    expect(mockedCreateFitnessTarget).toHaveBeenCalledTimes(1);
    expect(mockedLoadCatalog).toHaveBeenCalledTimes(2);
  });
});
