import type { Catalog, FitnessDefinition, FitnessFunction } from "./types";

export function activeDefinition(fn: FitnessFunction): FitnessDefinition | undefined {
  const active = fn.versions.find((version) => version.number === fn.activeVersion);
  return active?.definition ?? fn.versions.at(-1)?.definition;
}

export function searchableText(fn: FitnessFunction, catalog: Catalog): string {
  const definition = activeDefinition(fn);
  const squad = catalog.squads.find((item) => item.id === fn.ownerSquadId);
  return [
    fn.id,
    definition?.name,
    definition?.purpose,
    definition?.objective,
    definition?.characteristic,
    definition?.enforcement,
    definition?.acquisition.mode,
    squad?.data.name,
    squad?.tribeName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

export function matchesQuery(
  fn: FitnessFunction,
  catalog: Catalog,
  query: string,
): boolean {
  const terms = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const haystack = searchableText(fn, catalog);
  return terms.every((term) => haystack.includes(term));
}

export function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function relativeTime(value?: string): string {
  if (!value) return "Not activated";
  const difference = Date.now() - new Date(value).getTime();
  const days = Math.floor(difference / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? "month" : "months"} ago`;
}
