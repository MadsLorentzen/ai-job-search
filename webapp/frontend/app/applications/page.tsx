"use client";

import { useEffect, useState } from "react";
import { api, type Application, type ApplicationEvent } from "@/lib/api";
import { formatEasternTime } from "@/lib/format";

const STATUS_COLOR: Record<string, string> = {
  ready: "text-blue-600 dark:text-blue-400",
  applying: "text-yellow-600 dark:text-yellow-400",
  applied: "text-green-600 dark:text-green-400",
  needs_manual: "text-orange-600 dark:text-orange-400",
  failed: "text-red-600 dark:text-red-400",
};

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = () => {
    api
      .getApplications()
      .then(setApplications)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <p className="text-foreground/60">Loading...</p>;
  if (error) return <div className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm">{error}</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Applications</h1>
      {applications.length === 0 ? (
        <p className="text-foreground/60">
          No applications yet. Tailor a job from the Jobs page first -- that creates the application
          record this page tracks.
        </p>
      ) : (
        <div className="space-y-2">
          {applications.map((app) => (
            <ApplicationRow
              key={app.id}
              app={app}
              expanded={expanded === app.id}
              onToggle={() => setExpanded(expanded === app.id ? null : app.id)}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApplicationRow({
  app,
  expanded,
  onToggle,
  onChanged,
}: {
  app: Application;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (expanded) {
      api.getApplicationEvents(app.job_id).then(setEvents);
    }
  }, [expanded, app.job_id]);

  const runApply = async () => {
    setApplying(true);
    setError(null);
    try {
      await api.applyToJob(app.job_id);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rounded-md border border-black/10 dark:border-white/15">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm">
        <span className={`w-24 shrink-0 font-medium ${STATUS_COLOR[app.status] ?? ""}`}>{app.status}</span>
        <span className="flex-1 min-w-0">
          <span className="font-medium">{app.job?.title}</span>
          <span className="text-foreground/60"> - {app.job?.company}</span>
        </span>
        <span className="text-xs text-foreground/40 shrink-0">{app.job?.detected_platform}</span>
      </button>
      {expanded && (
        <div className="border-t border-black/10 dark:border-white/15 px-3 py-3 text-sm space-y-2">
          {app.job && (
            <a href={app.job.url} target="_blank" rel="noreferrer" className="text-xs underline">
              View posting
            </a>
          )}
          {app.error_detail && <p className="text-xs text-foreground/60">{app.error_detail}</p>}
          <div className="flex gap-3">
            <a href={api.resumePdfUrl(app.job_id)} target="_blank" rel="noreferrer" className="text-xs underline">
              Resume PDF
            </a>
            <a href={api.coverLetterPdfUrl(app.job_id)} target="_blank" rel="noreferrer" className="text-xs underline">
              Cover letter PDF
            </a>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-foreground/60 mb-1">Event log</h3>
            <ul className="space-y-1">
              {events.map((ev) => (
                <li key={ev.id} className="text-xs text-foreground/60">
                  <span className="tabular-nums">{formatEasternTime(ev.timestamp)}</span> - {ev.event_type}:{" "}
                  {ev.detail}
                </li>
              ))}
              {events.length === 0 && <li className="text-xs text-foreground/40">No events yet.</li>}
            </ul>
          </div>

          {error && <div className="rounded-md border border-red-400/40 bg-red-500/10 p-2 text-xs">{error}</div>}

          <button
            onClick={runApply}
            disabled={applying || app.status !== "ready"}
            className="rounded-md bg-foreground text-background px-2.5 py-1 text-xs disabled:opacity-50"
            title={app.status !== "ready" ? `Status must be "ready" to apply (currently "${app.status}")` : undefined}
          >
            {applying ? "Applying..." : "Apply now"}
          </button>
        </div>
      )}
    </div>
  );
}
