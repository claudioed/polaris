import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Blocks, Check, ChevronDown, CircleAlert, LoaderCircle, Plus, X } from "lucide-react";
import { adoptFitnessFunctionTemplate, createFitnessFunctionTemplate, listFitnessFunctionTemplates } from "../api";
import type { Catalog, FitnessFunctionTemplate } from "../types";
import { relativeTime } from "../utils";

interface Props {
  catalog: Catalog;
}

/**
 * Templates are published per tribe (not per squad, unlike every other
 * resource workspace), so this doesn't reuse ResourceWorkspace — the picker
 * here is a tribe, and "adopting" a template targets a squad within it.
 */
export function TemplatesWorkspace({ catalog }: Props) {
  const [tribeId, setTribeId] = useState(catalog.tribes[0]?.id ?? "");
  const [createOpen, setCreateOpen] = useState(false);
  const [adopting, setAdopting] = useState<FitnessFunctionTemplate>();

  const query = useQuery({
    queryKey: ["fitness-function-templates", tribeId],
    queryFn: () => listFitnessFunctionTemplates(tribeId),
    enabled: Boolean(tribeId),
  });

  const squadsInTribe = catalog.squads.filter((squad) => squad.tribeId === tribeId);
  const templates = query.data ?? [];

  return (
    <div className="content">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Governance</p>
          <h1>Fitness function templates</h1>
          <p>Tribe-published reusable definitions. Adoption always creates a squad-owned draft — the tribe never takes ownership.</p>
        </div>
        <button className="button primary" onClick={() => setCreateOpen(true)} disabled={!tribeId}>
          <Plus size={17} /> New template
        </button>
      </section>

      {catalog.tribes.length === 0 ? (
        <section className="empty-state onboarding-empty">
          <div><Blocks size={23} /></div>
          <h2>Set up a tribe first</h2>
          <p>Templates belong to a tribe. Create one from Settings.</p>
        </section>
      ) : (
        <section className="catalog-panel">
          <div className="workspace-toolbar">
            <label className="filter-select">
              <span>{catalog.tribes.find((candidate) => candidate.id === tribeId)?.data.name as string ?? "Tribe"}</span>
              <select value={tribeId} onChange={(event) => setTribeId(event.target.value)} aria-label="Tribe">
                {catalog.tribes.map((tribe) => (
                  <option value={tribe.id} key={tribe.id}>{String(tribe.data.name ?? "Unnamed tribe")}</option>
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
                <strong>Loading templates</strong>
                <span>Fetching from Polaris API…</span>
              </div>
            </div>
          )}

          {query.isError && (
            <div className="error-state">
              <CircleAlert size={22} />
              <div>
                <h2>Could not load templates</h2>
                <p>{(query.error as Error).message}</p>
              </div>
            </div>
          )}

          {!query.isLoading && !query.isError && templates.length === 0 && (
            <section className="empty-state">
              <div><Blocks size={23} /></div>
              <h2>No templates published yet</h2>
              <p>Publish a reusable definition so squads in this tribe can adopt it.</p>
              <button className="button primary" onClick={() => setCreateOpen(true)}>
                <Plus size={16} /> New template
              </button>
            </section>
          )}

          {!query.isLoading && !query.isError && templates.length > 0 && (
            <div className="simple-table" role="table" aria-label="Fitness function templates">
              <div className="simple-head" role="row" style={{ gridTemplateColumns: "minmax(200px, 2fr) 2fr 150px 150px" }}>
                <span role="columnheader">Template</span>
                <span role="columnheader">Description</span>
                <span role="columnheader">Published</span>
                <span role="columnheader" />
              </div>
              {templates.map((template) => (
                <div className="simple-row" role="row" style={{ gridTemplateColumns: "minmax(200px, 2fr) 2fr 150px 150px" }} key={template.id}>
                  <span role="cell">
                    <span className="simple-cell">
                      <strong>{template.data.name}</strong>
                      <small>{template.id}</small>
                    </span>
                  </span>
                  <span role="cell">{template.data.description ?? ""}</span>
                  <span role="cell">{relativeTime(template.createdAt)}</span>
                  <span role="cell">
                    <button
                      className="button secondary small row-action"
                      type="button"
                      onClick={() => setAdopting(template)}
                      disabled={squadsInTribe.length === 0}
                      title={squadsInTribe.length === 0 ? "This tribe has no squads to adopt into yet" : undefined}
                    >
                      Adopt
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {createOpen && tribeId && (
        <CreateTemplateDialog
          tribeId={tribeId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void query.refetch();
          }}
        />
      )}

      {adopting && (
        <AdoptTemplateDialog
          template={adopting}
          squads={squadsInTribe}
          onClose={() => setAdopting(undefined)}
        />
      )}
    </div>
  );
}

function CreateTemplateDialog({
  tribeId,
  onClose,
  onCreated,
}: {
  tribeId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 1) throw new Error("Enter a template name.");
      return createFitnessFunctionTemplate(tribeId, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
    },
    onSuccess: onCreated,
    onError: (failure) => setError(failure.message),
  });

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="template-dialog-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">New tribe template</p>
            <h2 id="template-dialog-title">Publish a reusable definition</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            mutation.mutate();
          }}
        >
          <div className="setup-fields">
            <label className="field">
              <span>Template name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Resilience baseline" autoFocus />
              <small>Unique within the tribe.</small>
            </label>
            <label className="field">
              <span>Description</span>
              <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="When squads should adopt this template" />
            </label>
            <small style={{ color: "#8d97a7" }}>
              Adopted drafts start empty; squads fill in criteria and acquisition after adopting.
            </small>
            {error && (
              <div className="form-alert" role="alert">
                <CircleAlert size={17} />
                <span>{error}</span>
              </div>
            )}
          </div>
          <footer className="dialog-footer">
            <button type="button" className="button ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={mutation.isPending}>
              {mutation.isPending ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}
              Publish template
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function AdoptTemplateDialog({
  template,
  squads,
  onClose,
}: {
  template: FitnessFunctionTemplate;
  squads: Catalog["squads"];
  onClose: () => void;
}) {
  const [squadId, setSquadId] = useState(squads[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => adoptFitnessFunctionTemplate(template.id, { squadId, reason: reason.trim() || undefined }),
    onError: (failure) => setError(failure.message),
  });

  if (mutation.isSuccess) {
    const squad = squads.find((candidate) => candidate.id === squadId);
    return (
      <div className="dialog-backdrop" role="presentation">
        <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="adopt-success-title">
          <header className="dialog-header">
            <div>
              <p className="eyebrow">Adopted</p>
              <h2 id="adopt-success-title">Draft created for {String(squad?.data.name ?? "the squad")}</h2>
            </div>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
              <X size={19} />
            </button>
          </header>
          <div className="setup-fields">
            <p className="empty-inline">
              Open Fitness functions for that squad to find and finish the new draft — Polaris doesn't return the
              draft's id directly from this endpoint.
            </p>
          </div>
          <footer className="dialog-footer">
            <span />
            <button type="button" className="button primary" onClick={onClose}>Done</button>
          </footer>
        </section>
      </div>
    );
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="adopt-dialog-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Adopt {String(template.data.name)}</p>
            <h2 id="adopt-dialog-title">Create a squad-owned draft</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            mutation.mutate();
          }}
        >
          <div className="setup-fields">
            <label className="field">
              <span>Adopting squad</span>
              <div className="select-wrap">
                <select value={squadId} onChange={(event) => setSquadId(event.target.value)}>
                  {squads.map((squad) => (
                    <option value={squad.id} key={squad.id}>{String(squad.data.name ?? "Unnamed squad")}</option>
                  ))}
                </select>
              </div>
            </label>
            <label className="field">
              <span>Reason</span>
              <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Optional" />
            </label>
            {error && (
              <div className="form-alert" role="alert">
                <CircleAlert size={17} />
                <span>{error}</span>
              </div>
            )}
          </div>
          <footer className="dialog-footer">
            <button type="button" className="button ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={mutation.isPending}>
              {mutation.isPending ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}
              Adopt template
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
