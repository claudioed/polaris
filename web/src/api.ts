import { currentToken, signOut } from "./auth";
import type {
  Catalog,
  FitnessDefinition,
  FitnessFunction,
  Page,
  Problem,
  ResourceRecord,
  Squad,
} from "./types";

const API_BASE: string = import.meta.env.VITE_API_BASE || "/api/v1";

export class ApiError extends Error {
  status: number;
  problem?: Problem;

  constructor(status: number, problem?: Problem) {
    super(problem?.detail || problem?.title || `Polaris request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = currentToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 401 || response.status === 403) {
    signOut();
  }

  if (!response.ok) {
    let problem: Problem | undefined;
    try {
      problem = (await response.json()) as Problem;
    } catch {
      problem = undefined;
    }
    throw new ApiError(response.status, problem);
  }

  return (await response.json()) as T;
}

const MAX_PAGES = 100;

/**
 * Collects every item of a cursor-paginated collection. The API caps pages at
 * 200 items, so following `nextCursor` is required to see complete lists.
 */
async function listAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let requestCount = 0; requestCount < MAX_PAGES; requestCount += 1) {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor !== undefined) params.set("cursor", cursor);
    const result = await request<Page<T>>(`${path}?${params.toString()}`);
    items.push(...result.items);
    if (result.nextCursor === undefined) return items;
    cursor = result.nextCursor;
  }
  throw new Error(`Pagination for ${path} exceeded ${MAX_PAGES} pages`);
}

export async function loadCatalog(): Promise<Catalog> {
  const tribes = await listAll<ResourceRecord>("/tribes");
  const squadGroups = await Promise.all(
    tribes.map(async (tribe) => {
      const items = await listAll<ResourceRecord>(
        `/tribes/${encodeURIComponent(tribe.id)}/squads`,
      );
      return items.map(
        (squad): Squad => ({
          ...squad,
          tribeId: tribe.id,
          tribeName: String(tribe.data.name ?? "Unnamed tribe"),
        }),
      );
    }),
  );
  const squads = squadGroups.flat();
  const functionGroups = await Promise.all(
    squads.map((squad) =>
      listAll<FitnessFunction>(`/squads/${encodeURIComponent(squad.id)}/fitness-functions`),
    ),
  );

  return {
    tribes,
    squads,
    functions: functionGroups.flat(),
  };
}

export async function getSquadTargets(squadId: string): Promise<Page<ResourceRecord>> {
  return {
    items: await listAll(`/squads/${encodeURIComponent(squadId)}/fitness-targets`),
  };
}

export async function getSquadSources(squadId: string): Promise<Page<ResourceRecord>> {
  return {
    items: await listAll(`/squads/${encodeURIComponent(squadId)}/measurement-sources`),
  };
}

export function createFitnessFunction(
  squadId: string,
  definition: FitnessDefinition,
): Promise<FitnessFunction> {
  return request(`/squads/${encodeURIComponent(squadId)}/fitness-functions`, {
    method: "POST",
    body: JSON.stringify(definition),
  });
}

export function activateFitnessFunction(id: string, version: number): Promise<FitnessFunction> {
  return request(
    `/fitness-functions/${encodeURIComponent(id)}/versions/${version}/activations`,
    {
      method: "POST",
      body: JSON.stringify({ rationale: "Activated from Polaris Control Tower" }),
    },
  );
}

/** Appends a draft version; the API guards this with `If-Match: "<revision>"`. */
export function createFitnessFunctionVersion(
  fitnessFunctionId: string,
  revision: number,
  definition: FitnessDefinition,
): Promise<FitnessFunction> {
  return request(`/fitness-functions/${encodeURIComponent(fitnessFunctionId)}/versions`, {
    method: "POST",
    headers: { "If-Match": `"${revision}"` },
    body: JSON.stringify(definition),
  });
}

export function createTribe(data: {
  name: string;
  description?: string;
}): Promise<ResourceRecord> {
  return request("/tribes", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function createSquad(
  tribeId: string,
  data: { name: string; mission?: string },
): Promise<ResourceRecord> {
  return request(`/tribes/${encodeURIComponent(tribeId)}/squads`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function createFitnessTarget(
  squadId: string,
  data: { name: string; kind?: string; description?: string },
): Promise<ResourceRecord> {
  return request(`/squads/${encodeURIComponent(squadId)}/fitness-targets`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function createMeasurementSource(
  squadId: string,
  data: { name: string; providerType: string; baseUrl: string; description?: string },
): Promise<ResourceRecord> {
  return request(`/squads/${encodeURIComponent(squadId)}/measurement-sources`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function checkSourceConnection(sourceId: string): Promise<ResourceRecord> {
  return request(`/measurement-sources/${encodeURIComponent(sourceId)}/connection-checks`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getSquadProducers(squadId: string): Promise<Page<ResourceRecord>> {
  return {
    items: await listAll(`/squads/${encodeURIComponent(squadId)}/measurement-producers`),
  };
}

export function createMeasurementProducer(
  squadId: string,
  data: { name: string; description?: string },
): Promise<ResourceRecord> {
  return request(`/squads/${encodeURIComponent(squadId)}/measurement-producers`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
