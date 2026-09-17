// Derived at request time (not module load) from wherever the page was
// loaded from, so the same frontend build works whether it's opened via
// localhost or a Tailscale hostname/IP -- no separate build per environment.
// NEXT_PUBLIC_API_URL still wins when set (e.g. a non-default backend port).
function apiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return "http://localhost:8000";
}

export type CandidateProfile = {
  id: number;
  name: string;
  email: string;
  phone: string;
  location: string;
  commute_radius_miles: number;
  remote_ok: boolean;
  linkedin_url: string;
  languages: string;
  summary: string;
  employment_type_preference: string;
};

export type SkillBankEntry = {
  id: number;
  skill: string;
  tier: "strong" | "moderate" | "weak";
  category: string;
  synonyms: string;
};

export type BulletLibraryEntry = {
  id: number;
  experience_id: number;
  text: string;
  keywords: string;
  sort_order: number;
};

export type ExperienceEntry = {
  id: number;
  title: string;
  company: string;
  location: string;
  start_date: string;
  end_date: string;
  sort_order: number;
  bullets: BulletLibraryEntry[];
};

export type EducationEntry = {
  id: number;
  degree: string;
  institution: string;
  period: string;
  key_topics: string;
  sort_order: number;
};

export type Evaluation = {
  id: number;
  job_id: number;
  technical_score: number;
  experience_score: number;
  experience_note: string;
  behavioral_score: number;
  behavioral_assessed: boolean;
  location_pass: boolean;
  location_note: string;
  career_alignment_score: number;
  salary_index: number | null;
  overall_score: number;
  matched_keywords: string[];
  gap_keywords: string[];
  computed_at: string;
};

export type JobPosting = {
  id: number;
  source_portal: string;
  url: string;
  company: string;
  title: string;
  location: string;
  employment_type: string;
  detected_platform: string;
  discovered_at: string;
  evaluation: Evaluation | null;
};

export type DiscoverResult = {
  portals_run: number;
  queries_run: number;
  results_seen: number;
  new_jobs: number;
  errors: string[];
  evaluated: number;
};

export type AtsValidation = {
  available: boolean;
  extraction_failed?: boolean;
  clean_extraction?: boolean;
  contact_info_present?: boolean;
  reading_order_ok?: boolean;
  keyword_coverage?: { keyword: string; covered: boolean }[];
  keywords_covered?: number;
  keywords_total?: number;
  pass?: boolean;
  note?: string;
};

export type ResumeVariant = {
  id: number;
  job_id: number;
  selected_bullet_ids: number[];
  html_path: string;
  pdf_path: string;
  ats_validation: AtsValidation;
  is_ready: boolean;
  created_at: string;
};

export type CoverLetterVariant = {
  id: number;
  job_id: number;
  template_name: string;
  merge_fields: Record<string, unknown>;
  pdf_path: string;
  created_at: string;
};

export type TailorResult = {
  resume_variant: ResumeVariant;
  cover_letter_variant: CoverLetterVariant;
  application_status: string;
};

export type Application = {
  id: number;
  job_id: number;
  resume_variant_id: number | null;
  cover_letter_variant_id: number | null;
  status: string;
  method: string;
  submitted_at: string | null;
  error_detail: string;
  job: JobPosting | null;
};

export type ApplicationEvent = {
  id: number;
  job_id: number;
  event_type: string;
  detail: string;
  timestamp: string;
};

export type ApplicationEventWithJob = ApplicationEvent & {
  company: string;
  title: string;
};

export type Settings = {
  fit_threshold: number;
  scheduler_interval_minutes: number;
  scheduler_paused: boolean;
  dry_run: boolean;
};

export type CredentialStatus = Record<string, boolean>;

export type QABankEntry = {
  id: number;
  question_pattern: string;
  is_regex: boolean;
  answer: string;
};

export type SchedulerStatus = {
  running: boolean;
  next_run_time?: string | null;
};

export type User = {
  id: number;
  email: string;
  created_at: string;
};

