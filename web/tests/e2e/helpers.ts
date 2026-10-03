import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, Page } from "@playwright/test";

export interface Handoff {
  spaUrl: string;
  apiUrl: string;
  ingestKey: string;
  validToken: string;
  intruderToken: string;
  expiredToken: string;
}

const handoffPath = join(dirname(fileURLToPath(import.meta.url)), ".stack.json");

export function handoff(): Handoff {
  return JSON.parse(readFileSync(handoffPath, "utf8")) as Handoff;
}

/** Injects a minted ID token so the SPA boots already signed in. */
export async function signInAs(page: Page, token: string): Promise<void> {
  await page.addInitScript(
    (value) => sessionStorage.setItem("polaris.idToken", value),
    token,
  );
}

export interface Workspace {
  tribeId: string;
  squadId: string;
  targetId: string;
  producerId: string;
}

/** Seeds a minimal PUSH workspace through the business API. */
export async function seedWorkspace(label: string): Promise<Workspace> {
  const { apiUrl, validToken } = handoff();
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${apiUrl}/api/v1${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${validToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`seed ${path} failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as { id: string };
  };

  const tribe = await post("/tribes", { name: `Tribe ${label}` });
  const squad = await post(`/tribes/${tribe.id}/squads`, { name: `Squad ${label}` });
  const target = await post(`/squads/${squad.id}/fitness-targets`, {
    name: `Target ${label}`,
    kind: "SERVICE",
  });
  const producer = await post(`/squads/${squad.id}/measurement-producers`, {
    name: `Producer ${label}`,
  });
  return { tribeId: tribe.id, squadId: squad.id, targetId: target.id, producerId: producer.id };
}

/** Raw fetch against the API for seeding, with the minted business token. */
export async function apiPost(path: string, body: unknown): Promise<Response> {
  const { apiUrl, validToken } = handoff();
  return fetch(`${apiUrl}/api/v1${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${validToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getSecurityHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const response = await request.get(`${handoff().spaUrl}/`);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers())) {
    headers[name] = value as string;
  }
  return headers;
}
