"use client";

import { useEffect, useState } from "react";
import { api, type DiscoverResult, type JobPosting, type TailorResult } from "@/lib/api";

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<DiscoverResult | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [minScore, setMinScore] = useState(0);

  // `loading` starts true via useState above; only the completion path here
  // needs to touch it, so calling this from useEffect's body doesn't trip
  // the "no setState synchronously in an effect" rule.
  const load = () => {
    api
      .getJobs()
      .then(setJobs)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const runDiscovery = async () => {
    setDiscovering(true);
    setError(null);
    try {
      const result = await api.discoverJobs();
      setLastRun(result);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDiscovering(false);
    }
  };

  const reevaluate = async (jobId: number) => {
    await api.recomputeEvaluation(jobId);
    load();
  };

  const addManualJob = async (url: string) => {
    await api.addManualJob({ url });
    load();
  };

  const sorted = [...jobs]
    .filter((j) => (j.evaluation?.overall_score ?? -1) >= minScore)
    .sort((a, b) => (b.evaluation?.overall_score ?? -1) - (a.evaluation?.overall_score ?? -1));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Jobs &amp; Evaluations</h1>
        <button
          onClick={runDiscovery}
          disabled={discovering}
          className="rounded-md bg-foreground text-background px-4 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {discovering ? "Discovering..." : "Discover new jobs"}
        </button>
      </div>

      {lastRun && (
        <p className="text-xs text-foreground/60">
          Last run: {lastRun.queries_run} queries, {lastRun.results_seen} results seen,{" "}
          {lastRun.new_jobs} new, {lastRun.evaluated} evaluated.
          {lastRun.errors.length > 0 && ` ${lastRun.errors.length} query error(s).`}
        </p>
      )}

      {error && (
        <div className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm">{error}</div>
      )}

      <AddManualJobForm onAdd={addManualJob} />

      <label className="flex items-center gap-2 text-sm">
        Min score
        <input
          type="range"
          min={0}
          max={100}
          value={minScore}
          onChange={(e) => setMinScore(Number(e.target.value))}
        />
        <span className="tabular-nums">{minScore}</span>
      </label>

      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : sorted.length === 0 ? (
        <p className="text-foreground/60">No jobs yet. Click &quot;Discover new jobs&quot; to run a search.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              expanded={expanded === job.id}
              onToggle={() => setExpanded(expanded === job.id ? null : job.id)}
              onReevaluate={() => reevaluate(job.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddManualJobForm({ onAdd }: { onAdd: (url: string) => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!url) return;
    setAdding(true);
    setError(null);
    try {
      await onAdd(url);
      setUrl("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste a job posting URL to add and evaluate it manually"
        className="flex-1 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-2.5 py-1.5 text-sm"
      />
      <button
        onClick={submit}
        disabled={adding || !url}
        className="rounded-md border border-black/10 dark:border-white/15 px-3 py-1.5 text-xs disabled:opacity-50"
      >
        {adding ? "Adding..." : "Add job"}
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

function scoreColor(score: number | undefined) {
  if (score === undefined) return "text-foreground/40";
  if (score >= 70) return "text-green-600 dark:text-green-400";
  if (score >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-foreground/50";
}

function JobRow({
  job,
  expanded,
  onToggle,
  onReevaluate,
}: {
  job: JobPosting;
  expanded: boolean;
  onToggle: () => void;
  onReevaluate: () => void;
}) {
  const e = job.evaluation;
  const [tailoring, setTailoring] = useState(false);
  const [tailorResult, setTailorResult] = useState<TailorResult | null>(null);
  const [tailorError, setTailorError] = useState<string | null>(null);

  const runTailor = async () => {
    setTailoring(true);
    setTailorError(null);
    try {
      const result = await api.tailorJob(job.id);
      setTailorResult(result);
    } catch (err) {
      setTailorError((err as Error).message);
    } finally {
      setTailoring(false);
    }
  };
  return (
    <div className="rounded-md border border-black/10 dark:border-white/15">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm">
        <span className={`w-12 shrink-0 font-semibold tabular-nums ${scoreColor(e?.overall_score)}`}>
          {e ? e.overall_score.toFixed(0) : "--"}
        </span>
        <span className="flex-1 min-w-0">
          <span className="font-medium">{job.title}</span>
          <span className="text-foreground/60"> - {job.company}</span>
        </span>
        <span className="text-xs text-foreground/50 shrink-0">{job.location}</span>
        {e && !e.location_pass && (
          <span className="text-xs rounded-full bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-0.5 shrink-0">
            location fail
          </span>
        )}
        <span className="text-xs text-foreground/40 shrink-0">{job.detected_platform}</span>
      </button>
      {expanded && (
        <div className="border-t border-black/10 dark:border-white/15 px-3 py-3 text-sm space-y-2">
          <a href={job.url} target="_blank" rel="noreferrer" className="text-xs underline">
            View posting
          </a>
          {e ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Metric label="Technical" value={e.technical_score} />
                <Metric label="Experience" value={e.experience_score} />
                <Metric label="Behavioral" value={e.behavioral_score} note={e.behavioral_assessed ? undefined : "unassessed"} />
                <Metric label="Career" value={e.career_alignment_score} />
              </div>
              <p className="text-xs text-foreground/60">{e.experience_note}</p>
              <p className="text-xs text-foreground/60">{e.location_note}</p>
              {e.salary_index !== null && (
                <p className="text-xs text-foreground/60">Salary index: {e.salary_index}</p>
              )}
              {e.matched_keywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {e.matched_keywords.map((k) => (
                    <span key={k} className="rounded-full border border-black/10 dark:border-white/15 px-2 py-0.5 text-xs">
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-foreground/60 text-xs">Not evaluated yet.</p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onReevaluate}
              className="rounded-md border border-black/10 dark:border-white/15 px-2.5 py-1 text-xs"
            >
              Re-evaluate
            </button>
            <button
              onClick={runTailor}
              disabled={tailoring || !e}
              className="rounded-md bg-foreground text-background px-2.5 py-1 text-xs disabled:opacity-50"
            >
              {tailoring ? "Tailoring..." : "Tailor resume + cover letter"}
            </button>
          </div>

          {tailorError && (
            <div className="rounded-md border border-red-400/40 bg-red-500/10 p-2 text-xs">{tailorError}</div>
          )}

          {tailorResult && (
            <div className="rounded-md border border-black/10 dark:border-white/15 p-2.5 space-y-1.5">
              <p className="text-xs">
                Status:{" "}
                <span className={tailorResult.resume_variant.is_ready ? "text-green-600 dark:text-green-400" : "text-yellow-600 dark:text-yellow-400"}>
                  {tailorResult.application_status}
                </span>
              </p>
              {tailorResult.resume_variant.ats_validation.available ? (
                <p className="text-xs text-foreground/60">
                  ATS check: {tailorResult.resume_variant.ats_validation.keywords_covered}/
                  {tailorResult.resume_variant.ats_validation.keywords_total} keywords covered
                  {tailorResult.resume_variant.ats_validation.pass ? ", all checks passed" : ", some checks failed"}
                </p>
              ) : (
                <p className="text-xs text-foreground/60">{tailorResult.resume_variant.ats_validation.note}</p>
              )}
              <div className="flex gap-3">
                <a href={api.resumePdfUrl(job.id)} target="_blank" rel="noreferrer" className="text-xs underline">
                  View resume PDF
                </a>
                <a href={api.coverLetterPdfUrl(job.id)} target="_blank" rel="noreferrer" className="text-xs underline">
                  View cover letter PDF
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div>
      <div className="text-foreground/50">{label}</div>
      <div className="font-medium tabular-nums">
        {value.toFixed(0)}
        {note && <span className="text-foreground/40 font-normal"> ({note})</span>}
      </div>
    </div>
  );
}
