import type {
  BrowserFind,
  JobEntry,
  JobStatus,
  Materials,
  OutreachEvent,
  PipelineActions,
  PipelineActionsFile,
  ReferralCompany,
  ReferralRequest,
  ReferralPaths2HopFile,
  ReferralPerson,
  ReferralsFile,
  SeenJob,
  StrongConnection,
  StrongConnectionsFile,
  TwoHopPath,
  WarmodeEntry,
  WarmodeLead,
  WarmodeStatus,
} from "./types.ts"

const ALLOWED_JOB_STATUSES: JobStatus[] = [
  "new", "triaged", "referral_request_ready", "referral_pending", "ready_to_apply", "applied", "interview", "outcome", "skipped",
]
const ALLOWED_WARMODE_STATUSES: WarmodeStatus[] = [
  "new", "researching", "outreach_sent", "conversation", "outcome",
]

function normCompany(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim()
}

function parseDeprioritized(text: string | undefined): Set<string> {
  // Example: "Terri Wang, Jeremy Schwartz, Ibrahim Okuyucu (OpenAI); Art Levy, Sarah Pike (Brex)."
  if (!text) return new Set()
  const names = new Set<string>()
  for (const segment of text.split(/[;.]/)) {
    const cleaned = segment.replace(/\(([^)]+)\)/g, "").replace(/^[^:]*:\s*/, "")
    for (const piece of cleaned.split(",")) {
      const name = piece.trim()
      if (name && /^[A-Z][a-z]/.test(name)) names.add(name)
    }
  }
  return names
}

function filterPeople(
  people: ReferralPerson[] | undefined,
  deprioritized: Set<string>
): ReferralPerson[] {
  return (people || []).filter((p) => !deprioritized.has(p.name))
}

function buildReferralLookup(referrals: ReferralsFile): Map<string, ReferralCompany> {
  const m = new Map<string, ReferralCompany>()
  for (const c of referrals.companies) m.set(normCompany(c.company), c)
  return m
}

// referrals.json has tier-3 coach counts in two places:
//   1) Per-company in `companies[].tier3_coach_dashboard.connections` for deeply-researched targets.
//   2) Aggregated in `summary.tier3_best_counts` as a comma-separated string for everything else.
// Parse the summary string so companies that only appear there still get a count.
function buildTier3SummaryLookup(referrals: ReferralsFile): Map<string, number> {
  const map = new Map<string, number>()
  // Primary source: the `tier3_only_matches` dict (company -> in-network count),
  // which is kept current as new coach-dashboard companies are found.
  const t3 = (referrals as unknown as { tier3_only_matches?: Record<string, unknown> }).tier3_only_matches
  if (t3 && typeof t3 === "object") {
    for (const [name, val] of Object.entries(t3)) {
      if (name.startsWith("_")) continue
      const n = typeof val === "number" ? val : parseInt(String(val), 10)
      if (!Number.isNaN(n)) map.set(normCompany(name), n)
    }
  }
  // Fallback: the older aggregated string `summary.tier3_best_counts`
  // ("Salesforce 23, Capital One 18, ...") for anything not in the dict.
  const raw = (referrals.summary as Record<string, unknown> | undefined)?.tier3_best_counts
  if (typeof raw === "string") {
    for (const segment of raw.split(/,\s*/)) {
      const m = segment.trim().match(/^(.+?)\s+(\d+)\.?$/)
      if (!m) continue
      const name = m[1].trim()
      const n = parseInt(m[2], 10)
      if (!Number.isNaN(n) && name.length > 0 && !map.has(normCompany(name))) {
        map.set(normCompany(name), n)
      }
    }
  }
  return map
}

function buildStrongByCompany(strong: StrongConnectionsFile): Map<string, StrongConnection[]> {
  const m = new Map<string, StrongConnection[]>()
  for (const c of strong.strong_connections) {
    if (!c.company) continue
    const key = normCompany(c.company)
    if (!m.has(key)) m.set(key, [])
    m.get(key)!.push(c)
  }
  return m
}

