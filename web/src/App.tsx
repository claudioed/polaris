import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Activity,
  AlertTriangle,
  Blocks,
  ChevronDown,
  CircleGauge,
  Command,
  DatabaseZap,
  FileSearch,
  Filter,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  X,
} from "lucide-react";
import { loadCatalog } from "./api";
import { currentUser, onAuthChange, signOut, type GoogleUser } from "./auth";
import { CreateFitnessFunction } from "./components/CreateFitnessFunction";
import { FitnessDetails } from "./components/FitnessDetails";
import { SetupWorkspace } from "./components/SetupWorkspace";
import { SignIn } from "./components/SignIn";
import type { AcquisitionMode, Catalog, Enforcement, FitnessFunction, Lifecycle } from "./types";
import { activeDefinition, initials, matchesQuery, relativeTime } from "./utils";

type FilterValue<T extends string> = T | "ALL";

export function App() {
  const [user, setUser] = useState<GoogleUser | null>(currentUser());
  useEffect(() => onAuthChange(() => setUser(currentUser())), []);
  const catalogQuery = useQuery({ queryKey: ["catalog"], queryFn: loadCatalog, enabled: Boolean(user) });
  const [search, setSearch] = useState("");
  const [lifecycle, setLifecycle] = useState<FilterValue<Lifecycle>>("ALL");
  const [enforcement, setEnforcement] = useState<FilterValue<Enforcement>>("ALL");
  const [acquisition, setAcquisition] = useState<FilterValue<AcquisitionMode>>("ALL");
  const [selectedId, setSelectedId] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [creationSquadId, setCreationSquadId] = useState<string>();
  const [mobileNav, setMobileNav] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const catalog = catalogQuery.data;
  const functions = useMemo(() => {
    if (!catalog) return [];
    return catalog.functions
      .filter((item) => matchesQuery(item, catalog, search))
      .filter((item) => lifecycle === "ALL" || item.lifecycle === lifecycle)
      .filter((item) => {
        const definition = activeDefinition(item);
        return enforcement === "ALL" || definition?.enforcement === enforcement;
      })
      .filter((item) => {
        const definition = activeDefinition(item);
        return acquisition === "ALL" || definition?.acquisition.mode === acquisition;
      })
      .sort((a, b) => {
        if (a.lifecycle === "ACTIVE" && b.lifecycle !== "ACTIVE") return -1;
        if (b.lifecycle === "ACTIVE" && a.lifecycle !== "ACTIVE") return 1;
        return (activeDefinition(a)?.name ?? "").localeCompare(activeDefinition(b)?.name ?? "");
      });
  }, [acquisition, catalog, enforcement, lifecycle, search]);

  const selected = catalog?.functions.find((item) => item.id === selectedId);
  const activeCount = catalog?.functions.filter((item) => item.lifecycle === "ACTIVE").length ?? 0;
  const draftCount = catalog?.functions.filter((item) => item.lifecycle === "DRAFT").length ?? 0;
  const blockingCount =
    catalog?.functions.filter((item) => activeDefinition(item)?.enforcement === "BLOCK").length ?? 0;
  const automatedCount =
    catalog?.functions.filter((item) => activeDefinition(item)?.acquisition.mode === "PULL").length ?? 0;

  if (!user) {
    return <SignIn onSignedIn={setUser} />;
  }

  function startCreation() {
    if (!catalog) return;
    if (catalog.squads.length === 0) {
      setSetupOpen(true);
      return;
    }
    setCreationSquadId(catalog.squads[0].id);
    setCreateOpen(true);
  }

  return (
    <div className="app-shell">
      <aside className={clsx("sidebar", mobileNav && "mobile-open")}>
        <div className="brand">
          <div className="brand-mark"><span /><span /><span /></div>
          <div><strong>Polaris</strong><small>Control Tower</small></div>
          <button className="icon-button mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <nav>
          <p>Workspace</p>
          <button onClick={() => { setSearch(""); setLifecycle("ALL"); setEnforcement("ALL"); setAcquisition("ALL"); window.scrollTo({ top: 0, behavior: "smooth" }); }}><LayoutDashboard size={18} /><span>Overview</span></button>
          <button className="active"><CircleGauge size={18} /><span>Fitness functions</span><em>{catalog?.functions.length ?? "—"}</em></button>
          <button disabled title="Evaluation workspace is planned"><Activity size={18} /><span>Evaluations</span><em>Soon</em></button>
          <button disabled title="Target workspace is planned"><Target size={18} /><span>Fitness targets</span><em>Soon</em></button>
          <p>Connections</p>
          <button disabled title="Source workspace is planned"><DatabaseZap size={18} /><span>Measurement sources</span><em>Soon</em></button>
          <button disabled title="Producer workspace is planned"><Network size={18} /><span>Producers</span><em>Soon</em></button>
          <p>Governance</p>
          <button disabled title="Template workspace is planned"><Blocks size={18} /><span>Templates</span><em>Soon</em></button>
          <button disabled title="Waiver workspace is planned"><ShieldCheck size={18} /><span>Waivers</span><em>Soon</em></button>
        </nav>
        <div className="sidebar-footer">
          <div className="system-state"><span /><div><strong>Polaris operational</strong><small>API connected</small></div></div>
          <button disabled title="Settings are planned"><Settings size={17} /> Settings <em>Soon</em></button>
        </div>
      </aside>

      {mobileNav && <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}

      <main>
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="breadcrumb"><span>Engineering controls</span><b>/</b><strong>Fitness functions</strong></div>
          <div className="top-actions">
            <button className="keyboard-hint" onClick={() => searchRef.current?.focus()} aria-label="Focus search"><Command size={13} /> K</button>
            <button className="avatar" onClick={() => signOut()} title={`Sign out (${user.email})`} aria-label={`Sign out (${user.email})`}>{initials(user.name)}</button>
          </div>
        </header>

        <div className="content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">Architecture intelligence</p>
              <h1>Fitness functions</h1>
              <p>Define, discover, and govern the controls that keep your software architecture fit for change.</p>
            </div>
            <button className="button primary" onClick={startCreation} disabled={!catalog}>
              <Plus size={17} /> New fitness function
            </button>
          </section>

          {catalogQuery.isLoading && <LoadingState />}
          {catalogQuery.isError && (
            <section className="error-state">
              <AlertTriangle size={24} />
              <div>
                <h2>Control tower is offline</h2>
                <p>{catalogQuery.error.message}</p>
              </div>
              <button className="button secondary" onClick={() => catalogQuery.refetch()}><RefreshCw size={16} /> Retry</button>
            </section>
          )}

          {catalog && (
            <>
              <section className="metric-grid" aria-label="Fitness function summary">
                <Metric label="Total controls" value={catalog.functions.length} note={`Across ${catalog.squads.length} squads`} icon={<CircleGauge size={19} />} />
                <Metric label="Active" value={activeCount} note={`${percent(activeCount, catalog.functions.length)}% coverage`} icon={<Activity size={19} />} tone="green" />
                <Metric label="Drafts awaiting review" value={draftCount} note="Not evaluating yet" icon={<FileSearch size={19} />} tone="amber" />
                <Metric label="Blocking controls" value={blockingCount} note={`${automatedCount} use pull collection`} icon={<ShieldCheck size={19} />} tone="blue" />
              </section>

              <section className="catalog-panel">
                <div className="catalog-toolbar">
                  <div className="search-box">
                    <Search size={18} />
                    <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, squad, tribe, objective, or ID…" aria-label="Search fitness functions" />
                    {search && <button onClick={() => setSearch("")} aria-label="Clear search"><X size={15} /></button>}
                  </div>
                  <div className="filter-group">
                    <FilterSelect icon={<Filter size={15} />} label="Lifecycle" value={lifecycle} options={["ALL", "ACTIVE", "DRAFT", "RETIRED"]} onChange={(value) => setLifecycle(value as FilterValue<Lifecycle>)} />
                    <FilterSelect label="Enforcement" value={enforcement} options={["ALL", "OBSERVE", "WARN", "BLOCK"]} onChange={(value) => setEnforcement(value as FilterValue<Enforcement>)} />
                    <FilterSelect label="Acquisition" value={acquisition} options={["ALL", "PUSH", "PULL"]} onChange={(value) => setAcquisition(value as FilterValue<AcquisitionMode>)} />
                  </div>
                </div>

                <div className="result-summary">
                  <p><strong>{functions.length}</strong> {functions.length === 1 ? "control" : "controls"}</p>
                  <span>Updated from Polaris API</span>
                </div>

                {functions.length > 0 ? (
                  <div className="fitness-table" role="table" aria-label="Fitness function catalog">
                    <div className="table-head" role="row">
                      <span role="columnheader">Fitness function</span>
                      <span role="columnheader">Owner</span>
                      <span role="columnheader">Mode</span>
                      <span role="columnheader">Enforcement</span>
                      <span role="columnheader">Lifecycle</span>
                      <span role="columnheader">Last change</span>
                    </div>
                    {functions.map((item) => (
                      <FitnessRow item={item} catalog={catalog} selected={item.id === selectedId} onSelect={() => setSelectedId(item.id)} key={item.id} />
                    ))}
                  </div>
                ) : catalog.functions.length === 0 ? (
                  <section className="empty-state onboarding-empty">
                    <div><CircleGauge size={23} /></div>
                    <h2>{catalog.squads.length === 0 ? "Set up your first squad" : "Create your first fitness function"}</h2>
                    <p>
                      {catalog.squads.length === 0
                        ? "Polaris needs an owning squad and a fitness target before it can define engineering controls."
                        : "Turn an architectural objective into a measurable, versioned engineering control."}
                    </p>
                    <button className="button primary" onClick={startCreation}>
                      <Plus size={16} />
                      {catalog.squads.length === 0 ? "Set up workspace" : "New fitness function"}
                    </button>
                  </section>
                ) : (
                  <section className="empty-state">
                    <div><SlidersHorizontal size={23} /></div>
                    <h2>No matching controls</h2>
                    <p>Adjust the filters or create a new fitness function for your squad.</p>
                    <button className="button secondary" onClick={() => { setSearch(""); setLifecycle("ALL"); setEnforcement("ALL"); setAcquisition("ALL"); }}>Clear filters</button>
                  </section>
                )}
              </section>
            </>
          )}
        </div>
      </main>

      {selected && catalog && <FitnessDetails item={selected} catalog={catalog} onClose={() => setSelectedId(undefined)} />}
      {createOpen && catalog && (
        <CreateFitnessFunction
          catalog={catalog}
          initialSquadId={creationSquadId}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); setSelectedId(id); }}
        />
      )}
      {setupOpen && catalog && (
        <SetupWorkspace
          catalog={catalog}
          onClose={() => setSetupOpen(false)}
          onReady={async (squadId) => {
            setSetupOpen(false);
            setCreationSquadId(squadId);
            await catalogQuery.refetch();
            setCreateOpen(true);
          }}
        />
      )}
    </div>
  );
}

