// Shared types for pipeline-sync.

export type JobStatus =
  | "new"
  | "triaged"
  | "referral_request_ready"
  | "referral_pending"
  | "ready_to_apply"
  | "applied"
  | "interview"
  | "outcome"
  | "skipped"

export type WarmodeStatus =
  | "new"
  | "researching"
  | "outreach_sent"
  | "conversation"
  | "outcome"

export const JOB_STAGE_FOLDERS: Record<JobStatus, string> = {
  new: "01 New",
  triaged: "02 Triaged",
  referral_request_ready: "03 Referral Request Ready",
  referral_pending: "04 Referral Pending",
  ready_to_apply: "05 Ready to Apply",
  applied: "06 Applied",
  interview: "07 Interview",
  outcome: "08 Outcome",
  skipped: "09 Skipped",
}

export const WARMODE_STAGE_FOLDERS: Record<WarmodeStatus, string> = {
  new: "01 New",
  researching: "02 Researching",
  outreach_sent: "03 Outreach Sent",
  conversation: "04 Conversation",
  outcome: "05 Outcome",
}

// ---------- Source JSON shapes ----------

export interface SeenJobsFile {
  seen: Record<string, SeenJob>
}

export interface SeenJob {
  title: string
  company: string | null
  url: string
  first_seen?: string
  fit?: "very high" | "high" | "medium" | "low" | null
  fit_score?: number | null
  status?: string
  source?: string
  // Newer entries may also carry these; otherwise treated as defaults.
  date_posted?: string
  location?: string | null
  description?: string | null
  why?: string | null
}

export interface BrowserFindsFile {
  last_run?: string
  finds: BrowserFind[]
}

export interface BrowserFind {
  url: string
  title: string
  company: string | null
  location?: string | null
  posted_date?: string | null
  source?: string
  raw_description_snippet?: string
  fit_signal?: "very high" | "high" | "medium" | "low" | null
  why?: string | null
  status?: string
  fit_score?: number | null
  first_seen?: string
}

export interface WarmodeLeadsFile {
  last_run?: string
  leads: WarmodeLead[]
  _purpose?: string
}

export interface WarmodeLead {
  company: string
  url?: string | null
  location?: string | null
  stage?: string | null
  ai_native?: string | null
  gtm_motion?: string | null
  roles_hiring?: string[]
  source?: string
  lead_signal?: "high" | "medium" | "low" | null
  why?: string | null
  status?: string
  first_seen?: string
}

export interface ReferralsFile {
  companies: ReferralCompany[]
  summary?: Record<string, unknown>
}

export interface ReferralCompany {
  company: string
  in_lists?: string[]
  tier1_email?: { status?: string; detail?: string }
  tier2_linkedin?: {
    status?: string
    current_employees?: ReferralPerson[]
    connectors?: ReferralPerson[]
    note?: string
  }
  tier3_coach_dashboard?: { connections?: number | null; url?: string; note?: string }
}

export interface ReferralPerson {
  name: string
  headline?: string
  mutual_connections?: string
  followers?: string
  note?: string
}

export interface StrongConnectionsFile {
  _explicitly_deprioritized?: string
  strong_connections: StrongConnection[]
}

export interface StrongConnection {
  name: string
  linkedin?: string | null
  role?: string | null
  company?: string | null
  location?: string | null
  followers?: string
  mutual_connections?: string
  status?: string
  note?: string
}

export interface ReferralPaths2HopFile {
  paths_by_broker: Record<string, BrokerPaths>
}

export interface PipelineActionsFile {
  actions: Record<string, PipelineActions>
}

export interface PipelineActions {
  outreach?: OutreachEvent[]
  follow_up_due?: string
  fallback_plan?: string
  materials?: Materials
  referral_request?: ReferralRequest
}

// A drafted referral ask: who/how to reach (channel) + the message to send.
export interface ReferralRequest {
  channel: string
  message: string
}

export interface Materials {
  cv?: string
  cv_pdf?: string
  cover_letter?: string
  cover_letter_pdf?: string
  notes?: string
}

export interface OutreachEvent {
  date: string
  channel: string
  to: string
  via_broker?: string
  note?: string
  outcome?: "pending" | "responded" | "intro_made" | "declined" | "no_response"
}

export interface BrokerPaths {
  broker_linkedin?: string | null
  broker_role?: string | null
  paths: TwoHopPathRaw[]
}

export interface TwoHopPathRaw {
  name: string
  role?: string
  company: string
  linkedin?: string | null
  note?: string
}

export interface TwoHopPath {
  broker_name: string
  broker_role: string | null
  broker_linkedin: string | null
  target_name: string
  target_role: string | null
  target_linkedin: string | null
  note: string | null
}

// ---------- Merged entry shapes (what the vault renders) ----------

export interface JobEntry {
  url: string
  title: string
  company: string
  location: string | null
  source: string
  status: JobStatus
  fit: "very high" | "high" | "medium" | "low" | null
  fit_score: number | null
  date_first_seen: string | null
  date_posted: string | null
  snippet: string | null
  why: string | null
  // Referral attachments (populated by merge step)
  referral_tier1_status: string | null
  referral_direct: ReferralPerson[]
  referral_brokers: ReferralPerson[]
  strong_brokers_at_company: StrongConnection[]
  two_hop_paths: TwoHopPath[]
  coach_count: number | null
  outreach: OutreachEvent[]
  follow_up_due: string | null
  fallback_plan: string | null
  materials: Materials | null
  referral_request: ReferralRequest | null
  tags: string[]
}

export interface WarmodeEntry {
  url: string | null
  company: string
  location: string | null
  source: string
  status: WarmodeStatus
  stage: string | null
  ai_native: string | null
  gtm_motion: string | null
  roles_hiring: string[]
  lead_signal: "high" | "medium" | "low" | null
  date_first_seen: string | null
  why: string | null
  // Referral attachments
  referral_tier1_status: string | null
  referral_direct: ReferralPerson[]
  referral_brokers: ReferralPerson[]
  strong_brokers_at_company: StrongConnection[]
  two_hop_paths: TwoHopPath[]
  coach_count: number | null
  outreach: OutreachEvent[]
  follow_up_due: string | null
  fallback_plan: string | null
  materials: Materials | null
  tags: string[]
}
