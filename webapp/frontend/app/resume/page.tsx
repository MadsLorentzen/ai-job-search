"use client";

import { useEffect, useState } from "react";
import {
  api,
  type BulletLibraryEntry,
  type CandidateProfile,
  type EducationEntry,
  type ExperienceEntry,
  type SkillBankEntry,
} from "@/lib/api";

export default function ResumePage() {
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [skills, setSkills] = useState<SkillBankEntry[]>([]);
  const [experience, setExperience] = useState<ExperienceEntry[]>([]);
  const [education, setEducation] = useState<EducationEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getProfile(), api.getSkills(), api.getExperience(), api.getEducation()])
      .then(([p, s, e, ed]) => {
        setProfile(p);
        setSkills(s);
        setExperience(e);
        setEducation(ed);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-foreground/60">Loading resume data...</p>;
  if (error) {
    return (
      <div className="rounded-md border border-red-400/40 bg-red-500/10 p-4 text-sm">
        <p className="font-medium">Couldn&apos;t reach the backend.</p>
        <p className="text-foreground/70 mt-1">{error}</p>
        <p className="text-foreground/70 mt-1">
          Is the API running? (<code>uvicorn app.main:app --port 8000</code>)
        </p>
      </div>
    );
  }
  if (!profile) return null;

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">Resume Manager</h1>
      <ProfileSection profile={profile} onSaved={setProfile} />
      <SkillsSection skills={skills} />
      <ExperienceSection experience={experience} setExperience={setExperience} />
      <EducationSection education={education} />
    </div>
  );
}

function ProfileSection({
  profile,
  onSaved,
}: {
  profile: CandidateProfile;
  onSaved: (p: CandidateProfile) => void;
}) {
  const [form, setForm] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const field = (key: keyof CandidateProfile) => ({
    value: form[key] as string | number,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [key]: e.target.value }),
  });

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateProfile(form);
      onSaved(updated);
      setForm(updated);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Profile</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <LabeledInput label="Name" {...field("name")} />
        <LabeledInput label="Email" {...field("email")} />
        <LabeledInput label="Phone" {...field("phone")} />
        <LabeledInput label="LinkedIn" {...field("linkedin_url")} />
        <LabeledInput label="Languages" {...field("languages")} />
        <LabeledInput label="Employment type preference" {...field("employment_type_preference")} />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={form.remote_ok}
            onChange={(e) => setForm({ ...form, remote_ok: e.target.checked })}
          />
          Open to fully remote
        </label>
        <LabeledTextarea label="Location / commute constraints" className="sm:col-span-2" {...field("location")} />
        <LabeledTextarea label="Summary" className="sm:col-span-2" {...field("summary")} />
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-foreground text-background px-4 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save profile"}
        </button>
        {savedAt && <span className="text-xs text-foreground/50">Saved</span>}
      </div>
    </section>
  );
}

function SkillsSection({ skills }: { skills: SkillBankEntry[] }) {
  const tiers: SkillBankEntry["tier"][] = ["strong", "moderate", "weak"];
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Skill bank</h2>
      <p className="text-sm text-foreground/60">
        Tier assignment feeds the Technical Skills Match dimension in Phase 2. Read-only for now.
      </p>
      {tiers.map((tier) => {
        const items = skills.filter((s) => s.tier === tier);
        if (items.length === 0) return null;
        return (
          <div key={tier}>
            <h3 className="text-sm font-semibold capitalize text-foreground/70">{tier} ({items.length})</h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {items.map((s) => (
                <span
                  key={s.id}
                  className="rounded-full border border-black/10 dark:border-white/15 px-2.5 py-0.5 text-xs"
                >
                  {s.skill}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function ExperienceSection({
  experience,
  setExperience,
}: {
  experience: ExperienceEntry[];
  setExperience: (e: ExperienceEntry[]) => void;
}) {
  const updateBulletText = (expId: number, bulletId: number, text: string) => {
    setExperience(
      experience.map((exp) =>
        exp.id !== expId
          ? exp
          : { ...exp, bullets: exp.bullets.map((b) => (b.id === bulletId ? { ...b, text } : b)) }
      )
    );
  };

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-medium">Experience &amp; bullet library</h2>
      {experience.map((exp) => (
        <div key={exp.id} className="space-y-2">
          <div>
            <p className="font-medium">
              {exp.title} <span className="text-foreground/60">- {exp.company}</span>
            </p>
            <p className="text-xs text-foreground/50">
              {exp.start_date} - {exp.end_date} · {exp.location}
            </p>
          </div>
          <ul className="space-y-2">
            {exp.bullets.map((bullet) => (
              <BulletRow
                key={bullet.id}
                bullet={bullet}
                onChange={(text) => updateBulletText(exp.id, bullet.id, text)}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function BulletRow({
  bullet,
  onChange,
}: {
  bullet: BulletLibraryEntry;
  onChange: (text: string) => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateBullet(bullet.id, bullet.text);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="flex items-start gap-2">
      <textarea
        className="flex-1 rounded-md border border-black/10 dark:border-white/15 bg-transparent p-2 text-sm"
        rows={2}
        value={bullet.text}
        onChange={(e) => {
          onChange(e.target.value);
          setDirty(true);
        }}
      />
      <button
        onClick={save}
        disabled={!dirty || saving}
        className="shrink-0 rounded-md border border-black/10 dark:border-white/15 px-2.5 py-1 text-xs disabled:opacity-40"
      >
        {saving ? "..." : "Save"}
      </button>
    </li>
  );
}

function EducationSection({ education }: { education: EducationEntry[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Education</h2>
      <ul className="space-y-2">
        {education.map((ed) => (
          <li key={ed.id} className="text-sm">
            <span className="font-medium">{ed.degree}</span>
            <span className="text-foreground/60"> - {ed.institution} ({ed.period})</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LabeledInput({
  label,
  className = "",
  ...props
}: { label: string; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      <span className="text-foreground/70">{label}</span>
      <input
        {...props}
        className="rounded-md border border-black/10 dark:border-white/15 bg-transparent px-2.5 py-1.5"
      />
    </label>
  );
}

function LabeledTextarea({
  label,
  className = "",
  ...props
}: { label: string; className?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      <span className="text-foreground/70">{label}</span>
      <textarea
        {...props}
        rows={2}
        className="rounded-md border border-black/10 dark:border-white/15 bg-transparent px-2.5 py-1.5"
      />
    </label>
  );
}
