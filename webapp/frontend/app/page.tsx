"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  api,
  type Application,
  type ApplicationEventWithJob,
  type JobPosting,
  type SchedulerStatus,
  type Settings,
} from "@/lib/api";
import { formatEasternTime } from "@/lib/format";

const TAILORED_READY_STATUSES = ["tailoring", "ready", "applying"];

export default function DashboardPage() {
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [events, setEvents] = useState<ApplicationEventWithJob[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `loading` starts true via useState above; only the completion path here
  // needs to touch it, so calling this from useEffect's body doesn't trip
  // the "no setState synchronously in an effect" rule.
  const load = () => {
    Promise.all([
      api.getJobs(),
      api.getApplications(),
      api.getRecentEvents(20),
      api.getSchedulerStatus(),
      api.getSettings(),
    ])
      .then(([j, a, e, sched, s]) => {
        setJobs(j);
        setApplications(a);
        setEvents(e);
        setSchedulerStatus(sched);
        setSettings(s);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <p className="text-foreground/60">Loading...</p>;
  if (error) {
    return <div className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm">{error}</div>;
  }

  const discovered = jobs.length;
  const evaluated = jobs.filter((j) => j.evaluation !== null).length;
  const tailoredReady = applications.filter((a) => TAILORED_READY_STATUSES.includes(a.status)).length;
  const applied = applications.filter((a) => a.status === "applied").length;
  const needsManual = applications.filter((a) => a.status === "needs_manual").length;
  const failed = applications.filter((a) => a.status === "failed").length;

  const scores = jobs.map((j) => j.evaluation?.overall_score).filter((s): s is number => s !== undefined);
  const strong = scores.filter((s) => s >= 70).length;
  const moderate = scores.filter((s) => s >= 50 && s < 70).length;
  const weak = scores.filter((s) => s < 50).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-foreground/70 text-sm">
          Discover -&gt; evaluate -&gt; tailor -&gt; apply pipeline overview.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Pipeline funnel</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <StatTile label="Discovered" value={discovered} />
          <StatTile label="Evaluated" value={evaluated} />
          <StatTile label="Tailored/Ready" value={tailoredReady} />
          <StatTile label="Applied" value={applied} tone="green" />
          <StatTile label="Needs manual" value={needsManual} tone="orange" />
          <StatTile label="Failed" value={failed} tone="red" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Score distribution</h2>
        {scores.length === 0 ? (
          <p className="text-sm text-foreground/60">No evaluated jobs yet.</p>
        ) : (
          <div className="space-y-1.5 max-w-md">
            <ScoreBar label="70+ (strong fit)" count={strong} total={scores.length} tone="green" />
            <ScoreBar label="50-69 (moderate fit)" count={moderate} total={scores.length} tone="yellow" />
            <ScoreBar label="Below 50 (weak fit)" count={weak} total={scores.length} tone="red" />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Recent activity</h2>
        {events.length === 0 ? (
          <p className="text-sm text-foreground/60">No application events logged yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="rounded-md border border-black/10 dark:border-white/15 px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {ev.title} <span className="text-foreground/60 font-normal">- {ev.company}</span>
                  </span>
                  <span className="text-foreground/40 shrink-0 tabular-nums">
                    {formatEasternTime(ev.timestamp)}
                  </span>
                </div>
                <p className="text-foreground/60 mt-0.5">
                  {ev.event_type}: {ev.detail}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Scheduler &amp; safety</h2>
        <div className="rounded-md border border-black/10 dark:border-white/15 p-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-2">
          <span>
            Scheduler:{" "}
            <span
              className={
                schedulerStatus?.running && !settings?.scheduler_paused
                  ? "text-green-600 dark:text-green-400 font-medium"
                  : "text-foreground/60 font-medium"
              }
            >
              {schedulerStatus?.running ? (settings?.scheduler_paused ? "Running (paused)" : "Running") : "Not running"}
            </span>
          </span>
          <span>
            Dry run:{" "}
            <span
              className={
                settings?.dry_run
                  ? "text-yellow-600 dark:text-yellow-400 font-medium"
                  : "text-red-600 dark:text-red-400 font-medium"
              }
            >
              {settings?.dry_run ? "On (safe)" : "Off (live submissions)"}
            </span>
          </span>
          <span className="text-foreground/60">Fit threshold: {settings?.fit_threshold}</span>
          <Link href="/settings" className="text-xs underline">
            Manage in Settings
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Quick links</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/jobs"
            className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium"
          >
            Jobs
          </Link>
          <Link
            href="/applications"
            className="rounded-md border border-black/10 dark:border-white/15 px-4 py-2 text-sm font-medium"
          >
            Applications
          </Link>
          <Link
            href="/settings"
            className="rounded-md border border-black/10 dark:border-white/15 px-4 py-2 text-sm font-medium"
          >
            Settings
          </Link>
        </div>
      </section>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "green" | "orange" | "red";
}) {
  const toneClass =
    tone === "green"
      ? "text-green-600 dark:text-green-400"
      : tone === "orange"
        ? "text-orange-600 dark:text-orange-400"
        : tone === "red"
          ? "text-red-600 dark:text-red-400"
          : "text-foreground";
  return (
    <div className="rounded-md border border-black/10 dark:border-white/15 p-3">
      <div className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      <div className="text-xs text-foreground/60">{label}</div>
    </div>
  );
}

function ScoreBar({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: "green" | "yellow" | "red";
}) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  const barTone =
    tone === "green" ? "bg-green-600 dark:bg-green-400" : tone === "yellow" ? "bg-yellow-600 dark:bg-yellow-400" : "bg-red-600 dark:bg-red-400";
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-foreground/70">{label}</span>
        <span className="tabular-nums text-foreground/60">
          {count} ({pct}%)
        </span>
      </div>
      <div className="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
        <div className={`h-full ${barTone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
