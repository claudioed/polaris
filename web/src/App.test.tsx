import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { loadCatalog } from "./api";
import { currentUser, signOut, type GoogleUser } from "./auth";

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return { ...original, loadCatalog: vi.fn() };
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
    currentUser: vi.fn(() => testUser),
    onAuthChange: vi.fn(() => () => undefined),
    signOut: vi.fn(),
  };
});

const mockedCurrentUser = vi.mocked(currentUser);
const mockedSignOut = vi.mocked(signOut);
const mockedLoadCatalog = vi.mocked(loadCatalog);

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
    mockedLoadCatalog.mockResolvedValue({
      tribes: [],
      squads: [
        {
          id: "squad-1",
          tribeId: "tribe-1",
          tribeName: "Commerce",
          kind: "squad",
          status: "ACTIVE",
          revision: 1,
          data: { name: "Checkout" },
          createdAt: "",
          updatedAt: "",
        },
      ],
      functions: [
        {
          id: "fn-1",
          ownerSquadId: "squad-1",
          lifecycle: "ACTIVE",
          revision: 2,
          activeVersion: 1,
          versions: [
            {
              number: 1,
              state: "ACTIVE",
              createdAt: "2026-07-20T10:00:00Z",
              definition: {
                name: "Checkout availability",
                purpose: "Protect checkout",
                objective: "Remain available",
                characteristic: "Reliability",
                targetIds: ["target-1"],
                criteria: [],
                acquisition: {
                  mode: "PULL",
                  sourceId: "source-1",
                  trigger: "ON_DEMAND",
                  timeoutSeconds: 10,
                  queries: [],
                },
                freshnessSeconds: 300,
                enforcement: "BLOCK",
              },
            },
          ],
        },
      ],
    });
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

  it("opens the definition details panel", async () => {
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByText("Checkout availability"));
    await waitFor(() => {
      expect(screen.getByLabelText("Checkout availability details")).toBeInTheDocument();
    });
    expect(screen.getByText("Architectural objective")).toBeInTheDocument();
  });

  it("opens workspace setup instead of silently disabling creation", async () => {
    mockedLoadCatalog.mockResolvedValueOnce({
      tribes: [
        {
          id: "tribe-1",
          kind: "tribe",
          status: "ACTIVE",
          revision: 1,
          data: { name: "Platform" },
          createdAt: "",
          updatedAt: "",
        },
      ],
      squads: [],
      functions: [],
    });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New fitness function" }));
    expect(screen.getByRole("dialog", { name: "Prepare your squad" })).toBeInTheDocument();
    expect(screen.getByText("A fitness function needs an owner and a target")).toBeInTheDocument();
  });

  it("shows the signed-in user and signs out from the avatar", async () => {
    renderApp();
    const avatar = await screen.findByRole("button", { name: /Sign out \(engineer@example.com\)/ });
    expect(avatar).toHaveTextContent("AE");
    await userEvent.setup().click(avatar);
    expect(mockedSignOut).toHaveBeenCalled();
  });

  it("renders the sign-in gate while signed out", async () => {
    mockedCurrentUser.mockReturnValueOnce(null);
    renderApp();
    expect(await screen.findByText("Polaris Control Tower")).toBeInTheDocument();
    expect(screen.getByText("Sign in with your Google account to govern fitness functions.")).toBeInTheDocument();
    expect(mockedLoadCatalog).not.toHaveBeenCalled();
  });
});
