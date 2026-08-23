import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { z } from "zod";
import {
  activateFitnessFunction,
  createFitnessFunction,
  getSquadSources,
  getSquadTargets,
} from "../api";
import type {
  AcquisitionMode,
  Catalog,
  Criterion,
  FitnessDefinition,
} from "../types";

interface Props {
  catalog: Catalog;
  initialSquadId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}

interface FormValues {
  squadId: string;
  name: string;
  purpose: string;
  objective: string;
  characteristic: string;
  targetIds: string[];
  freshnessMinutes: number;
  enforcement: "OBSERVE" | "WARN" | "BLOCK";
  acquisitionMode: AcquisitionMode;
  producerId: string;
  maximumObservationAgeSeconds: number;
  sourceId: string;
  trigger: "ON_DEMAND" | "SCHEDULED";
  intervalSeconds: number;
  timeoutSeconds: number;
  queryMode: "INSTANT" | "RANGE";
  reduction: "LAST" | "MIN" | "MAX" | "AVERAGE" | "SUM" | "COUNT";
  activateNow: boolean;
}

interface CriterionDraft {
  id: string;
  key: string;
  unit: string;
  warningValue: string;
  failureValue: string;
  failureComparison: string;
  required: boolean;
  expression: string;
}

const identitySchema = z.object({
  squadId: z.string().min(1, "Choose an owning squad"),
  name: z.string().trim().min(3, "Use at least 3 characters"),
  purpose: z.string().trim().min(10, "Explain why this matters"),
  objective: z.string().trim().min(10, "Describe the desired outcome"),
  characteristic: z.string().min(1, "Choose a characteristic"),
  targetIds: z.array(z.string()).min(1, "Select at least one fitness target"),
});

const stepLabels = ["Intent & scope", "Criteria", "Data acquisition", "Review"];

const characteristics = [
  "Reliability",
  "Performance efficiency",
  "Security",
  "Maintainability",
  "Compatibility",
  "Interaction capability",
  "Flexibility",
  "Safety",
];

const newCriterion = (): CriterionDraft => ({
  id: crypto.randomUUID(),
  key: "",
  unit: "",
  warningValue: "",
  failureValue: "",
  failureComparison: "GREATER_THAN",
  required: true,
  expression: "",
});