// Set by the auth guard right after a 401 so it can redirect without every
// individual page needing to catch and handle that case itself. A plain
// module-level flag (not React state) is enough since a redirect to /login
// unmounts everything else anyway.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiUrl()}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include", // sends the httponly session cookie
    ...init,
  });
  // Login/signup are expected to 401/400 on bad credentials -- that's a form
  // error for the caller to show, not a "your session expired" redirect.
  const isAuthAttempt = path === "/api/auth/login" || path === "/api/auth/signup";
  if (res.status === 401 && !isAuthAttempt) {
    onUnauthorized?.();
    throw new Error(`${init?.method ?? "GET"} ${path} failed: 401 Not logged in`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

export const api = {
  getProfile: () => request<CandidateProfile>("/api/resume/profile"),
  updateProfile: (profile: CandidateProfile) =>
    request<CandidateProfile>("/api/resume/profile", {
      method: "PUT",
      body: JSON.stringify(profile),
    }),
  getSkills: () => request<SkillBankEntry[]>("/api/resume/skills"),
  getExperience: () => request<ExperienceEntry[]>("/api/resume/experience"),
  getEducation: () => request<EducationEntry[]>("/api/resume/education"),
  updateBullet: (id: number, text: string) =>
    request<BulletLibraryEntry>(`/api/resume/bullets/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ text }),
    }),
  getJobs: () => request<JobPosting[]>("/api/jobs"),
  discoverJobs: () => request<DiscoverResult>("/api/jobs/discover", { method: "POST" }),
  addManualJob: (payload: { url: string; company?: string; title?: string; location?: string }) =>
    request<JobPosting>("/api/jobs/manual", { method: "POST", body: JSON.stringify(payload) }),
  recomputeEvaluation: (jobId: number) =>
    request<Evaluation>(`/api/evaluations/${jobId}/recompute`, { method: "POST" }),
  tailorJob: (jobId: number) => request<TailorResult>(`/api/jobs/${jobId}/tailor`, { method: "POST" }),
  resumePdfUrl: (jobId: number) => `${apiUrl()}/api/jobs/${jobId}/resume.pdf`,
  coverLetterPdfUrl: (jobId: number) => `${apiUrl()}/api/jobs/${jobId}/cover-letter.pdf`,
  getApplications: () => request<Application[]>("/api/applications"),
  getApplicationEvents: (jobId: number) => request<ApplicationEvent[]>(`/api/applications/${jobId}/events`),
  getRecentEvents: (limit = 20) =>
    request<ApplicationEventWithJob[]>(`/api/applications/events/recent?limit=${limit}`),
  applyToJob: (jobId: number) => request<Application>(`/api/applications/${jobId}/apply`, { method: "POST" }),
  getSettings: () => request<Settings>("/api/settings"),
  updateSettings: (patch: Partial<Settings>) =>
    request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),
  getCredentialStatus: () => request<CredentialStatus>("/api/credentials/status"),
  setCredential: (key: string, value: string) =>
    request<void>("/api/credentials", { method: "POST", body: JSON.stringify({ key, value }) }),
  deleteCredential: (key: string) => request<void>(`/api/credentials/${key}`, { method: "DELETE" }),
  getQABank: () => request<QABankEntry[]>("/api/qa-bank"),
  createQABankEntry: (entry: { question_pattern: string; is_regex: boolean; answer: string }) =>
    request<QABankEntry>("/api/qa-bank", { method: "POST", body: JSON.stringify(entry) }),
  deleteQABankEntry: (id: number) => request<void>(`/api/qa-bank/${id}`, { method: "DELETE" }),
  getSchedulerStatus: () => request<SchedulerStatus>("/api/scheduler/status"),
  runSchedulerNow: () => request<{ triggered: boolean }>("/api/scheduler/run-now", { method: "POST" }),
  signup: (email: string, password: string) =>
    request<User>("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<User>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ status: string }>("/api/auth/logout", { method: "POST" }),
  me: () => request<User>("/api/auth/me"),
};
