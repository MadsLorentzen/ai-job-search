"use client";

import { useEffect, useState } from "react";
import { api, type CredentialStatus, type QABankEntry, type SchedulerStatus, type Settings } from "@/lib/api";
import { formatEasternTime } from "@/lib/format";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [credStatus, setCredStatus] = useState<CredentialStatus>({});
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [qaBank, setQaBank] = useState<QABankEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    Promise.all([api.getSettings(), api.getCredentialStatus(), api.getSchedulerStatus(), api.getQABank()])
      .then(([s, c, sched, qa]) => {
        setSettings(s);
        setCredStatus(c);
        setSchedulerStatus(sched);
        setQaBank(qa);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const updateSetting = async (patch: Partial<Settings>) => {
    const updated = await api.updateSettings(patch);
    setSettings(updated);
  };

  if (loading) return <p className="text-foreground/60">Loading...</p>;
  if (error) return <div className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm">{error}</div>;
  if (!settings) return null;

  return (
    <div className="space-y-8 max-w-xl">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Safety controls</h2>
        <div className="rounded-md border border-yellow-400/40 bg-yellow-500/10 p-3 text-xs">
          <strong>Dry run</strong> stops every automated application at the final submit step and
          just logs what it would have done. Turning it off means real applications get submitted
          with no per-application confirmation. Only turn it off after reviewing dry-run results for
          each connector (LinkedIn / Greenhouse / Lever) individually.
        </div>
        <Toggle
          label="Dry run (recommended: on)"
          checked={settings.dry_run}
          onChange={(dry_run) => updateSetting({ dry_run })}
        />
        <Toggle
          label="Scheduler paused"
          checked={settings.scheduler_paused}
          onChange={(scheduler_paused) => updateSetting({ scheduler_paused })}
        />
        <label className="flex items-center gap-2 text-sm">
          Fit threshold (auto-apply at or above)
          <input
            type="number"
            min={0}
            max={100}
            value={settings.fit_threshold}
            onChange={(e) => updateSetting({ fit_threshold: Number(e.target.value) })}
            className="w-20 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Scheduler interval (minutes)
          <input
            type="number"
            min={5}
            value={settings.scheduler_interval_minutes}
            onChange={(e) => updateSetting({ scheduler_interval_minutes: Number(e.target.value) })}
            className="w-20 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-2 py-1"
          />
        </label>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Scheduler</h2>
        <p className="text-xs text-foreground/60">
          {schedulerStatus?.running ? "Running" : "Not running"}
          {schedulerStatus?.next_run_time && ` -- next cycle at ${formatEasternTime(schedulerStatus.next_run_time)}`}
        </p>
        <button
          onClick={async () => {
            await api.runSchedulerNow();
            load();
          }}
          className="rounded-md border border-black/10 dark:border-white/15 px-3 py-1.5 text-xs"
        >
          Run one cycle now
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">LinkedIn credentials</h2>
        <p className="text-xs text-foreground/60">
          Stored in the macOS Keychain, never in a plaintext file. Used for automated Easy Apply login.
          Automating LinkedIn is against its Terms of Service and risks the account being rate-limited
          or suspended -- this was an informed decision, not a default you should treat lightly.
        </p>
        <CredentialField
          credKey="linkedin_username"
          label="Username / email"
          type="text"
          configured={credStatus.linkedin_username}
          onSaved={load}
        />
        <CredentialField
          credKey="linkedin_password"
          label="Password"
          type="password"
          configured={credStatus.linkedin_password}
          onSaved={load}
        />
      </section>

      <QABankSection entries={qaBank} onChanged={load} />
    </div>
  );
}

function QABankSection({ entries, onChanged }: { entries: QABankEntry[]; onChanged: () => void }) {
  const [pattern, setPattern] = useState("");
  const [answer, setAnswer] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!pattern || !answer) return;
    setSaving(true);
    try {
      await api.createQABankEntry({ question_pattern: pattern, is_regex: isRegex, answer });
      setPattern("");
      setAnswer("");
      setIsRegex(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Screening question answers</h2>
      <p className="text-xs text-foreground/60">
        Used to auto-fill custom screening questions during automated applications (e.g. years of
        experience, sponsorship, salary expectations). Matched by substring, or by regex if checked.
      </p>
      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-center gap-2 text-sm">
            <code className="flex-1 rounded bg-black/5 dark:bg-white/10 px-2 py-1 text-xs">
              {entry.is_regex ? `/${entry.question_pattern}/` : entry.question_pattern}
            </code>
            <span className="flex-1 text-foreground/70">{entry.answer}</span>
            <button
              onClick={async () => {
                await api.deleteQABankEntry(entry.id);
                onChanged();
              }}
              className="text-xs text-red-600 dark:text-red-400"
            >
              Remove
            </button>
          </li>
        ))}
        {entries.length === 0 && <li className="text-xs text-foreground/40">No entries yet.</li>}
      </ul>
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm flex-1">
          <span className="text-foreground/70">Question pattern</span>
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="years of experience"
            className="rounded-md border border-black/10 dark:border-white/15 bg-transparent px-2.5 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm flex-1">
          <span className="text-foreground/70">Answer</span>
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="8 years"
            className="rounded-md border border-black/10 dark:border-white/15 bg-transparent px-2.5 py-1.5"
          />
        </label>
        <label className="flex items-center gap-1 text-xs pb-2">
          <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)} />
          regex
        </label>
        <button
          onClick={add}
          disabled={saving || !pattern || !answer}
          className="rounded-md bg-foreground text-background px-3 py-1.5 text-xs disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function CredentialField({
  credKey,
  label,
  type,
  configured,
  onSaved,
}: {
  credKey: string;
  label: string;
  type: "text" | "password";
  configured: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!value) return;
    setSaving(true);
    try {
      await api.setCredential(credKey, value);
      setValue("");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    await api.deleteCredential(credKey);
    onSaved();
  };

  return (
    <div className="flex items-center gap-2">
      <label className="flex-1 flex flex-col gap-1 text-sm">
        <span className="text-foreground/70">
          {label} {configured && <span className="text-green-600 dark:text-green-400">(configured)</span>}
        </span>
        <input
          type={type}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={configured ? "•••••••• (enter a new value to replace)" : "not set"}
          className="rounded-md border border-black/10 dark:border-white/15 bg-transparent px-2.5 py-1.5"
          autoComplete="off"
        />
      </label>
      <button
        onClick={save}
        disabled={saving || !value}
        className="mt-5 rounded-md bg-foreground text-background px-3 py-1.5 text-xs disabled:opacity-50"
      >
        Save
      </button>
      {configured && (
        <button onClick={clear} className="mt-5 rounded-md border border-black/10 dark:border-white/15 px-3 py-1.5 text-xs">
          Clear
        </button>
      )}
    </div>
  );
}
