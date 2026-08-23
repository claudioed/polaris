import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Target,
  Users,
  X,
} from "lucide-react";
import { createFitnessTarget, createSquad, createTribe } from "../api";
import type { Catalog } from "../types";

interface Props {
  catalog: Catalog;
  onClose: () => void;
  onReady: (squadId: string) => void;
}

export function SetupWorkspace({ catalog, onClose, onReady }: Props) {
  const [tribeId, setTribeId] = useState(catalog.tribes[0]?.id ?? "new");
  const [tribeName, setTribeName] = useState("");
  const [squadName, setSquadName] = useState("");
  const [mission, setMission] = useState("");
  const [targetName, setTargetName] = useState("");
  const [targetType, setTargetType] = useState("SERVICE");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      let ownerTribeId = tribeId;
      if (ownerTribeId === "new") {
        if (tribeName.trim().length < 2) throw new Error("Enter a tribe name.");
        const tribe = await createTribe({
          name: tribeName.trim(),
          description: "Created from Polaris Control Tower",
        });
        ownerTribeId = tribe.id;
      }
      if (squadName.trim().length < 2) throw new Error("Enter a squad name.");
      if (targetName.trim().length < 2) throw new Error("Enter the first fitness target.");

      const squad = await createSquad(ownerTribeId, {
        name: squadName.trim(),
        mission: mission.trim() || undefined,
      });
      await createFitnessTarget(squad.id, {
        name: targetName.trim(),
        type: targetType,
        description: "Initial target created during control-tower setup",
      });
      return squad.id;
    },
    onSuccess: onReady,
    onError: (failure) => setError(failure.message),
  });

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Workspace setup</p>
            <h2 id="setup-title">Prepare your squad</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>

        <div className="setup-intro">
          <div className="setup-symbol">
            <span><Building2 size={16} /></span>
            <i />
            <span><Users size={16} /></span>
            <i />
            <span><Target size={16} /></span>
          </div>
          <h3>A fitness function needs an owner and a target</h3>
          <p>Create the minimum engineering topology now. You can add more targets and sources later.</p>
        </div>

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
                  <option value="new">Create a new tribe…</option>
                </select>
                <ChevronDown size={16} />
              </div>
            </label>
            {tribeId === "new" && (
              <label className="field">
                <span>New tribe name</span>
                <input
                  value={tribeName}
                  onChange={(event) => setTribeName(event.target.value)}
                  placeholder="e.g. Digital Commerce"
                  autoFocus
                />
              </label>
            )}
            <div className="field-grid two">
              <label className="field">
                <span>Squad name</span>
                <input
                  value={squadName}
                  onChange={(event) => setSquadName(event.target.value)}
                  placeholder="e.g. Checkout Experience"
                  autoFocus={tribeId !== "new"}
                />
              </label>
              <label className="field">
                <span>Squad mission</span>
                <input
                  value={mission}
                  onChange={(event) => setMission(event.target.value)}
                  placeholder="Optional mission statement"
                />
              </label>
            </div>
            <div className="field-grid two">
              <label className="field">
                <span>First fitness target</span>
                <input
                  value={targetName}
                  onChange={(event) => setTargetName(event.target.value)}
                  placeholder="e.g. Checkout API"
                />
              </label>
              <label className="field">
                <span>Target type</span>
                <div className="select-wrap">
                  <select value={targetType} onChange={(event) => setTargetType(event.target.value)}>
                    <option value="SERVICE">Service</option>
                    <option value="APPLICATION">Application</option>
                    <option value="DATA_PRODUCT">Data product</option>
                    <option value="PLATFORM">Platform capability</option>
                    <option value="COMPONENT">Component</option>
                  </select>
                  <ChevronDown size={16} />
                </div>
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
              Create squad and target <ArrowRight size={16} />
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
