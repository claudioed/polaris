import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, CircleAlert, DatabaseZap, LoaderCircle, Plug, X } from "lucide-react";
import { checkSourceConnection, createMeasurementSource, getSquadSources } from "../api";
import type { Catalog, ResourceRecord } from "../types";
import { ResourceWorkspace } from "./ResourceWorkspace";

interface Props {
  catalog: Catalog;
}

export function SourcesWorkspace({ catalog }: Props) {
  return (
    <ResourceWorkspace<ResourceRecord>
      catalog={catalog}
      title="Measurement sources"
      description="Provider connections that pull-mode fitness functions query for evidence."
      icon={<DatabaseZap size={23} />}
      emptyIcon={<DatabaseZap size={23} />}
      emptyTitle="No measurement sources yet"
      emptyBody="Register a Prometheus connection so pull-mode fitness functions can query it."
      createLabel="New source"
      gridTemplate="minmax(200px, 2fr) 110px minmax(180px, 2fr) 110px 120px"
      fetcher={getSquadSources}
      columns={[
        { header: "Source", render: (item) => <SourceCell item={item} /> },
        { header: "Provider", render: (item) => String(item.data.providerType ?? "—") },
        { header: "Base URL", render: (item) => <code className="code-input" style={{ padding: "2px 5px" }}>{String(item.data.baseUrl ?? "")}</code> },
        {
          header: "Status",
          render: (item) => (
            <span className={`status-pill ${item.status.toLowerCase()}`}>
              <i /> {item.status}
            </span>
          ),
        },
        { header: "", render: (item) => <ConnectionCheckAction source={item} /> },
      ]}
      renderCreateDialog={(squadId, handlers) => (
        <CreateSourceDialog squadId={squadId} {...handlers} />
      )}
    />
  );
}

function SourceCell({ item }: { item: ResourceRecord }) {
  return (
    <span className="simple-cell">
      <strong>{String(item.data.name ?? "Unnamed source")}</strong>
      <small>{item.id}</small>
    </span>
  );
}

function ConnectionCheckAction({ source }: { source: ResourceRecord }) {
  const mutation = useMutation({ mutationFn: () => checkSourceConnection(source.id) });

  if (mutation.isSuccess) {
    const status = String((mutation.data as ResourceRecord).data.status ?? "");
    return (
      <span className={`status-pill ${status === "SUCCEEDED" ? "active" : "draft"}`}>
        <i /> {status === "SUCCEEDED" ? "Connected" : "Failed"}
      </span>
    );
  }

  return (
    <button
      className="button secondary small row-action"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      type="button"
    >
      {mutation.isPending ? <LoaderCircle size={14} className="spin" /> : <Plug size={14} />}
      Test connection
    </button>
  );
}

function CreateSourceDialog({
  squadId,
  onClose,
  onCreated,
}: {
  squadId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2) throw new Error("Enter a source name.");
      if (!/^https?:\/\//.test(baseUrl.trim())) throw new Error("Enter a valid base URL (http(s)://…).");
      return createMeasurementSource(squadId, {
        name: name.trim(),
        providerType: "PROMETHEUS",
        baseUrl: baseUrl.trim(),
        description: description.trim() || undefined,
      });
    },
    onSuccess: onCreated,
    onError: (failure) => setError(failure.message),
  });

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="source-dialog-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">New measurement source</p>
            <h2 id="source-dialog-title">Register a Prometheus connection</h2>
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
              <span>Source name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. prod-prometheus" autoFocus />
            </label>
            <label className="field">
              <span>Base URL</span>
              <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://prometheus.internal:9090" />
              <small>Only PROMETHEUS with no outbound auth is supported today.</small>
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
            <button type="button" className="button ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={mutation.isPending}>
              {mutation.isPending ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}
              Create source
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
