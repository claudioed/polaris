import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  Check,
  CircleAlert,
  DatabaseZap,
  Gauge,
  LoaderCircle,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Target,
  X,
} from "lucide-react";
import {
  cancelEvaluationRequest,
  collectNow,
  createEvaluationRequest,
  createWaiver,
  getEvaluationRequest,
  listCollectionAttempts,
  listEvaluations,
  retryCollectionAttempt,
  transitionWaiver,
} from "../api";
import type {
  Catalog,
  CollectionAttempt,
  EvaluationRequest,
  FitnessFunction,
  Waiver,
  WaiverTransition,
} from "../types";
import { activeDefinition, relativeTime } from "../utils";

interface Props {
  item: FitnessFunction;
  catalog: Catalog;
  onClose: () => void;
}

type DetailTab = "overview" | "evaluations" | "collection" | "waivers";

export function FitnessDetails({ item, catalog, onClose }: Props) {
  const definition = activeDefinition(item);
  const squad = catalog.squads.find((candidate) => candidate.id === item.ownerSquadId);
  const activeVersion = item.versions.find((version) => version.number === item.activeVersion);
  const [tab, setTab] = useState<DetailTab>("overview");

  if (!definition) return null;

  const isPull = definition.acquisition.mode === "PULL";

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

      <nav className="detail-tabs" role="tablist" aria-label="Fitness function sections">
        <button type="button" role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button type="button" role="tab" aria-selected={tab === "evaluations"} className={tab === "evaluations" ? "active" : ""} onClick={() => setTab("evaluations")}>
          Evaluations
        </button>
        {isPull && (
          <button type="button" role="tab" aria-selected={tab === "collection"} className={tab === "collection" ? "active" : ""} onClick={() => setTab("collection")}>
            Collection
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === "waivers"} className={tab === "waivers" ? "active" : ""} onClick={() => setTab("waivers")}>
          Waivers
        </button>
      </nav>

      <div className="details-scroll">
        {tab === "overview" && (
          <>
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
          </>
        )}

        {tab === "evaluations" && <EvaluationsTab fitnessFunctionId={item.id} />}
        {tab === "collection" && isPull && <CollectionTab fitnessFunctionId={item.id} />}
        {tab === "waivers" && <WaiversTab fitnessFunctionId={item.id} />}
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

function errorMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : "Something went wrong.";
}

function EvaluationsTab({ fitnessFunctionId }: { fitnessFunctionId: string }) {
  const queryClient = useQueryClient();
  const evaluationsQuery = useQuery({
    queryKey: ["evaluations", fitnessFunctionId],
    queryFn: () => listEvaluations(fitnessFunctionId),
  });
  const [requests, setRequests] = useState<EvaluationRequest[]>([]);
  const [error, setError] = useState("");

  const requestMutation = useMutation({
    mutationFn: () => createEvaluationRequest(fitnessFunctionId),
    onSuccess: (request) => setRequests((previous) => [request, ...previous]),
    onError: (failure) => setError(errorMessage(failure)),
  });

  function refresh(requestId: string) {
    setError("");
    getEvaluationRequest(requestId)
      .then((updated) => {
        setRequests((previous) => previous.map((request) => (request.id === requestId ? updated : request)));
        if (updated.status !== "PENDING") {
          void queryClient.invalidateQueries({ queryKey: ["evaluations", fitnessFunctionId] });
        }
      })
      .catch((failure: unknown) => setError(errorMessage(failure)));
  }

  function cancel(requestId: string) {
    setError("");
    cancelEvaluationRequest(requestId)
      .then((updated) => setRequests((previous) => previous.map((request) => (request.id === requestId ? updated : request))))
      .catch((failure: unknown) => setError(errorMessage(failure)));
  }

  const evaluations = evaluationsQuery.data ?? [];

  return (
    <section className="detail-section">
      <div className="detail-section-title">
        <div>
          <p className="eyebrow">Recorded outcomes</p>
          <h3>{evaluations.length} {evaluations.length === 1 ? "evaluation" : "evaluations"}</h3>
        </div>
        <button
          className="button secondary small"
          type="button"
          onClick={() => requestMutation.mutate()}
          disabled={requestMutation.isPending}
        >
          {requestMutation.isPending ? <LoaderCircle size={14} className="spin" /> : <PlayCircle size={14} />}
          Request evaluation
        </button>
      </div>

      {error && (
        <div className="form-alert" role="alert">
          <CircleAlert size={14} />
          <span>{error}</span>
        </div>
      )}

      {requests.length > 0 && (
        <div className="request-list">
          {requests.map((request) => (
            <div className="request-row" key={request.id}>
              <span className={`status-pill ${request.status.toLowerCase()}`}>
                <i /> {request.status}
              </span>
              <small>{request.id.slice(0, 8)} · requested {relativeTime(request.createdAt)}</small>
              {request.status === "PENDING" && (
                <div className="row-action">
                  <button className="button ghost small" type="button" onClick={() => refresh(request.id)}>
                    Refresh
                  </button>
                  <button className="button ghost small" type="button" onClick={() => cancel(request.id)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {evaluationsQuery.isLoading && (
        <div className="inline-loading"><LoaderCircle className="spin" size={16} /> Loading evaluations…</div>
      )}
      {evaluationsQuery.isError && (
        <div className="form-alert" role="alert">
          <CircleAlert size={14} />
          <span>{errorMessage(evaluationsQuery.error)}</span>
        </div>
      )}
      {!evaluationsQuery.isLoading && !evaluationsQuery.isError && evaluations.length === 0 && (
        <p className="empty-inline">No evaluations recorded yet.</p>
      )}

      <div className="evaluation-list">
        {evaluations
          .slice()
          .reverse()
          .map((evaluation) => (
            <article className="evaluation-row" key={evaluation.evaluationId}>
              <div>
                <span className={`outcome-pill ${evaluation.outcome.toLowerCase()}`}>{evaluation.outcome}</span>
                <span className={`disposition-pill ${evaluation.disposition.toLowerCase()}`}>{evaluation.disposition}</span>
              </div>
              <p>{evaluation.criterionResults.length} criteria · observed {relativeTime(evaluation.observedAt)}</p>
            </article>
          ))}
      </div>
    </section>
  );
}

function CollectionTab({ fitnessFunctionId }: { fitnessFunctionId: string }) {
  const queryClient = useQueryClient();
  const attemptsQuery = useQuery({
    queryKey: ["collection-attempts", fitnessFunctionId],
    queryFn: () => listCollectionAttempts(fitnessFunctionId),
  });
  const [error, setError] = useState("");

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["collection-attempts", fitnessFunctionId] });
    void queryClient.invalidateQueries({ queryKey: ["evaluations", fitnessFunctionId] });
  }

  const collectNowMutation = useMutation({
    mutationFn: () => collectNow(fitnessFunctionId),
    onSuccess: invalidate,
    onError: (failure) => setError(errorMessage(failure)),
  });

  function retry(attempt: CollectionAttempt) {
    setError("");
    retryCollectionAttempt(attempt.id).then(invalidate).catch((failure: unknown) => setError(errorMessage(failure)));
  }

  const attempts = attemptsQuery.data ?? [];

  return (
    <section className="detail-section">
      <div className="detail-section-title">
        <div>
          <p className="eyebrow">Pull acquisition</p>
          <h3>{attempts.length} {attempts.length === 1 ? "attempt" : "attempts"}</h3>
        </div>
        <button
          className="button secondary small"
          type="button"
          onClick={() => collectNowMutation.mutate()}
          disabled={collectNowMutation.isPending}
        >
          {collectNowMutation.isPending ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
          Collect now
        </button>
      </div>

      {error && (
        <div className="form-alert" role="alert">
          <CircleAlert size={14} />
          <span>{error}</span>
        </div>
      )}

      {attemptsQuery.isLoading && (
        <div className="inline-loading"><LoaderCircle className="spin" size={16} /> Loading attempts…</div>
      )}
      {attemptsQuery.isError && (
        <div className="form-alert" role="alert">
          <CircleAlert size={14} />
          <span>{errorMessage(attemptsQuery.error)}</span>
        </div>
      )}
      {!attemptsQuery.isLoading && !attemptsQuery.isError && attempts.length === 0 && (
        <p className="empty-inline">No collection attempts recorded yet.</p>
      )}

      <div className="evaluation-list">
        {attempts
          .slice()
          .reverse()
          .map((attempt) => (
            <article className="evaluation-row" key={attempt.id}>
              <div>
                <span className={`outcome-pill ${attempt.status === "SUCCEEDED" ? "pass" : "fail"}`}>{attempt.status}</span>
              </div>
              <p>{attempt.data.measurements?.length ?? 0} measurements · {relativeTime(attempt.createdAt)}</p>
              {attempt.status === "FAILED" && (
                <button className="button ghost small" type="button" onClick={() => retry(attempt)}>
                  Retry
                </button>
              )}
            </article>
          ))}
      </div>
    </section>
  );
}

function WaiversTab({ fitnessFunctionId }: { fitnessFunctionId: string }) {
  const [waivers, setWaivers] = useState<Waiver[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");

  function decide(waiver: Waiver, transition: WaiverTransition) {
    setError("");
    transitionWaiver(waiver.id, transition)
      .then((updated) => setWaivers((previous) => previous.map((item) => (item.id === waiver.id ? updated : item))))
      .catch((failure: unknown) => setError(errorMessage(failure)));
  }

  return (
    <section className="detail-section">
      <div className="detail-section-title">
        <div>
          <p className="eyebrow">Justified exceptions</p>
          <h3>{waivers.length} proposed this session</h3>
        </div>
        <button className="button secondary small" type="button" onClick={() => setFormOpen(true)}>
          <ShieldAlert size={14} /> Propose waiver
        </button>
      </div>

      {error && (
        <div className="form-alert" role="alert">
          <CircleAlert size={14} />
          <span>{error}</span>
        </div>
      )}

      {waivers.length === 0 && (
        <p className="empty-inline">
          Polaris doesn't expose a waiver list endpoint — waivers you propose appear here for this session.
        </p>
      )}

      <div className="evaluation-list">
        {waivers.map((waiver) => (
          <article className="evaluation-row" key={waiver.id}>
            <div>
              <span className={`status-pill ${waiver.status.toLowerCase()}`}>
                <i /> {waiver.status}
              </span>
            </div>
            <p>{waiver.data.reason}</p>
            {waiver.status === "PROPOSED" && (
              <div className="row-action">
                <button className="button ghost small" type="button" onClick={() => decide(waiver, "approvals")}>
                  Approve
                </button>
                <button className="button ghost small" type="button" onClick={() => decide(waiver, "rejections")}>
                  Reject
                </button>
              </div>
            )}
            {waiver.status === "APPROVED" && (
              <div className="row-action">
                <button className="button ghost small" type="button" onClick={() => decide(waiver, "revocations")}>
                  Revoke
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      {formOpen && (
        <ProposeWaiverDialog
          fitnessFunctionId={fitnessFunctionId}
          onClose={() => setFormOpen(false)}
          onCreated={(waiver) => {
            setWaivers((previous) => [waiver, ...previous]);
            setFormOpen(false);
          }}
        />
      )}
    </section>
  );
}

function ProposeWaiverDialog({
  fitnessFunctionId,
  onClose,
  onCreated,
}: {
  fitnessFunctionId: string;
  onClose: () => void;
  onCreated: (waiver: Waiver) => void;
}) {
  const [reason, setReason] = useState("");
  const [risk, setRisk] = useState("");
  const [compensatingAction, setCompensatingAction] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (reason.trim().length < 1) throw new Error("Enter a reason.");
      if (!expiresAt) throw new Error("Choose when the waiver expires.");
      return createWaiver(fitnessFunctionId, {
        reason: reason.trim(),
        risk: risk.trim() || undefined,
        compensatingAction: compensatingAction.trim() || undefined,
        expiresAt: new Date(expiresAt).toISOString(),
      });
    },
    onSuccess: onCreated,
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="waiver-dialog-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">New waiver</p>
            <h2 id="waiver-dialog-title">Propose a waiver</h2>
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
              <span>Reason</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why is this exception temporarily acceptable?"
                autoFocus
              />
            </label>
            <label className="field">
              <span>Risk</span>
              <textarea value={risk} onChange={(event) => setRisk(event.target.value)} placeholder="Optional" />
            </label>
            <label className="field">
              <span>Compensating action</span>
              <textarea
                value={compensatingAction}
                onChange={(event) => setCompensatingAction(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <label className="field">
              <span>Expires at</span>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
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
              Propose waiver
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
