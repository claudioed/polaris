import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, CircleAlert, LoaderCircle, Network, X } from "lucide-react";
import { createMeasurementProducer, getSquadProducers } from "../api";
import type { Catalog, ResourceRecord } from "../types";
import { ResourceWorkspace } from "./ResourceWorkspace";

interface Props {
  catalog: Catalog;
}

export function ProducersWorkspace({ catalog }: Props) {
  return (
    <ResourceWorkspace<ResourceRecord>
      catalog={catalog}
      title="Measurement producers"
      description="Push identities authorized to submit measurements for this squad's fitness functions."
      icon={<Network size={23} />}
      emptyIcon={<Network size={23} />}
      emptyTitle="No measurement producers yet"
      emptyBody="Register the pipeline or service identity that will push measurements."
      createLabel="New producer"
      gridTemplate="minmax(220px, 2fr) 1fr 160px"
      fetcher={getSquadProducers}
      columns={[
        { header: "Producer", render: (item) => <ProducerCell item={item} /> },
        { header: "Description", render: (item) => String(item.data.description ?? "") },
        { header: "Registered", render: (item) => new Date(item.createdAt).toLocaleDateString() },
      ]}
      renderCreateDialog={(squadId, handlers) => (
        <CreateProducerDialog squadId={squadId} {...handlers} />
      )}
    />
  );
}

function ProducerCell({ item }: { item: ResourceRecord }) {
  return (
    <span className="simple-cell">
      <strong>{String(item.data.name ?? "Unnamed producer")}</strong>
      <small>{item.id}</small>
    </span>
  );
}

function CreateProducerDialog({
  squadId,
  onClose,
  onCreated,
}: {
  squadId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) throw new Error("Enter a producer name.");
      return createMeasurementProducer(squadId, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
    },
    onSuccess: onCreated,
    onError: (failure) => setError(failure.message),
  });

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="producer-dialog-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">New measurement producer</p>
            <h2 id="producer-dialog-title">Register a push identity</h2>
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
              <span>Producer name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. checkout-pipeline" autoFocus />
            </label>
            <label className="field">
              <span>Description</span>
              <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What does this producer measure?" />
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
              Create producer
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