function buildTwoHopByCompany(file: ReferralPaths2HopFile): Map<string, TwoHopPath[]> {
  // Invert broker-keyed structure into company-keyed list of 2-hop paths.
  const m = new Map<string, TwoHopPath[]>()
  for (const [brokerName, brokerEntry] of Object.entries(file.paths_by_broker || {})) {
    const brokerRole = brokerEntry.broker_role || null
    const brokerLi = brokerEntry.broker_linkedin || null
    for (const path of brokerEntry.paths || []) {
      const key = normCompany(path.company)
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push({
        broker_name: brokerName,
        broker_role: brokerRole,
        broker_linkedin: brokerLi,
        target_name: path.name,
        target_role: path.role || null,
        target_linkedin: path.linkedin || null,
        note: path.note || null,
      })
    }
  }
  return m
}

function coerceJobStatus(raw: string | undefined): JobStatus {
  const s = (raw || "new").toLowerCase().replace(/[\s-]+/g, "_")
  return (ALLOWED_JOB_STATUSES as string[]).includes(s) ? (s as JobStatus) : "new"
}

function coerceWarmodeStatus(raw: string | undefined): WarmodeStatus {
  const s = (raw || "new").toLowerCase().replace(/[\s-]+/g, "_")
  return (ALLOWED_WARMODE_STATUSES as string[]).includes(s) ? (s as WarmodeStatus) : "new"
}

function snippet(s: string | null | undefined, max = 500): string | null {
  if (!s) return null
  const cleaned = s.replace(/\s+/g, " ").trim()
  if (cleaned.length <= max) return cleaned
  return cleaned.slice(0, max - 1) + "…"
}

function referralTags(entry: {
  referral_tier1_status: string | null
  referral_direct: ReferralPerson[]
  referral_brokers: ReferralPerson[]
  strong_brokers_at_company: StrongConnection[]
  two_hop_paths: TwoHopPath[]
  coach_count: number | null
}): string[] {
  const tags: string[] = []
  const hasTier1 = !!(entry.referral_tier1_status && entry.referral_tier1_status !== "none")
  const hasPersonal =
    hasTier1 ||
    entry.referral_direct.length > 0 ||
    entry.referral_brokers.length > 0 ||
    entry.strong_brokers_at_company.length > 0 ||
    entry.two_hop_paths.length > 0
  const hasCoach = !!(entry.coach_count && entry.coach_count > 0)
  if (hasTier1) tags.push("referral/tier1")
  if (entry.referral_direct.length > 0) tags.push("referral/direct")
  if (entry.referral_brokers.length > 0) tags.push("referral/connector")
  if (entry.strong_brokers_at_company.length > 0) tags.push("referral/strong-at-co")
  if (entry.two_hop_paths.length > 0) tags.push("referral/2hop")
  if (hasCoach) tags.push("referral/coach")
  // Highlight roles whose ONLY warm path is the Upward coach dashboard (no
  // personal/network path) — these need the "log into Upward" motion, not a ping.
  if (hasCoach && !hasPersonal) tags.push("referral/coach-only")
  if (tags.length === 0) tags.push("referral/none")
  return tags
}

