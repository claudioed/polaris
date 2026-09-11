import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSquadTargets } from "./api";

function fakeToken(): string {
  const payload = btoa(JSON.stringify({ sub: "user-1" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("api authentication", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the bearer token to requests", async () => {
    sessionStorage.setItem("polaris.idToken", fakeToken());
    const fetchMock = mockFetch(200, { items: [] });
    vi.stubGlobal("fetch", fetchMock);

    await getSquadTargets("squad-1");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${fakeToken()}`);
  });

  it("omits the header when signed out", async () => {
    const fetchMock = mockFetch(401, { title: "Unauthorized" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSquadTargets("squad-1")).rejects.toMatchObject({ status: 401 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
    expect(sessionStorage.getItem("polaris.idToken")).toBeNull();
  });

  it("clears the session when the API rejects the token", async () => {
    sessionStorage.setItem("polaris.idToken", fakeToken());
    vi.stubGlobal("fetch", mockFetch(401, { title: "Unauthorized" }));

    await expect(getSquadTargets("squad-1")).rejects.toMatchObject({ status: 401 });
    expect(sessionStorage.getItem("polaris.idToken")).toBeNull();
  });

  it("clears the session when the Google account is not authorized", async () => {
    sessionStorage.setItem("polaris.idToken", fakeToken());
    vi.stubGlobal("fetch", mockFetch(403, { title: "Forbidden", code: "FORBIDDEN" }));

    await expect(getSquadTargets("squad-1")).rejects.toMatchObject({ status: 403 });
    expect(sessionStorage.getItem("polaris.idToken")).toBeNull();
  });
});
