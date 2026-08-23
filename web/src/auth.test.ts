import { beforeEach, describe, expect, it, vi } from "vitest";
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
});
