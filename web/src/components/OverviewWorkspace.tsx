import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Gauge, LoaderCircle } from "lucide-react";
import { getSquadFitnessOverview, getTribeFitnessOverview } from "../api";
import type { Catalog, FitnessFunction } from "../types";
import { activeDefinition, relativeTime } from "../utils";

interface Props {
  catalog: Catalog;
}

interface Tally {
  active: number;
  draft: number;
  blocking: number;
  pull: number;
}

function tally(functions: FitnessFunction[]): Tally {
  return functions.reduce<Tally>(
    (acc, item) => {
      if (item.lifecycle === "ACTIVE") acc.active += 1;
      if (item.lifecycle === "DRAFT") acc.draft += 1;
      const definition = activeDefinition(item);
      if (definition?.enforcement === "BLOCK") acc.blocking += 1;
      if (definition?.acquisition.mode === "PULL") acc.pull += 1;
      return acc;
    },
    { active: 0, draft: 0, blocking: 0, pull: 0 },
  );
}

/**
 * Polaris's `/fitness-overview` endpoints are deliberately thin (scope,
 * generatedAt, status) — "it surfaces outcomes without collapsing them into
 * a single universal score" per the API docs. The counts here are computed
 * client-side from the catalog already loaded for every other workspace;
 * the overview endpoint is used only for its freshness signal.
 */
export function OverviewWorkspace({ catalog }: Props) {
  return (
    <div className="content">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Architecture intelligence</p>
          <h1>Insights</h1>
          <p>Aggregated architectural fitness per squad and tribe, computed from retained evaluations.</p>
        </div>
      </section>

      <section className="detail-section" style={{ paddingTop: 0 }}>
        <div className="detail-section-title">
          <div>
            <p className="eyebrow">By squad</p>
            <h3>{catalog.squads.length} {catalog.squads.length === 1 ? "squad" : "squads"}</h3>
          </div>
        </div>
        {catalog.squads.length === 0 ? (
          <p className="empty-inline">No squads yet.</p>
        ) : (
          <div className="scorecard-grid">
            {catalog.squads.map((squad) => (
              <SquadScorecard
                key={squad.id}
                name={String(squad.data.name ?? "Unnamed squad")}
                subtitle={squad.tribeName}
                squadId={squad.id}
                tally={tally(catalog.functions.filter((item) => item.ownerSquadId === squad.id))}
              />
            ))}
          </div>
        )}
      </section>

      <section className="detail-section">
        <div className="detail-section-title">
          <div>
            <p className="eyebrow">By tribe</p>
            <h3>{catalog.tribes.length} {catalog.tribes.length === 1 ? "tribe" : "tribes"}</h3>
          </div>
        </div>
        {catalog.tribes.length === 0 ? (
          <p className="empty-inline">No tribes yet.</p>
        ) : (
          <div className="scorecard-grid">
            {catalog.tribes.map((tribe) => {
              const squadIds = new Set(catalog.squads.filter((squad) => squad.tribeId === tribe.id).map((squad) => squad.id));
              return (
                <TribeScorecard
                  key={tribe.id}
                  name={String(tribe.data.name ?? "Unnamed tribe")}
                  tribeId={tribe.id}
                  squadCount={squadIds.size}
                  tally={tally(catalog.functions.filter((item) => squadIds.has(item.ownerSquadId)))}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function ScorecardStats({ value }: { value: Tally }) {
  return (
    <dl className="review-grid">
      <div><dt>Active</dt><dd>{value.active}</dd></div>
      <div><dt>Draft</dt><dd>{value.draft}</dd></div>
      <div><dt>Blocking</dt><dd>{value.blocking}</dd></div>
      <div><dt>Pull</dt><dd>{value.pull}</dd></div>
    </dl>
  );
}

function OverviewFreshness({ query }: { query: { isLoading: boolean; isError: boolean; error: unknown; data?: { generatedAt: string } } }) {
  if (query.isLoading) {
    return <small className="scorecard-freshness"><LoaderCircle size={11} className="spin" /> Checking freshness…</small>;
  }
  if (query.isError) {
    return (
      <small className="scorecard-freshness scorecard-freshness-error">
        <CircleAlert size={11} /> {query.error instanceof Error ? query.error.message : "Could not reach Polaris"}
      </small>
    );
  }
  return <small className="scorecard-freshness">Insights generated {relativeTime(query.data?.generatedAt)}</small>;
}

function SquadScorecard({
  name,
  subtitle,
  squadId,
  tally: value,
}: {
  name: string;
  subtitle: string;
  squadId: string;
  tally: Tally;
}) {
  const overviewQuery = useQuery({
    queryKey: ["squad-fitness-overview", squadId],
    queryFn: () => getSquadFitnessOverview(squadId),
  });

  return (
    <article className="scorecard">
      <header>
        <Gauge size={16} />
        <div>
          <strong>{name}</strong>
          <small>{subtitle}</small>
        </div>
      </header>
      <ScorecardStats value={value} />
      <OverviewFreshness query={overviewQuery} />
    </article>
  );
}

function TribeScorecard({
  name,
  tribeId,
  squadCount,
  tally: value,
}: {
  name: string;
  tribeId: string;
  squadCount: number;
  tally: Tally;
}) {
  const overviewQuery = useQuery({
    queryKey: ["tribe-fitness-overview", tribeId],
    queryFn: () => getTribeFitnessOverview(tribeId),
  });

  return (
    <article className="scorecard">
      <header>
        <Gauge size={16} />
        <div>
          <strong>{name}</strong>
          <small>{squadCount} {squadCount === 1 ? "squad" : "squads"}</small>
        </div>
      </header>
      <ScorecardStats value={value} />
      <OverviewFreshness query={overviewQuery} />
    </article>
  );
}