export function CreateFitnessFunction({
  catalog,
  initialSquadId,
  onClose,
  onCreated,
}: Props) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [criteria, setCriteria] = useState<CriterionDraft[]>([newCriterion()]);
  const [formError, setFormError] = useState("");
  const {
    register,
    control,
    setValue,
    getValues,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      squadId: initialSquadId ?? catalog.squads[0]?.id ?? "",
      name: "",
      purpose: "",
      objective: "",
      characteristic: "Reliability",
      targetIds: [],
      freshnessMinutes: 30,
      enforcement: "WARN",
      acquisitionMode: "PULL",
      producerId: "",
      maximumObservationAgeSeconds: 300,
      sourceId: "",
      trigger: "ON_DEMAND",
      intervalSeconds: 300,
      timeoutSeconds: 10,
      queryMode: "INSTANT",
      reduction: "LAST",
      activateNow: false,
    },
  });

  const watched = useWatch({ control });
  const squadId = watched.squadId ?? "";
  const acquisitionMode = watched.acquisitionMode ?? "PULL";
  const selectedTargets = watched.targetIds ?? [];
  const trigger = watched.trigger ?? "ON_DEMAND";

  const targetsQuery = useQuery({
    queryKey: ["targets", squadId],
    queryFn: () => getSquadTargets(squadId),
    enabled: Boolean(squadId),
  });
  const sourcesQuery = useQuery({
    queryKey: ["sources", squadId],
    queryFn: () => getSquadSources(squadId),
    enabled: Boolean(squadId) && acquisitionMode === "PULL",
  });

  useEffect(() => {
    setValue("targetIds", []);
    setValue("sourceId", "");
  }, [setValue, squadId]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const definition = buildDefinition(values, criteria);
      const created = await createFitnessFunction(values.squadId, definition);
      if (values.activateNow) {
        return activateFitnessFunction(created.id, 1);
      }
      return created;
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["catalog"] });
      onCreated(created.id);
    },
  });

  const currentSquad = catalog.squads.find((squad) => squad.id === squadId);
  const canContinue = (() => {
    if (step === 0) {
      return identitySchema.safeParse(getValues()).success;
    }
    if (step === 1) {
      return criteria.every(
        (criterion) =>
          /^[a-z][a-z0-9_]{0,62}$/.test(criterion.key) &&
          criterion.unit.trim() &&
          Number.isFinite(Number(criterion.failureValue)),
      );
    }
    if (step === 2) {
      if (acquisitionMode === "PUSH") return Boolean(getValues("producerId").trim());
      return Boolean(
        getValues("sourceId") &&
          criteria.every((criterion) => criterion.expression.trim()),
      );
    }
    return true;
  })();

  function nextStep() {
    setFormError("");
    if (!canContinue) {
      setFormError("Complete the required information before continuing.");
      return;
    }
    setStep((value) => Math.min(3, value + 1));
  }

  function toggleTarget(id: string) {
    const next = selectedTargets.includes(id)
      ? selectedTargets.filter((targetId) => targetId !== id)
      : [...selectedTargets, id];
    setValue("targetIds", next, { shouldDirty: true });
  }

  function updateCriterion(id: string, patch: Partial<CriterionDraft>) {
    setCriteria((items) =>
      items.map((criterion) => (criterion.id === id ? { ...criterion, ...patch } : criterion)),
    );
  }

  const submit = handleSubmit((values) => {
    setFormError("");
    if (!canContinue) {
      setFormError("Review the form and complete all required fields.");
      return;
    }
    mutation.mutate(values);
  });

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-title"
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">New control</p>
            <h2 id="create-title">Create fitness function</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>

        <div className="stepper" aria-label="Creation progress">
          {stepLabels.map((label, index) => (
            <div className={`step ${index === step ? "current" : ""} ${index < step ? "done" : ""}`} key={label}>
              <span>{index < step ? <Check size={13} /> : index + 1}</span>
              <p>{label}</p>
            </div>
          ))}
        </div>

        <form onSubmit={submit}>
          <div className="dialog-body">
            {step === 0 && (
              <div className="form-section">
                <div className="section-heading">
                  <h3>Intent and ownership</h3>
                  <p>Describe the architectural outcome in language the whole squad can understand.</p>
                </div>
                <div className="field-grid two">
                  <label className="field">
                    <span>Owning squad</span>
                    <div className="select-wrap">
                      <select {...register("squadId", { required: true })}>
                        {catalog.squads.map((squad) => (
                          <option value={squad.id} key={squad.id}>
                            {String(squad.data.name ?? "Unnamed squad")} · {squad.tribeName}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={16} />
                    </div>
                  </label>
                  <label className="field">
                    <span>Quality characteristic</span>
                    <div className="select-wrap">
                      <select {...register("characteristic")}>
                        {characteristics.map((item) => <option key={item}>{item}</option>)}
                      </select>
                      <ChevronDown size={16} />
                    </div>
                  </label>
                </div>
                <label className="field">
                  <span>Name</span>
                  <input
                    {...register("name", { required: "Name is required" })}
                    placeholder="e.g. Checkout availability"
                    autoFocus
                  />
                  {errors.name && <small className="field-error">{errors.name.message}</small>}
                </label>
                <label className="field">
                  <span>Purpose</span>
                  <textarea
                    {...register("purpose")}
                    placeholder="Why does this fitness function matter to customers and the business?"
                    rows={3}
                  />
                </label>
                <label className="field">
                  <span>Objective</span>
                  <textarea
                    {...register("objective")}
                    placeholder="State the desired architectural outcome."
                    rows={3}
                  />
                </label>
                <div className="field">
                  <span>Fitness targets</span>
                  <div className="choice-grid">
                    {targetsQuery.isLoading && <div className="inline-loading"><LoaderCircle size={16} className="spin" /> Loading targets</div>}
                    {targetsQuery.data?.items.map((target) => (
                      <button
                        type="button"
                        className={`choice-card ${selectedTargets.includes(target.id) ? "selected" : ""}`}
                        onClick={() => toggleTarget(target.id)}
                        key={target.id}
                      >
                        <span className="check-box">{selectedTargets.includes(target.id) && <Check size={13} />}</span>
                        <span>
                          <strong>{String(target.data.name ?? "Unnamed target")}</strong>
                          <small>{String(target.data.type ?? "Software system")}</small>
                        </span>
                      </button>
                    ))}
                    {!targetsQuery.isLoading && targetsQuery.data?.items.length === 0 && (
                      <div className="empty-inline">This squad has no fitness targets yet.</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="form-section">
                <div className="section-heading split">
                  <div>
                    <h3>Measurable criteria</h3>
                    <p>Define explicit thresholds. Polaris evaluates each received measurement.</p>
                  </div>
                  <button type="button" className="button secondary small" onClick={() => setCriteria((items) => [...items, newCriterion()])}>
                    <Plus size={15} /> Add criterion
                  </button>
                </div>
                <div className="criteria-list">
                  {criteria.map((criterion, index) => (
                    <div className="criterion-editor" key={criterion.id}>
                      <div className="criterion-title">
                        <span>Criterion {index + 1}</span>
                        {criteria.length > 1 && (
                          <button type="button" className="icon-button subtle" onClick={() => setCriteria((items) => items.filter((item) => item.id !== criterion.id))} aria-label="Remove criterion">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                      <div className="field-grid two">
                        <label className="field">
                          <span>Key</span>
                          <input value={criterion.key} onChange={(event) => updateCriterion(criterion.id, { key: event.target.value.toLowerCase().replace(/\s+/g, "_") })} placeholder="error_rate" />
                        </label>
                        <label className="field">
                          <span>Unit</span>
                          <input value={criterion.unit} onChange={(event) => updateCriterion(criterion.id, { unit: event.target.value })} placeholder="percent" />
                        </label>
                      </div>
                      <div className="field-grid three">
                        <label className="field">
                          <span>Failure when</span>
                          <div className="select-wrap">
                            <select value={criterion.failureComparison} onChange={(event) => updateCriterion(criterion.id, { failureComparison: event.target.value })}>
                              <option value="GREATER_THAN">Greater than</option>
                              <option value="GREATER_THAN_OR_EQUAL">Greater or equal</option>
                              <option value="LESS_THAN">Less than</option>
                              <option value="LESS_THAN_OR_EQUAL">Less or equal</option>
                              <option value="EQUAL">Equal to</option>
                              <option value="NOT_EQUAL">Not equal to</option>
                            </select>
                            <ChevronDown size={16} />
                          </div>
                        </label>
                        <label className="field">
                          <span>Warning value</span>
                          <input type="number" step="any" value={criterion.warningValue} onChange={(event) => updateCriterion(criterion.id, { warningValue: event.target.value })} placeholder="Optional" />
                        </label>
                        <label className="field">
                          <span>Failure value</span>
                          <input type="number" step="any" value={criterion.failureValue} onChange={(event) => updateCriterion(criterion.id, { failureValue: event.target.value })} placeholder="Required" />
                        </label>
                      </div>
                      <label className="toggle-row">
                        <input type="checkbox" checked={criterion.required} onChange={(event) => updateCriterion(criterion.id, { required: event.target.checked })} />
                        <span className="toggle" />
                        <span>Required for the overall outcome</span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="form-section">
                <div className="section-heading">
                  <h3>Data acquisition</h3>
                  <p>Choose whether Polaris receives pipeline data or collects it from a source.</p>
                </div>
                <div className="segmented">
                  <button type="button" className={acquisitionMode === "PULL" ? "active" : ""} onClick={() => setValue("acquisitionMode", "PULL")}>
                    Pull from source
                  </button>
                  <button type="button" className={acquisitionMode === "PUSH" ? "active" : ""} onClick={() => setValue("acquisitionMode", "PUSH")}>
                    Receive from pipeline
                  </button>
                </div>

                {acquisitionMode === "PULL" ? (
                  <>
                    <div className="field-grid two">
                      <label className="field">
                        <span>Measurement source</span>
                        <div className="select-wrap">
                          <select {...register("sourceId")}>
                            <option value="">Choose an active source</option>
                            {sourcesQuery.data?.items
                              .filter((source) => source.status === "ACTIVE")
                              .map((source) => (
                                <option value={source.id} key={source.id}>
                                  {String(source.data.name ?? source.id)}
                                </option>
                              ))}
                          </select>
                          <ChevronDown size={16} />
                        </div>
                      </label>
                      <label className="field">
                        <span>Trigger</span>
                        <div className="select-wrap">
                          <select {...register("trigger")}>
                            <option value="ON_DEMAND">On demand</option>
                            <option value="SCHEDULED">Scheduled</option>
                          </select>
                          <ChevronDown size={16} />
                        </div>
                      </label>
                    </div>
                    <div className="query-list">
                      {criteria.map((criterion) => (
                        <label className="field" key={criterion.id}>
                          <span>PromQL for <code>{criterion.key || "criterion"}</code></span>
                          <textarea
                            value={criterion.expression}
                            onChange={(event) =>
                              updateCriterion(criterion.id, { expression: event.target.value })
                            }
                            className="code-input"
                            rows={3}
                            placeholder='histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))'
                          />
                        </label>
                      ))}
                    </div>
                    <div className="field-grid three">
                      <label className="field">
                        <span>Query mode</span>
                        <div className="select-wrap">
                          <select {...register("queryMode")}>
                            <option value="INSTANT">Instant</option>
                            <option value="RANGE">Range</option>
                          </select>
                          <ChevronDown size={16} />
                        </div>
                      </label>
                      <label className="field">
                        <span>Reduction</span>
                        <div className="select-wrap">
                          <select {...register("reduction")}>
                            <option value="LAST">Last value</option>
                            <option value="AVERAGE">Average</option>
                            <option value="MAX">Maximum</option>
                            <option value="MIN">Minimum</option>
                            <option value="SUM">Sum</option>
                            <option value="COUNT">Count</option>
                          </select>
                          <ChevronDown size={16} />
                        </div>
                      </label>
                      <label className="field">
                        <span>Timeout (seconds)</span>
                        <input type="number" min={1} max={30} {...register("timeoutSeconds", { valueAsNumber: true })} />
                      </label>
                    </div>
                    {trigger === "SCHEDULED" && (
                      <label className="field">
                        <span>Collection interval (seconds)</span>
                        <input type="number" min={60} {...register("intervalSeconds", { valueAsNumber: true })} />
                        <small>Minimum 60 seconds</small>
                      </label>
                    )}
                  </>
                ) : (
                  <div className="field-grid two">
                    <label className="field">
                      <span>Producer ID</span>
                      <input {...register("producerId")} placeholder="Pipeline producer UUID" />
                      <small>The registered pipeline or test runner that will submit data.</small>
                    </label>
                    <label className="field">
                      <span>Maximum observation age</span>
                      <div className="input-suffix">
                        <input
                          type="number"
                          min={1}
                          {...register("maximumObservationAgeSeconds", { valueAsNumber: true })}
                        />
                        <span>seconds</span>
                      </div>
                    </label>
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="form-section review">
                <div className="section-heading">
                  <h3>Review the control</h3>
                  <p>Polaris will create version 1 as an immutable draft.</p>
                </div>
                <div className="review-hero">
                  <span className="quality-mark">{(watched.characteristic ?? "FF").slice(0, 2).toUpperCase()}</span>
                  <div>
                    <p>{currentSquad ? String(currentSquad.data.name) : "Squad"}</p>
                    <h4>{watched.name}</h4>
                    <span>{watched.objective}</span>
                  </div>
                </div>
                <dl className="review-grid">
                  <div><dt>Targets</dt><dd>{selectedTargets.length}</dd></div>
                  <div><dt>Criteria</dt><dd>{criteria.length}</dd></div>
                  <div><dt>Acquisition</dt><dd>{acquisitionMode}</dd></div>
                  <div><dt>Enforcement</dt><dd>{watched.enforcement}</dd></div>
                </dl>
                <div className="field-grid two">
                  <label className="field">
                    <span>Enforcement</span>
                    <div className="select-wrap">
                      <select {...register("enforcement")}>
                        <option value="OBSERVE">Observe</option>
                        <option value="WARN">Warn</option>
                        <option value="BLOCK">Block</option>
                      </select>
                      <ChevronDown size={16} />
                    </div>
                  </label>
                  <label className="field">
                    <span>Freshness window (minutes)</span>
                    <input type="number" min={1} {...register("freshnessMinutes", { valueAsNumber: true })} />
                  </label>
                </div>
                <label className="activation-choice">
                  <input type="checkbox" {...register("activateNow")} />
                  <span className="check-box"><Check size={13} /></span>
                  <span>
                    <strong>Activate immediately</strong>
                    <small>Begin evaluating after creation. Leave off for peer review.</small>
                  </span>
                </label>
              </div>
            )}

            {(formError || mutation.error) && (
              <div className="form-alert" role="alert">
                <CircleAlert size={17} />
                <span>{mutation.error?.message ?? formError}</span>
              </div>
            )}
          </div>

          <footer className="dialog-footer">
            <button type="button" className="button ghost" onClick={step === 0 ? onClose : () => setStep((value) => value - 1)}>
              {step > 0 && <ArrowLeft size={16} />}
              {step === 0 ? "Cancel" : "Back"}
            </button>
            {step < 3 ? (
              <button type="button" className="button primary" onClick={nextStep}>
                Continue <ArrowRight size={16} />
              </button>
            ) : (
              <button type="submit" className="button primary" disabled={mutation.isPending}>
                {mutation.isPending ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}
                {watched.activateNow ? "Create and activate" : "Create draft"}
              </button>
            )}
          </footer>
        </form>
      </section>
    </div>
  );
}

function buildDefinition(values: FormValues, drafts: CriterionDraft[]): FitnessDefinition {
  const criteria: Criterion[] = drafts.map((criterion) => {
    const result: Criterion = {
      key: criterion.key,
      unit: criterion.unit,
      failureComparison: criterion.failureComparison,
      failureValue: Number(criterion.failureValue),
      required: criterion.required,
    };
    if (criterion.warningValue !== "") {
      result.warningComparison = criterion.failureComparison;
      result.warningValue = Number(criterion.warningValue);
    }
    return result;
  });

  return {
    name: values.name.trim(),
    purpose: values.purpose.trim(),
    objective: values.objective.trim(),
    characteristic: values.characteristic,
    targetIds: values.targetIds,
    criteria,
    freshnessSeconds: values.freshnessMinutes * 60,
    enforcement: values.enforcement,
    acquisition:
      values.acquisitionMode === "PUSH"
        ? {
            mode: "PUSH",
            producerId: values.producerId.trim(),
            maximumObservationAgeSeconds: values.maximumObservationAgeSeconds,
          }
        : {
            mode: "PULL",
            sourceId: values.sourceId,
            trigger: values.trigger,
            ...(values.trigger === "SCHEDULED"
              ? { intervalSeconds: values.intervalSeconds }
              : {}),
            timeoutSeconds: values.timeoutSeconds,
            queries: criteria.map((criterion, index) => ({
              criterionKey: criterion.key,
              expression: drafts[index].expression.trim(),
              mode: values.queryMode,
              ...(values.queryMode === "RANGE"
                ? { lookbackSeconds: 300, stepSeconds: 30 }
                : {}),
              reduction: values.reduction,
              seriesPolicy: "REQUIRE_SINGLE_SERIES",
              unit: criterion.unit,
            })),
          },
  };
}
