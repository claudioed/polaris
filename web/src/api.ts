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

const API_BASE = "/api/v1";

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

export async function loadCatalog(): Promise<Catalog> {
  const tribesPage = await request<Page<ResourceRecord>>("/tribes?limit=200");
  const squadGroups = await Promise.all(
    tribesPage.items.map(async (tribe) => {
      const page = await request<Page<ResourceRecord>>(
        `/tribes/${encodeURIComponent(tribe.id)}/squads?limit=200`,
      );
      return page.items.map(
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
    squads.map(async (squad) => {
      const page = await request<Page<FitnessFunction>>(
        `/squads/${encodeURIComponent(squad.id)}/fitness-functions?limit=200`,
      );
      return page.items;
    }),
  );

  return {
    tribes: tribesPage.items,
    squads,
    functions: functionGroups.flat(),
  };
}

export function getSquadTargets(squadId: string): Promise<Page<ResourceRecord>> {
  return request(`/squads/${encodeURIComponent(squadId)}/fitness-targets?limit=200`);
}

export function getSquadSources(squadId: string): Promise<Page<ResourceRecord>> {
  return request(`/squads/${encodeURIComponent(squadId)}/measurement-sources?limit=200`);
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
  data: { name: string; type: string; description?: string },
): Promise<ResourceRecord> {
  return request(`/squads/${encodeURIComponent(squadId)}/fitness-targets`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
