import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Building2, ChevronDown, CircleAlert, LoaderCircle, Plus, Users, X } from "lucide-react";
import { createSquad, createTribe } from "../api";
import type { Catalog } from "../types";

interface Props {
  catalog: Catalog;
  onCreated: () => void;
}

/**
 * Tribes and squads are the organizational structure every other
 * workspace hangs off of, but the only place that could create them was
 * the one-time onboarding gate in SetupWorkspace (shown only while
 * catalog.squads.length === 0). Once a workspace had its first squad,
 * there was no way to add a second tribe or squad at all. This gives
 * that a permanent home.
 */
export function SettingsWorkspace({ catalog, onCreated }: Props) {
  return (
    <div className="content">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Organization</p>
          <h1>Settings</h1>
          <p>Manage the tribes and squads that own fitness functions.</p>
        </div>
      </section>

      <TribesPanel catalog={catalog} onCreated={onCreated} />
      <SquadsPanel catalog={catalog} onCreated={onCreated} />
    </div>
  );
}

function TribesPanel({ catalog, onCreated }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) throw new Error("Enter a tribe name.");
      await createTribe({ name: name.trim(), description: description.trim() || undefined });
    },
    onSuccess: () => {
      setCreateOpen(false);
      setName("");
      setDescription("");
      setError("");
      onCreated();
    },
    onError: (failure: Error) => setError(failure.message),
  });

  return (
    <section className="catalog-panel">
      <div className="workspace-toolbar">
        <span><Building2 size={16} /> Tribes</span>
        <button className="button primary" onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> New tribe
        </button>
      </div>

      {catalog.tribes.length === 0 ? (
        <section className="empty-state">
          <div><Building2 size={22} /></div>
          <h2>No tribes yet</h2>
          <p>A tribe is the top-level owner for one or more squads.</p>
        </section>
      ) : (
        <div className="simple-table" role="table" aria-label="Tribes">
          <div className="simple-head" role="row" style={{ gridTemplateColumns: "minmax(220px, 2fr) 1fr" }}>
            <span role="columnheader">Name</span>
            <span role="columnheader">Description</span>
          </div>
          {catalog.tribes.map((tribe) => (
            <div className="simple-row" role="row" style={{ gridTemplateColumns: "minmax(220px, 2fr) 1fr" }} key={tribe.id}>
              <span role="cell">{String(tribe.data.name ?? "Unnamed tribe")}</span>
              <span role="cell">{String(tribe.data.description ?? "—")}</span>
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="new-tribe-title">
            <header className="dialog-header">
              <div><h2 id="new-tribe-title">New tribe</h2></div>
              <button className="icon-button" type="button" onClick={() => setCreateOpen(false)} aria-label="Close">
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
                  <span>Tribe name</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Digital Commerce" autoFocus />
                </label>
                <label className="field">
                  <span>Description</span>
                  <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" />
                </label>
                {error && (
                  <div className="form-alert" role="alert">
                    <CircleAlert size={17} />
                    <span>{error}</span>
                  </div>
                )}
              </div>
              <footer className="dialog-footer">
                <button type="button" className="button ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
                <button type="submit" className="button primary" disabled={mutation.isPending}>
                  {mutation.isPending ? <LoaderCircle size={17} className="spin" /> : <Plus size={16} />}
                  Create tribe
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

function SquadsPanel({ catalog, onCreated }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [tribeId, setTribeId] = useState(catalog.tribes[0]?.id ?? "");
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (!tribeId) throw new Error("Create a tribe first.");
      if (name.trim().length < 2) throw new Error("Enter a squad name.");
      await createSquad(tribeId, { name: name.trim(), mission: mission.trim() || undefined });
    },
    onSuccess: () => {
      setCreateOpen(false);
      setName("");
      setMission("");
      setError("");
      onCreated();
    },
    onError: (failure: Error) => setError(failure.message),
  });

  return (
    <section className="catalog-panel">
      <div className="workspace-toolbar">
        <span><Users size={16} /> Squads</span>
        <button
          className="button primary"
          onClick={() => {
            setTribeId(catalog.tribes[0]?.id ?? "");
            setCreateOpen(true);
          }}
          disabled={catalog.tribes.length === 0}
          title={catalog.tribes.length === 0 ? "Create a tribe first" : undefined}
        >
          <Plus size={16} /> New squad
        </button>
      </div>

      {catalog.squads.length === 0 ? (
        <section className="empty-state">
          <div><Users size={22} /></div>
          <h2>No squads yet</h2>
          <p>A squad owns the fitness functions, targets, sources, and producers it defines.</p>
        </section>
      ) : (
        <div className="simple-table" role="table" aria-label="Squads">
          <div className="simple-head" role="row" style={{ gridTemplateColumns: "minmax(220px, 2fr) 1fr" }}>
            <span role="columnheader">Name</span>
            <span role="columnheader">Tribe</span>
          </div>
          {catalog.squads.map((squad) => (
            <div className="simple-row" role="row" style={{ gridTemplateColumns: "minmax(220px, 2fr) 1fr" }} key={squad.id}>
              <span role="cell">{String(squad.data.name ?? "Unnamed squad")}</span>
              <span role="cell">{squad.tribeName}</span>
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="new-squad-title">
            <header className="dialog-header">
              <div><h2 id="new-squad-title">New squad</h2></div>
              <button className="icon-button" type="button" onClick={() => setCreateOpen(false)} aria-label="Close">
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
                  <span>Tribe</span>
                  <div className="select-wrap">
                    <select value={tribeId} onChange={(event) => setTribeId(event.target.value)}>
                      {catalog.tribes.map((tribe) => (
                        <option value={tribe.id} key={tribe.id}>
                          {String(tribe.data.name ?? "Unnamed tribe")}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={16} />
                  </div>
                </label>
                <label className="field">
                  <span>Squad name</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Checkout Experience" autoFocus />
                </label>
                <label className="field">
                  <span>Squad mission</span>
                  <input value={mission} onChange={(event) => setMission(event.target.value)} placeholder="Optional mission statement" />
                </label>
                {error && (
                  <div className="form-alert" role="alert">
                    <CircleAlert size={17} />
                    <span>{error}</span>
                  </div>
                )}
              </div>
              <footer className="dialog-footer">
                <button type="button" className="button ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
                <button type="submit" className="button primary" disabled={mutation.isPending}>
                  {mutation.isPending ? <LoaderCircle size={17} className="spin" /> : <Plus size={16} />}
                  Create squad
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