function tagsForJob(entry: Omit<JobEntry, "tags">): string[] {
  const tags = new Set<string>()
  const t = (entry.title || "").toLowerCase()
  if (/growth/.test(t)) tags.add("growth")
  if (/lifecycle/.test(t)) tags.add("lifecycle")
  if (/email/.test(t)) tags.add("email")
  if (/monetization|pricing/.test(t)) tags.add("monetization")
  if (/founder.*residence|entrepreneur.*residence|eir/i.test(t)) tags.add("eir")
  if (/founding/.test(t)) tags.add("founding")
  if (/\bvp\b|head of|director/.test(t)) tags.add("senior")
  if (/product manager|\bpm\b/.test(t)) tags.add("pm")
  if (/ai|llm|gen[- ]ai|agentic/.test((entry.company + " " + entry.title).toLowerCase())) tags.add("ai")
  const slug = (entry.company || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  if (slug) tags.add(`target/${slug}`)
  for (const t of referralTags(entry)) tags.add(t)
  return Array.from(tags).sort()
}

function tagsForWarmode(entry: Omit<WarmodeEntry, "tags">): string[] {
  const tags = new Set<string>(["warmode"])
  if (entry.ai_native?.toLowerCase().startsWith("y")) tags.add("ai-native")
  if (entry.gtm_motion?.toLowerCase().includes("plg")) tags.add("plg")
  if (entry.gtm_motion?.toLowerCase().includes("sales")) tags.add("sales-led")
  const stageMatch = entry.stage?.toLowerCase().match(/seed|series\s+[abcd]/i)
  if (stageMatch) tags.add(stageMatch[0].replace(/\s+/g, "-"))
  const slug = (entry.company || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  if (slug) tags.add(`lead/${slug}`)
  for (const t of referralTags(entry)) tags.add(t)
  return Array.from(tags).sort()
}

function attachReferrals<T extends { company: string }>(
  base: T,
  refLookup: Map<string, ReferralCompany>,
  strongByCompany: Map<string, StrongConnection[]>,
  twoHopByCompany: Map<string, TwoHopPath[]>,
  tier3Summary: Map<string, number>,
  deprioritized: Set<string>
): {
  referral_tier1_status: string | null
  referral_direct: ReferralPerson[]
  referral_brokers: ReferralPerson[]
  strong_brokers_at_company: StrongConnection[]
  two_hop_paths: TwoHopPath[]
  coach_count: number | null
} {
  const key = normCompany(base.company)
  const ref = refLookup.get(key)
  const strongAtCo = strongByCompany.get(key) || []
  const twoHop = twoHopByCompany.get(key) || []
  const detailedCoachCount = ref?.tier3_coach_dashboard?.connections
  const fallbackCoachCount = tier3Summary.get(key)
  return {
    referral_tier1_status: ref?.tier1_email?.status || null,
    referral_direct: filterPeople(ref?.tier2_linkedin?.current_employees, deprioritized),
    referral_brokers: filterPeople(ref?.tier2_linkedin?.connectors, deprioritized),
    strong_brokers_at_company: strongAtCo,
    two_hop_paths: twoHop,
    coach_count: detailedCoachCount ?? fallbackCoachCount ?? null,
  }
}

function lookupActions(actions: PipelineActionsFile | undefined, url: string): {
  outreach: OutreachEvent[]
  follow_up_due: string | null
  fallback_plan: string | null
  materials: Materials | null
  referral_request: ReferralRequest | null
} {
  const a: PipelineActions | undefined = actions?.actions?.[url]
  return {
    outreach: a?.outreach || [],
    follow_up_due: a?.follow_up_due || null,
    fallback_plan: a?.fallback_plan || null,
    materials: a?.materials || null,
    referral_request: a?.referral_request || null,
  }
}

export function mergeJobPipeline(
  seenJobs: Record<string, SeenJob>,
  browserFinds: BrowserFind[],
  referrals: ReferralsFile,
  twoHop: ReferralPaths2HopFile,
  strong: StrongConnectionsFile,
  actions?: PipelineActionsFile
): JobEntry[] {
  const refLookup = buildReferralLookup(referrals)
  const strongByCompany = buildStrongByCompany(strong)
  const twoHopByCompany = buildTwoHopByCompany(twoHop)
  const tier3Summary = buildTier3SummaryLookup(referrals)
  const deprioritized = parseDeprioritized(strong._explicitly_deprioritized)

  const merged = new Map<string, JobEntry>()

  // Seed with seen_jobs entries.
  for (const seen of Object.values(seenJobs)) {
    if (!seen.url || !seen.title) continue
    const company = seen.company || "(unknown)"
    const partial: Omit<JobEntry, "tags"> = {
      url: seen.url,
      title: seen.title,
      company,
      location: seen.location ?? null,
      source: seen.source || "unknown",
      status: coerceJobStatus(seen.status),
      fit: (seen.fit as "very high" | "high" | "medium" | "low" | null) ?? null,
      fit_score: seen.fit_score ?? null,
      date_first_seen: seen.first_seen ?? null,
      date_posted: seen.date_posted ?? null,
      snippet: snippet(seen.description ?? seen.why ?? null),
      why: seen.why ?? null,
      ...attachReferrals({ company }, refLookup, strongByCompany, twoHopByCompany, tier3Summary, deprioritized),
      ...lookupActions(actions, seen.url),
    }
    merged.set(seen.url, { ...partial, tags: tagsForJob(partial) })
  }

  // Merge in browser_finds, preferring richer fields (snippet, why) when present.
  for (const find of browserFinds) {
    if (!find.url || !find.title) continue
    const existing = merged.get(find.url)
    const company = find.company || existing?.company || "(unknown)"
    if (existing) {
      const updated: JobEntry = {
        ...existing,
        company: existing.company === "(unknown)" ? company : existing.company,
        location: existing.location ?? find.location ?? null,
        snippet: existing.snippet ?? snippet(find.raw_description_snippet ?? find.why ?? null),
        why: existing.why ?? find.why ?? null,
        fit: existing.fit ?? find.fit_signal ?? null,
        date_posted: existing.date_posted ?? find.posted_date ?? null,
      }
      updated.tags = tagsForJob(updated)
      merged.set(find.url, updated)
    } else {
      const partial: Omit<JobEntry, "tags"> = {
        url: find.url,
        title: find.title,
        company,
        location: find.location ?? null,
        source: find.source || "linkedin",
        status: coerceJobStatus(find.status),
        fit: find.fit_signal ?? null,
        fit_score: find.fit_score ?? null,
        date_first_seen: find.first_seen ?? null,
        date_posted: find.posted_date ?? null,
        snippet: snippet(find.raw_description_snippet ?? find.why ?? null),
        why: find.why ?? null,
        ...attachReferrals({ company }, refLookup, strongByCompany, twoHopByCompany, tier3Summary, deprioritized),
        ...lookupActions(actions, find.url),
      }
      merged.set(find.url, { ...partial, tags: tagsForJob(partial) })
    }
  }

  return Array.from(merged.values())
}

export function mergeWarmodePipeline(
  leads: WarmodeLead[],
  referrals: ReferralsFile,
  twoHop: ReferralPaths2HopFile,
  strong: StrongConnectionsFile,
  actions?: PipelineActionsFile
): WarmodeEntry[] {
  const refLookup = buildReferralLookup(referrals)
  const strongByCompany = buildStrongByCompany(strong)
  const twoHopByCompany = buildTwoHopByCompany(twoHop)
  const tier3Summary = buildTier3SummaryLookup(referrals)
  const deprioritized = parseDeprioritized(strong._explicitly_deprioritized)

  const out: WarmodeEntry[] = []
  for (const lead of leads) {
    if (!lead.company) continue
    const partial: Omit<WarmodeEntry, "tags"> = {
      url: lead.url ?? null,
      company: lead.company,
      location: lead.location ?? null,
      source: lead.source || "unknown",
      status: coerceWarmodeStatus(lead.status),
      stage: lead.stage ?? null,
      ai_native: lead.ai_native ?? null,
      gtm_motion: lead.gtm_motion ?? null,
      roles_hiring: lead.roles_hiring ?? [],
      lead_signal: lead.lead_signal ?? null,
      date_first_seen: lead.first_seen ?? null,
      why: lead.why ?? null,
      ...attachReferrals({ company: lead.company }, refLookup, strongByCompany, twoHopByCompany, tier3Summary, deprioritized),
      ...lookupActions(actions, lead.url || ""),
    }
    out.push({ ...partial, tags: tagsForWarmode(partial) })
  }
  return out
}
