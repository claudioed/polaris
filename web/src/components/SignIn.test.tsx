import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignIn } from "./SignIn";
import { initializeGoogleSignIn, isConfigured, type GoogleUser } from "../auth";

vi.mock("../auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("../auth")>();
  return {
    ...original,
    isConfigured: vi.fn(),
    initializeGoogleSignIn: vi.fn(),
  };
});

const mockedIsConfigured = vi.mocked(isConfigured);
const mockedInitialize = vi.mocked(initializeGoogleSignIn);

const testUser: GoogleUser = {
  token: "header.payload.signature",
  subject: "user-1",
  email: "engineer@example.com",
  name: "Ada Engineer",
};

describe("SignIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explains that sign-in is not configured when the client ID is missing", () => {
    mockedIsConfigured.mockReturnValue(false);

    render(<SignIn onSignedIn={vi.fn()} />);

    expect(
      screen.getByText(/Google Sign-In is not configured\. Set VITE_GOOGLE_CLIENT_ID/),
    ).toBeInTheDocument();
    expect(mockedInitialize).not.toHaveBeenCalled();
  });

  it("renders the loading placeholder while Google Identity Services loads", () => {
    mockedIsConfigured.mockReturnValue(true);
    mockedInitialize.mockReturnValue(new Promise(() => undefined));

    render(<SignIn onSignedIn={vi.fn()} />);

    expect(screen.getByText("Loading Google Sign-In…")).toBeInTheDocument();
    expect(mockedInitialize).toHaveBeenCalledTimes(1);
  });

  it("surfaces initialization failures", async () => {
    mockedIsConfigured.mockReturnValue(true);
    mockedInitialize.mockRejectedValue(new Error("Failed to load Google Identity Services"));

    render(<SignIn onSignedIn={vi.fn()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Failed to load Google Identity Services");
  });

  it("renders non-error rejection reasons", async () => {
    mockedIsConfigured.mockReturnValue(true);
    mockedInitialize.mockRejectedValue("network offline");

    render(<SignIn onSignedIn={vi.fn()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("network offline");
  });

  it("reports the signed-in user through the callback", async () => {
    mockedIsConfigured.mockReturnValue(true);
    let callback: ((user: GoogleUser) => void) | undefined;
    mockedInitialize.mockImplementation((_parent, onSignedIn) => {
      callback = onSignedIn;
      return Promise.resolve();
    });
    const onSignedIn = vi.fn();

    render(<SignIn onSignedIn={onSignedIn} />);
    await screen.findByText("Loading Google Sign-In…");

    callback!(testUser);
    expect(onSignedIn).toHaveBeenCalledWith(testUser);
  });

  it("ignores callbacks that arrive after unmount", () => {
    mockedIsConfigured.mockReturnValue(true);
    let callback: ((user: GoogleUser) => void) | undefined;
    mockedInitialize.mockImplementation((_parent, onSignedIn) => {
      callback = onSignedIn;
      return new Promise(() => undefined);
    });
    const onSignedIn = vi.fn();

    const { unmount } = render(<SignIn onSignedIn={onSignedIn} />);
    unmount();

    callback!(testUser);
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});
