import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, CircleAlert, History, LoaderCircle, Target, X } from "lucide-react";
import { createFitnessTarget, getFitnessTargetHistory, getSquadTargets, transitionFitnessTarget } from "../api";
import type { Catalog, ResourceRecord } from "../types";
import { relativeTime } from "../utils";
import { ResourceWorkspace } from "./ResourceWorkspace";

interface Props {
  catalog: Catalog;
}

const targetKinds = ["SERVICE", "APPLICATION", "DATA_PRODUCT", "PLATFORM", "COMPONENT"];
const targetLifecycles = ["ACTIVE", "DEPRECATED", "RETIRED"] as const;

export function TargetsWorkspace({ catalog }: Props) {
  return (
    <ResourceWorkspace<ResourceRecord>
      catalog={catalog}
      title="Fitness targets"
      description="The services, applications, and platform capabilities that fitness functions protect."
      icon={<Target size={23} />}
      emptyIcon={<Target size={23} />}
      emptyTitle="No fitness targets yet"
      emptyBody="Register the systems this squad's fitness functions will protect."
      createLabel="New target"
      gridTemplate="minmax(200px, 2fr) 130px 110px 1fr 160px"
      fetcher={getSquadTargets}
      columns={[
        { header: "Target", render: (item) => <TargetCell item={item} /> },
        { header: "Kind", render: (item) => String(item.data.kind ?? "—") },
        {
          header: "Lifecycle",
          render: (item) => (
            <span className={`status-pill ${item.status.toLowerCase()}`}>
              <i /> {item.status}
            </span>
          ),
        },
        { header: "Description", render: (item) => String(item.data.description ?? "") },
        { header: "", render: (item, refetch) => <TargetActions target={item} onChanged={refetch} /> },
      ]}
      renderCreateDialog={(squadId, handlers) => (
        <CreateTargetDialog squadId={squadId} {...handlers} />
      )}
    />
  );
}

function TargetCell({ item }: { item: ResourceRecord }) {
  return (
    <span className="simple-cell">
      <strong>{String(item.data.name ?? "Unnamed target")}</strong>
      <small>{item.id}</small>
    </span>
  );
}

function TargetActions({ target, onChanged }: { target: ResourceRecord; onChanged: () => void }) {
  const [dialog, setDialog] = useState<"history" | "transition" | null>(null);

  return (
    <span className="row-actions">
      <button className="button ghost small" type="button" onClick={() => setDialog("history")}>
        <History size={14} /> History
      </button>
      {target.status !== "RETIRED" && (
        <button className="button ghost small" type="button" onClick={() => setDialog("transition")}>
          Transition
        </button>
      )}
      {dialog === "history" && <TargetHistoryDialog target={target} onClose={() => setDialog(null)} />}
      {dialog === "transition" && (
        <TransitionTargetDialog
          target={target}
          onClose={() => setDialog(null)}
          onTransitioned={() => {
            setDialog(null);
            onChanged();
          }}
        />
      )}
    </span>
  );
}

function TargetHistoryDialog({ target, onClose }: { target: ResourceRecord; onClose: () => void }) {
  const historyQuery = useQuery({
    queryKey: ["fitness-target-history", target.id],
    queryFn: () => getFitnessTargetHistory(target.id),
  });
  const entries = historyQuery.data ?? [];

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="history-dialog-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Fitness history</p>
            <h2 id="history-dialog-title">{String(target.data.name ?? "Target")}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>
        <div className="setup-fields">
          {historyQuery.isLoading && (
            <div className="inline-loading"><LoaderCircle className="spin" size={16} /> Loading history…</div>
          )}
          {historyQuery.isError && (
            <div className="form-alert" role="alert">
              <CircleAlert size={17} />
              <span>{(historyQuery.error as Error).message}</span>
            </div>
          )}
          {!historyQuery.isLoading && !historyQuery.isError && entries.length === 0 && (
            <p className="empty-inline">No fitness history recorded for this target yet.</p>
          )}
          <div className="evaluation-list">
            {entries
              .slice()
              .reverse()
              .map((entry) => (
                <article className="evaluation-row" key={entry.id}>
                  <div>
                    <span className={`status-pill ${entry.status.toLowerCase()}`}>
                      <i /> {entry.status}
                    </span>
                  </div>
                  <p>{relativeTime(entry.createdAt)}</p>
                </article>
              ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function TransitionTargetDialog({
  target,
  onClose,
  onTransitioned,
}: {
  target: ResourceRecord;
  onClose: () => void;
  onTransitioned: () => void;
}) {
  const options = targetLifecycles.filter((status) => status !== target.status);
  const [status, setStatus] = useState<(typeof targetLifecycles)[number]>(options[0] ?? "DEPRECATED");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => transitionFitnessTarget(target.id, status, reason.trim() || undefined),
    onSuccess: onTransitioned,
    onError: (failure) => setError(failure.message),
  });

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="transition-dialog-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Lifecycle transition</p>
            <h2 id="transition-dialog-title">{String(target.data.name ?? "Target")}</h2>
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
              <span>New lifecycle</span>
              <div className="select-wrap">
                <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                  {options.map((option) => (
                    <option value={option} key={option}>{option}</option>
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
              Apply transition
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function CreateTargetDialog({
  squadId,
  onClose,
  onCreated,
}: {
  squadId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("SERVICE");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) throw new Error("Enter a target name.");
      return createFitnessTarget(squadId, {
        name: name.trim(),
        kind,
        description: description.trim() || undefined,
      });
    },
    onSuccess: onCreated,
    onError: (failure) => setError(failure.message),
  });

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="target-dialog-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">New fitness target</p>
            <h2 id="target-dialog-title">Register a target</h2>
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
              <span>Target name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Checkout API" autoFocus />
            </label>
            <div className="field-grid two">
              <label className="field">
                <span>Kind</span>
                <div className="select-wrap">
                  <select value={kind} onChange={(event) => setKind(event.target.value)}>
                    {targetKinds.map((option) => (
                      <option value={option} key={option}>{option}</option>
                    ))}
                  </select>
                </div>
              </label>
              <label className="field">
                <span>Description</span>
                <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" />
              </label>
            </div>
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
              Create target
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
