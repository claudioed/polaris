import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  DatabaseZap,
  Gauge,
  ShieldCheck,
  Target,
  X,
} from "lucide-react";
import type { Catalog, FitnessFunction } from "../types";
import { activeDefinition, relativeTime } from "../utils";

interface Props {
  item: FitnessFunction;
  catalog: Catalog;
  onClose: () => void;
}

export function FitnessDetails({ item, catalog, onClose }: Props) {
  const definition = activeDefinition(item);
  const squad = catalog.squads.find((candidate) => candidate.id === item.ownerSquadId);
  const activeVersion = item.versions.find((version) => version.number === item.activeVersion);

  if (!definition) return null;

  return (
    <aside className="details-panel" aria-label={`${definition.name} details`}>
      <header className="details-header">
        <div>
          <span className={`status-pill ${item.lifecycle.toLowerCase()}`}>
            <i /> {item.lifecycle}
          </span>
          <h2>{definition.name}</h2>
          <p>{String(squad?.data.name ?? "Unknown squad")} · {squad?.tribeName}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close details">
          <X size={18} />
        </button>
      </header>

      <div className="details-scroll">
        <section className="detail-summary">
          <p className="eyebrow">Architectural objective</p>
          <p>{definition.objective}</p>
        </section>

        <div className="details-metrics">
          <div>
            <ShieldCheck size={17} />
            <span>Enforcement</span>
            <strong>{definition.enforcement}</strong>
          </div>
          <div>
            <DatabaseZap size={17} />
            <span>Acquisition</span>
            <strong>{definition.acquisition.mode}</strong>
          </div>
          <div>
            <CalendarClock size={17} />
            <span>Last activated</span>
            <strong>{relativeTime(activeVersion?.activatedAt)}</strong>
          </div>
          <div>
            <Activity size={17} />
            <span>Freshness</span>
            <strong>{Math.round(definition.freshnessSeconds / 60)} min</strong>
          </div>
        </div>

        <section className="detail-section">
          <div className="detail-section-title">
            <div>
              <p className="eyebrow">Evaluation rules</p>
              <h3>{definition.criteria.length} {definition.criteria.length === 1 ? "criterion" : "criteria"}</h3>
            </div>
            <Gauge size={19} />
          </div>
          <div className="criterion-cards">
            {definition.criteria.map((criterion) => (
              <article key={criterion.key}>
                <div>
                  <code>{criterion.key}</code>
                  {criterion.required && <span>Required</span>}
                </div>
                <p>
                  Fail when <strong>{comparisonLabel(criterion.failureComparison)} {criterion.failureValue} {criterion.unit}</strong>
                </p>
                {criterion.warningValue !== undefined && (
                  <small>Warning at {criterion.warningValue} {criterion.unit}</small>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="detail-section">
          <div className="detail-section-title">
            <div>
              <p className="eyebrow">Scope</p>
              <h3>Protected targets</h3>
            </div>
            <Target size={19} />
          </div>
          <div className="target-tags">
            {definition.targetIds.map((id) => <span key={id}>{id.slice(0, 8)}</span>)}
          </div>
        </section>

        <section className="version-track">
          <div className="detail-section-title">
            <div>
              <p className="eyebrow">Definition history</p>
              <h3>{item.versions.length} {item.versions.length === 1 ? "version" : "versions"}</h3>
            </div>
          </div>
          {item.versions.slice().reverse().map((version) => (
            <div className="version-row" key={version.number}>
              <span className={version.state.toLowerCase()} />
              <div>
                <strong>Version {version.number}</strong>
                <p>{version.state} · {new Date(version.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </section>
      </div>

      <footer className="details-footer">
        <a className="button secondary" href={`/api/v1/fitness-functions/${item.id}`} target="_blank" rel="noreferrer">
          Open API resource <ArrowUpRight size={16} />
        </a>
      </footer>
    </aside>
  );
}

function comparisonLabel(value: string): string {
  const labels: Record<string, string> = {
    GREATER_THAN: ">",
    GREATER_THAN_OR_EQUAL: "≥",
    LESS_THAN: "<",
    LESS_THAN_OR_EQUAL: "≤",
    EQUAL: "=",
    NOT_EQUAL: "≠",
  };
  return labels[value] ?? value;
}
