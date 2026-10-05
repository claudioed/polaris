import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { pollEvents } from "../api";
import { relativeTime } from "../utils";

const CONSUMER_KEY = "polaris.activity.consumerId";
const CURSOR_KEY = "polaris.activity.cursor";
const MAX_EVENTS = 200;

function consumerId(): string {
  let id = sessionStorage.getItem(CONSUMER_KEY);
  if (!id) {
    id = `control-tower-${crypto.randomUUID().slice(0, 8)}`;
    sessionStorage.setItem(CONSUMER_KEY, id);
  }
  return id;
}

/**
 * Read-only activity feed over the transactional-outbox `/events` endpoint.
 *
 * The feed POLLS but never ACKS: `POST /event-acknowledgements` exists for
 * at-most-once processors (webhooks, relays), and a human-facing feed that
 * hid events after one viewing would be wrong. Instead each tab session gets
 * a stable `consumerId` and persists its cursor in sessionStorage (same
 * storage the auth session uses) — opening the feed drains current history
 * (capped), and while the tab lives, polls fetch only new events. Other
 * consumers are unaffected; cursors are scoped per consumerId server-side.
 */
export function ActivityWorkspace() {
  const [consumer] = useState(consumerId);
  const cursor = useMemo(() => Number(sessionStorage.getItem(CURSOR_KEY) ?? "0"), []);

  const query = useQuery({
    queryKey: ["activity", consumer, cursor],
    queryFn: async () => {
      const result = await pollEvents(consumer, cursor);
      sessionStorage.setItem(CURSOR_KEY, String(result.nextCursor));
      return result.events.slice(0, MAX_EVENTS);
    },
    refetchInterval: 30_000,
  });

  const events = query.data ?? [];

  return (
    <div className="content">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Architecture intelligence</p>
          <h1>Activity</h1>
          <p>Domain events published through the Polaris transactional outbox, newest first.</p>
        </div>
        <button className="button secondary" onClick={() => query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
          Refresh
        </button>
      </section>

      <section className="catalog-panel">
        <div className="workspace-toolbar">
          <span className="eyebrow">{events.length} events · auto-refreshes every 30s</span>
          {query.isFetching && <LoaderCircle className="spin" size={16} />}
        </div>

        {query.isLoading && (
          <div className="loading-state">
            <LoaderCircle className="spin" size={22} />
            <div>
              <strong>Loading activity</strong>
              <span>Draining the event feed…</span>
            </div>
          </div>
        )}

        {query.isError && (
          <div className="error-state">
            <CircleAlert size={22} />
            <div>
              <h2>Could not load activity</h2>
              <p>{(query.error as Error).message}</p>
            </div>
            <button className="button secondary" onClick={() => query.refetch()}>
              <RefreshCw size={16} /> Retry
            </button>
          </div>
        )}

        {!query.isLoading && !query.isError && events.length === 0 && (
          <section className="empty-state">
            <div><Activity size={23} /></div>
            <h2>No events yet</h2>
            <p>Changes to fitness functions, evaluations, and waivers will appear here as they happen.</p>
          </section>
        )}

        {!query.isLoading && !query.isError && events.length > 0 && (
          <div className="activity-list">
            {events
              .slice()
              .reverse()
              .map((event) => (
                <article className="activity-row" key={event.id}>
                  <span className={`activity-dot ${event.actor === "system" ? "system" : ""}`} />
                  <div>
                    <strong>{event.type}</strong>
                    <small>
                      {event.aggregateType} · {event.aggregateId.slice(0, 8)} · {relativeTime(event.occurredAt)}
                    </small>
                  </div>
                  <code className="activity-correlation" title={event.correlationId}>
                    {event.correlationId.slice(0, 8)}
                  </code>
                </article>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
