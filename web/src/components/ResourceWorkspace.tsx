import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import type { Catalog, ResourceRecord } from "../types";

export interface WorkspaceColumn<T> {
  header: string;
  render: (item: T) => ReactNode;
}

interface Props<T extends ResourceRecord> {
  catalog: Catalog;
  title: string;
  description: string;
  icon: ReactNode;
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptyBody: string;
  createLabel: string;
  columns: WorkspaceColumn<T>[];
  gridTemplate: string;
  fetcher: (squadId: string) => Promise<{ items: T[] }>;
  renderCreateDialog: (
    squadId: string,
    handlers: { onClose: () => void; onCreated: () => void },
  ) => ReactNode;
}

/**
 * Shared squad-scoped "list + create" layout used by the Fitness Targets,
 * Measurement Sources, and Measurement Producers workspaces. Each of those
 * only differs in its columns, fetcher, and create-dialog form.
 */
export function ResourceWorkspace<T extends ResourceRecord>({
  catalog,
  title,
  description,
  icon,
  emptyIcon,
  emptyTitle,
  emptyBody,
  createLabel,
  columns,
  gridTemplate,
  fetcher,
  renderCreateDialog,
}: Props<T>) {
  const [squadId, setSquadId] = useState(catalog.squads[0]?.id ?? "");
  const [createOpen, setCreateOpen] = useState(false);
  const query = useQuery({
    queryKey: ["workspace", title, squadId],
    queryFn: () => fetcher(squadId),
    enabled: Boolean(squadId),
  });

  const items = query.data?.items ?? [];

  return (
    <div className="content">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Architecture intelligence</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <button
          className="button primary"
          onClick={() => setCreateOpen(true)}
          disabled={!squadId}
        >
          <Plus size={17} /> {createLabel}
        </button>
      </section>

      {catalog.squads.length === 0 ? (
        <section className="empty-state onboarding-empty">
          <div>{icon}</div>
          <h2>Set up a squad first</h2>
          <p>{title} belong to a squad. Create one from Settings.</p>
        </section>
      ) : (
        <section className="catalog-panel">
          <div className="workspace-toolbar">
            <label className="filter-select">
              <span>{catalog.squads.find((candidate) => candidate.id === squadId)?.data.name as string ?? "Squad"}</span>
              <select
                value={squadId}
                onChange={(event) => setSquadId(event.target.value)}
                aria-label="Squad"
              >
                {catalog.squads.map((squad) => (
                  <option value={squad.id} key={squad.id}>
                    {String(squad.data.name ?? "Unnamed squad")} · {squad.tribeName}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
            {query.isFetching && <LoaderCircle className="spin" size={16} />}
          </div>

          {query.isLoading && (
            <div className="loading-state">
              <LoaderCircle className="spin" size={22} />
              <div>
                <strong>Loading {title.toLowerCase()}</strong>
                <span>Fetching from Polaris API…</span>
              </div>
            </div>
          )}

          {query.isError && (
            <div className="error-state">
              <AlertTriangle size={22} />
              <div>
                <h2>Could not load {title.toLowerCase()}</h2>
                <p>{(query.error as Error).message}</p>
              </div>
              <button className="button secondary" onClick={() => query.refetch()}>
                <RefreshCw size={16} /> Retry
              </button>
            </div>
          )}

          {!query.isLoading && !query.isError && items.length === 0 && (
            <section className="empty-state">
              <div>{emptyIcon}</div>
              <h2>{emptyTitle}</h2>
              <p>{emptyBody}</p>
              <button className="button primary" onClick={() => setCreateOpen(true)}>
                <Plus size={16} /> {createLabel}
              </button>
            </section>
          )}

          {!query.isLoading && !query.isError && items.length > 0 && (
            <div className="simple-table" role="table" aria-label={title}>
              <div className="simple-head" role="row" style={{ gridTemplateColumns: gridTemplate }}>
                {columns.map((column) => (
                  <span role="columnheader" key={column.header}>{column.header}</span>
                ))}
              </div>
              {items.map((item) => (
                <div className="simple-row" role="row" style={{ gridTemplateColumns: gridTemplate }} key={item.id}>
                  {columns.map((column) => (
                    <span role="cell" key={column.header}>{column.render(item)}</span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {createOpen && squadId && renderCreateDialog(squadId, {
        onClose: () => setCreateOpen(false),
        onCreated: () => {
          setCreateOpen(false);
          void query.refetch();
        },
      })}
    </div>
  );
}
