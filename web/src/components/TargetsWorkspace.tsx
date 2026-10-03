import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, CircleAlert, LoaderCircle, Target, X } from "lucide-react";
import { createFitnessTarget, getSquadTargets } from "../api";
import type { Catalog, ResourceRecord } from "../types";
import { ResourceWorkspace } from "./ResourceWorkspace";

interface Props {
  catalog: Catalog;
}

const targetKinds = ["SERVICE", "APPLICATION", "DATA_PRODUCT", "PLATFORM", "COMPONENT"];

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
      gridTemplate="minmax(220px, 2fr) 140px 110px 1fr"
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