function Metric({ label, value, note, icon, tone = "" }: { label: string; value: number; note: string; icon: ReactNode; tone?: string }) {
  return <article className={`metric-card ${tone}`}><div className="metric-icon">{icon}</div><div><p>{label}</p><strong>{value}</strong><span>{note}</span></div></article>;
}

function FilterSelect({ label, value, options, onChange, icon }: { label: string; value: string; options: string[]; onChange: (value: string) => void; icon?: ReactNode }) {
  return <label className="filter-select">{icon}<span>{value === "ALL" ? label : value}</span><select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>{options.map((option) => <option value={option} key={option}>{option === "ALL" ? `All ${label.toLowerCase()}` : option}</option>)}</select><ChevronDown size={14} /></label>;
}

function FitnessRow({ item, catalog, selected, onSelect }: { item: FitnessFunction; catalog: Catalog; selected: boolean; onSelect: () => void }) {
  const definition = activeDefinition(item);
  const squad = catalog.squads.find((candidate) => candidate.id === item.ownerSquadId);
  const latest = item.versions.at(-1);
  if (!definition) return null;
  return (
    <button className={clsx("table-row", selected && "selected")} role="row" onClick={onSelect}>
      <span className="function-cell" role="cell"><span className="quality-avatar">{initials(definition.characteristic ?? "FF")}</span><span><strong>{definition.name}</strong><small>{definition.characteristic ?? "Custom characteristic"} · v{item.activeVersion ?? latest?.number}</small></span></span>
      <span className="owner-cell" role="cell"><strong>{String(squad?.data.name ?? "Unknown")}</strong><small>{squad?.tribeName}</small></span>
      <span role="cell"><span className="mode-pill"><DatabaseZap size={13} /> {definition.acquisition.mode}</span></span>
      <span role="cell"><span className={`enforcement ${definition.enforcement.toLowerCase()}`}>{definition.enforcement}</span></span>
      <span role="cell"><span className={`status-pill ${item.lifecycle.toLowerCase()}`}><i /> {item.lifecycle}</span></span>
      <span className="last-change" role="cell">{relativeTime(latest?.activatedAt ?? latest?.createdAt)}</span>
    </button>
  );
}

function LoadingState() {
  return <section className="loading-state"><LoaderCircle className="spin" size={24} /><div><strong>Connecting to Polaris</strong><span>Loading tribes, squads, and controls…</span></div></section>;
}

function percent(value: number, total: number) {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}
