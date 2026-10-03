import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentUser, currentToken, onAuthChange, signOut } from "./auth";

function fakeToken(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `header.${payload}.signature`;
}

describe("auth session", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("decodes the signed-in user from the stored token", () => {
    sessionStorage.setItem("polaris.idToken", fakeToken({ sub: "user-1", email: "a@example.com", name: "Ada" }));
    expect(currentUser()).toEqual({
      token: expect.any(String),
      subject: "user-1",
      email: "a@example.com",
      name: "Ada",
      picture: undefined,
    });
    expect(currentToken()).toContain("header.");
  });

  it("returns null and clears storage for malformed tokens", () => {
    sessionStorage.setItem("polaris.idToken", "not-a-jwt");
    expect(currentUser()).toBeNull();
    expect(sessionStorage.getItem("polaris.idToken")).toBeNull();
  });

  it("falls back to placeholders when token claims lack email and name", () => {
    sessionStorage.setItem("polaris.idToken", fakeToken({ sub: "user-2" }));

    expect(currentUser()).toEqual({
      token: expect.any(String),
      subject: "user-2",
      email: "",
      name: "Signed in",
      picture: undefined,
    });
  });

  it("decodes profile pictures when present", () => {
    sessionStorage.setItem(
      "polaris.idToken",
      fakeToken({ sub: "user-3", email: "c@example.com", picture: "https://lh3.example/a.png" }),
    );

    expect(currentUser()?.picture).toBe("https://lh3.example/a.png");
  });

  it("signs out and notifies listeners", () => {
    sessionStorage.setItem("polaris.idToken", fakeToken({ sub: "user-1" }));
    const listener = vi.fn();
    const unsubscribe = onAuthChange(listener);
    signOut();
    expect(sessionStorage.getItem("polaris.idToken")).toBeNull();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("reports no user when signed out", () => {
    expect(currentUser()).toBeNull();
    expect(currentToken()).toBeNull();
  });

  it("notifies Google to disable auto-select on sign out", () => {
    const disableAutoSelect = vi.fn();
    (window as { google?: unknown }).google = {
      accounts: { id: { disableAutoSelect } },
    };
    sessionStorage.setItem("polaris.idToken", fakeToken({ sub: "user-1" }));

    signOut();

    expect(disableAutoSelect).toHaveBeenCalledTimes(1);
    delete (window as { google?: unknown }).google;
  });
});

describe("google identity services", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    delete (window as { google?: unknown }).google;
    document.querySelectorAll("script").forEach((script) => script.remove());
  });

  function interceptScript(): HTMLScriptElement[] {
    const created: HTMLScriptElement[] = [];
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      const element = createElement(tagName);
      if (tagName === "script") created.push(element as HTMLScriptElement);
      return element;
    }) as typeof document.createElement);
    return created;
  }

  it("requires a configured client id", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    vi.resetModules();
    const { initializeGoogleSignIn } = await import("./auth");

    await expect(
      initializeGoogleSignIn(document.createElement("div"), vi.fn()),
    ).rejects.toThrow("VITE_GOOGLE_CLIENT_ID is not configured");
  });

  it("initializes the sign-in button once the script loads", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id");
    vi.resetModules();
    const created = interceptScript();
    const { initializeGoogleSignIn } = await import("./auth");

    const parent = document.createElement("div");
    const onSignedIn = vi.fn();
    const ready = initializeGoogleSignIn(parent, onSignedIn);
    expect(created).toHaveLength(1);

    const initialize = vi.fn();
    const renderButton = vi.fn();
    const prompt = vi.fn();
    (window as { google?: unknown }).google = {
      accounts: { id: { initialize, renderButton, prompt } },
    };
    created[0].dispatchEvent(new Event("load"));

    await ready;
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "test-client-id" }),
    );
    expect(renderButton).toHaveBeenCalledWith(parent, expect.anything());
    expect(prompt).toHaveBeenCalledTimes(1);

    const { callback } = initialize.mock.calls[0][0] as {
      callback: (response: { credential?: string }) => void;
    };
    callback({
      credential: fakeToken({ sub: "user-9", email: "zed@example.com", name: "Zed" }),
    });

    expect(onSignedIn).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "user-9", email: "zed@example.com" }),
    );
    expect(sessionStorage.getItem("polaris.idToken")).toContain("header.");
  });

  it("rejects when the script fails to load", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id");
    vi.resetModules();
    const created = interceptScript();
    const { initializeGoogleSignIn } = await import("./auth");

    const ready = initializeGoogleSignIn(document.createElement("div"), vi.fn());
    created[0].dispatchEvent(new Event("error"));

    await expect(ready).rejects.toThrow("Failed to load Google Identity Services");
  });

  it("rejects when Google Identity Services is unavailable after load", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id");
    vi.resetModules();
    const created = interceptScript();
    const { initializeGoogleSignIn } = await import("./auth");

    const ready = initializeGoogleSignIn(document.createElement("div"), vi.fn());
    created[0].dispatchEvent(new Event("load"));

    await expect(ready).rejects.toThrow("Google Identity Services unavailable");
  });

  it("skips script loading when Google Identity Services is already present", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id");
    vi.resetModules();
    const created = interceptScript();
    const initialize = vi.fn();
    const renderButton = vi.fn();
    const prompt = vi.fn();
    (window as { google?: unknown }).google = {
      accounts: { id: { initialize, renderButton, prompt } },
    };
    const { initializeGoogleSignIn } = await import("./auth");

    await initializeGoogleSignIn(document.createElement("div"), vi.fn());

    expect(created).toHaveLength(0);
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("reuses the pending script promise across calls", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id");
    vi.resetModules();
    const created = interceptScript();
    const { initializeGoogleSignIn } = await import("./auth");

    const first = initializeGoogleSignIn(document.createElement("div"), vi.fn());
    const second = initializeGoogleSignIn(document.createElement("div"), vi.fn());
    expect(created).toHaveLength(1);

    (window as { google?: unknown }).google = {
      accounts: { id: { initialize: vi.fn(), renderButton: vi.fn(), prompt: vi.fn() } },
    };
    created[0].dispatchEvent(new Event("load"));

    await Promise.all([first, second]);
  });

  it("reuses an existing GIS script tag", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id");
    const existing = document.createElement("script");
    existing.src = "https://accounts.google.com/gsi/client";
    document.head.appendChild(existing);
    vi.resetModules();
    const created = interceptScript();
    const { initializeGoogleSignIn } = await import("./auth");

    const ready = initializeGoogleSignIn(document.createElement("div"), vi.fn());
    expect(created).toHaveLength(0);

    (window as { google?: unknown }).google = {
      accounts: { id: { initialize: vi.fn(), renderButton: vi.fn(), prompt: vi.fn() } },
    };
    existing.dispatchEvent(new Event("load"));

    await ready;
  });
});
