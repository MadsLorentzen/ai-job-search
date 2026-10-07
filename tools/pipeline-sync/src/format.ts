import type { JobEntry, Materials, OutreachEvent, ReferralPerson, StrongConnection, TwoHopPath, WarmodeEntry } from "./types.ts"

function yamlString(s: string | null | undefined): string {
  if (s === null || s === undefined) return "null"
  if (s === "") return '""'
  // Always quote, escape backslashes and double quotes.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function yamlList(items: string[]): string {
  if (items.length === 0) return "[]"
  return "[" + items.map((s) => yamlString(s)).join(", ") + "]"
}

function personLine(p: ReferralPerson): string {
  const mutual = p.mutual_connections ? ` — ${p.mutual_connections} mutual` : ""
  const followers = p.followers ? ` — ${p.followers} followers` : ""
  const note = p.note ? ` — _${p.note}_` : ""
  return `${p.name} (${p.headline || "?"})${mutual}${followers}${note}`
}

function strongLine(c: StrongConnection): string {
  const mutual = c.mutual_connections ? ` — ${c.mutual_connections} mutual` : ""
  const role = c.role ? ` (${c.role})` : ""
  const note = c.note ? ` — _${c.note}_` : ""
  return `${c.name}${role}${mutual}${note}`
}

// Entries live at vault/<Pipeline>/<stage>/<entry>.md (3 levels under the vault
// root, which sits at the repo root), so repo-relative paths need three "../".
const REPO = "../../.."

function materialsBlock(m: Materials | null): string {
  if (!m) return "_None attached._"
  const lines: string[] = []
  if (m.cv) lines.push(`- **CV (source):** [${m.cv}](${REPO}/${m.cv})`)
  if (m.cv_pdf) lines.push(`- **CV (PDF):** [${m.cv_pdf}](${REPO}/${m.cv_pdf})`)
  if (m.cover_letter) lines.push(`- **Cover letter (source):** [${m.cover_letter}](${REPO}/${m.cover_letter})`)
  if (m.cover_letter_pdf) lines.push(`- **Cover letter (PDF):** [${m.cover_letter_pdf}](${REPO}/${m.cover_letter_pdf})`)
  if (m.notes) lines.push(`- _Notes:_ ${m.notes}`)
  if (lines.length === 0) return "_None attached._"
  return lines.join("\n")
}

function referralRequestBlock(rr: { channel: string; message: string } | null): string {
  if (!rr) return ""
  const quoted = rr.message.split("\n").map((l) => `> ${l}`).join("\n")
  return [
    "",
    "## Referral request (drafted — ready to send)",
    "",
    `**Channel:** ${rr.channel}`,
    "",
    "**Message (warm, in AJ's voice):**",
    "",
    quoted,
    "",
  ].join("\n")
}

function outreachBlock(events: OutreachEvent[]): string {
  if (events.length === 0) return "_None._"
  const out: string[] = []
  for (const e of events) {
    const via = e.via_broker ? ` via **${e.via_broker}**` : ""
    const outcome = e.outcome && e.outcome !== "pending" ? ` — _${e.outcome.replace(/_/g, " ")}_` : ""
    out.push(`- **${e.date}** — ${e.channel.replace(/_/g, " ")} to **${e.to}**${via}${outcome}`)
    if (e.note) out.push(`  ${e.note}`)
  }
  return out.join("\n")
}

function twoHopLine(p: TwoHopPath): string {
  const brokerRole = p.broker_role ? ` (${p.broker_role})` : ""
  const targetRole = p.target_role ? ` — ${p.target_role}` : ""
  const targetLink = p.target_linkedin ? ` [LinkedIn](${p.target_linkedin})` : ""
  const note = p.note ? ` — _${p.note}_` : ""
  return `**${p.broker_name}**${brokerRole} → **${p.target_name}**${targetRole}${targetLink}${note}`
}

function groupTwoHop(paths: TwoHopPath[]): Map<string, TwoHopPath[]> {
  const grouped = new Map<string, TwoHopPath[]>()
  for (const p of paths) {
    if (!grouped.has(p.broker_name)) grouped.set(p.broker_name, [])
    grouped.get(p.broker_name)!.push(p)
  }
  return grouped
}

function bulletList(lines: string[]): string {
  if (lines.length === 0) return "_None._"
  return lines.map((l) => `- ${l}`).join("\n")
}

export function renderJobMarkdown(entry: JobEntry): string {
  const referralTier =
    entry.referral_tier1_status && entry.referral_tier1_status !== "none"
      ? 1
      : entry.referral_direct.length > 0 ||
        entry.referral_brokers.length > 0 ||
        entry.strong_brokers_at_company.length > 0 ||
        entry.two_hop_paths.length > 0
      ? 2
      : entry.coach_count && entry.coach_count > 0
      ? 3
      : null

  const fm = [
    "---",
    `title: ${yamlString(entry.title)}`,
    `company: ${yamlString(entry.company)}`,
    `location: ${yamlString(entry.location)}`,
    `url: ${yamlString(entry.url)}`,
    `source: ${yamlString(entry.source)}`,
    `status: ${entry.status}`,
    `fit: ${entry.fit ? yamlString(entry.fit) : "null"}`,
    `fit_score: ${entry.fit_score ?? "null"}`,
    `date_first_seen: ${yamlString(entry.date_first_seen)}`,
    `date_posted: ${yamlString(entry.date_posted)}`,
    `referral_tier: ${referralTier ?? "null"}`,
    `referral_direct_count: ${entry.referral_direct.length}`,
    `referral_brokers_count: ${entry.referral_brokers.length}`,
    `strong_brokers_count: ${entry.strong_brokers_at_company.length}`,
    `two_hop_path_count: ${entry.two_hop_paths.length}`,
    `coach_count: ${entry.coach_count ?? "null"}`,
    `outreach_count: ${entry.outreach.length}`,
    `follow_up_due: ${yamlString(entry.follow_up_due)}`,
    `materials_attached: ${entry.materials ? Object.keys(entry.materials).filter((k) => (entry.materials as Record<string, unknown>)[k]).length : 0}`,
    `tags: ${yamlList(entry.tags)}`,
    "---",
  ].join("\n")

  const body = [
    "",
    `# ${entry.title}`,
    `**Company:** ${entry.company}  `,
    `**Location:** ${entry.location || "(not specified)"}  `,
    `**Fit:** ${entry.fit || "?"}${entry.fit_score != null ? ` (${entry.fit_score})` : ""}  `,
    `**Date posted:** ${entry.date_posted || "?"}  `,
    `**First seen:** ${entry.date_first_seen || "?"}  `,
    `**Source:** ${entry.source}`,
    "",
    `[Open posting](${entry.url})`,
    "",
    "## Snippet",
    entry.snippet || entry.why || "_(no description captured; check the source URL)_",
    "",
    "## Referral paths",
    "",
    `**Tier 1 (gmail):** ${entry.referral_tier1_status || "_not checked_"}`,
    "",
    "**Tier 2 — direct 1st-degree at company:**",
    bulletList(entry.referral_direct.map(personLine)),
    "",
    "**Tier 2 — connectors / ex-employees / investors:**",
    bulletList(entry.referral_brokers.map(personLine)),
    "",
    "**Strong-connection brokers AT this company (high trust):**",
    bulletList(entry.strong_brokers_at_company.map(strongLine)),
    "",
    "**2-hop paths (AJ → strong broker → their 1st-degree at company):**",
    twoHopBlock(entry.two_hop_paths),
    "",
    `**Tier 3 (Upward PM coach dashboard):** ${entry.coach_count != null ? entry.coach_count + " in-network" : "_not in network or unknown_"}`,
    referralRequestBlock(entry.referral_request),
    "",
    "## Application materials",
    "",
    materialsBlock(entry.materials),
    "",
    "## Outreach log",
    "",
    outreachBlock(entry.outreach),
    entry.follow_up_due ? `\n**Follow-up due:** ${entry.follow_up_due}` : "",
    entry.fallback_plan ? `\n**Fallback plan:** ${entry.fallback_plan}` : "",
    "",
    "## Notes",
    "",
    "_Add personal notes here. Outreach + materials are logged in `job_scraper/pipeline_actions.json`._",
    "",
  ].join("\n")

  return fm + body
}

function twoHopBlock(paths: TwoHopPath[]): string {
  if (paths.length === 0) return "_None._"
  const grouped = groupTwoHop(paths)
  const out: string[] = []
  for (const [broker, list] of grouped.entries()) {
    const first = list[0]
    const brokerRole = first.broker_role ? ` _(${first.broker_role})_` : ""
    out.push(`- **${broker}**${brokerRole}:`)
    for (const p of list) {
      const targetRole = p.target_role ? ` — ${p.target_role}` : ""
      const targetLink = p.target_linkedin ? ` [LinkedIn](${p.target_linkedin})` : ""
      const note = p.note ? ` — _${p.note}_` : ""
      out.push(`  - ${p.target_name}${targetRole}${targetLink}${note}`)
    }
  }
  return out.join("\n")
}

export function renderWarmodeMarkdown(entry: WarmodeEntry): string {
  const fm = [
    "---",
    `company: ${yamlString(entry.company)}`,
    `url: ${yamlString(entry.url)}`,
    `location: ${yamlString(entry.location)}`,
    `source: ${yamlString(entry.source)}`,
    `status: ${entry.status}`,
    `stage: ${yamlString(entry.stage)}`,
    `ai_native: ${yamlString(entry.ai_native)}`,
    `gtm_motion: ${yamlString(entry.gtm_motion)}`,
    `roles_hiring: ${yamlList(entry.roles_hiring)}`,
    `lead_signal: ${entry.lead_signal ? yamlString(entry.lead_signal) : "null"}`,
    `date_first_seen: ${yamlString(entry.date_first_seen)}`,
    `referral_direct_count: ${entry.referral_direct.length}`,
    `referral_brokers_count: ${entry.referral_brokers.length}`,
    `strong_brokers_count: ${entry.strong_brokers_at_company.length}`,
    `two_hop_path_count: ${entry.two_hop_paths.length}`,
    `outreach_count: ${entry.outreach.length}`,
    `follow_up_due: ${yamlString(entry.follow_up_due)}`,
    `tags: ${yamlList(entry.tags)}`,
    "---",
  ].join("\n")

  const body = [
    "",
    `# ${entry.company}`,
    `**Location:** ${entry.location || "(not specified)"}  `,
    `**Stage:** ${entry.stage || "?"}  `,
    `**AI-native:** ${entry.ai_native || "?"}  `,
    `**GTM motion:** ${entry.gtm_motion || "?"}  `,
    `**Lead signal:** ${entry.lead_signal || "?"}  `,
    `**Roles hiring:** ${entry.roles_hiring.length > 0 ? entry.roles_hiring.join(", ") : "(none captured)"}`,
    entry.url ? `\n[Triggering posting](${entry.url})` : "",
    "",
    "## Signal",
    entry.why || "_(no rationale captured)_",
    "",
    "## Referral paths into this company",
    "",
    "**Tier 2 — direct 1st-degree at company:**",
    bulletList(entry.referral_direct.map(personLine)),
    "",
    "**Tier 2 — connectors / ex-employees / investors:**",
    bulletList(entry.referral_brokers.map(personLine)),
    "",
    "**Strong-connection brokers AT this company (high trust):**",
    bulletList(entry.strong_brokers_at_company.map(strongLine)),
    "",
    "**2-hop paths (AJ → strong broker → their 1st-degree at company):**",
    twoHopBlock(entry.two_hop_paths),
    "",
    `**Tier 3 (Upward PM coach dashboard):** ${entry.coach_count != null ? entry.coach_count + " in-network" : "_not in network or unknown_"}`,
    "",
    "## Outreach log",
    "",
    outreachBlock(entry.outreach),
    entry.follow_up_due ? `\n**Follow-up due:** ${entry.follow_up_due}` : "",
    entry.fallback_plan ? `\n**Fallback plan:** ${entry.fallback_plan}` : "",
    "",
    "## Notes",
    "",
    "_Outreach is logged in `job_scraper/pipeline_actions.json`._",
    "",
  ].join("\n")

  return fm + body
}

export function renderJobIndex(entries: JobEntry[]): string {
  return [
    "# Job Pipeline — Index",
    "",
    "JSON sources are the source of truth (`job_scraper/seen_jobs.json`, `browser_finds.json`, `referrals.json`, `strong_connections.json`). Each pass of `pipeline-sync sync` rewrites the markdown under stage folders below.",
    "",
    "## Dataview — High-fit, by referral availability",
    "",
    "```dataview",
    "TABLE company, fit, status, referral_tier, referral_direct_count + referral_brokers_count + strong_brokers_count AS \"# paths\", location",
    "FROM \"Job Pipeline\"",
    "WHERE (fit = \"very high\" OR fit = \"high\") AND status != \"skipped\" AND status != \"outcome\"",
    "SORT fit_score DESC, file.name ASC",
    "```",
    "",
    "## Dataview — All open, by status",
    "",
    "```dataview",
    "TABLE company, title, fit, fit_score, location, referral_tier",
    "FROM \"Job Pipeline\"",
    "WHERE status != \"skipped\" AND status != \"outcome\"",
    "SORT status ASC, fit_score DESC",
    "```",
    "",
    "## Static — counts (rendered at sync time)",
    "",
    countsByStatus(entries),
    "",
  ].join("\n")
}

export function renderWarmodeIndex(entries: WarmodeEntry[]): string {
  return [
    "# Warmode Pipeline — Index",
    "",
    "Companies that have been **signaling** revenue-growth need (by hiring growth roles). NOT a job-application list. Use for Warmode/Omega Point outreach pipeline.",
    "",
    "## Dataview — High-signal leads with referral availability",
    "",
    "```dataview",
    "TABLE company, stage, ai_native, gtm_motion, lead_signal, referral_direct_count + referral_brokers_count + strong_brokers_count AS \"# paths\", status",
    "FROM \"Warmode Pipeline\"",
    "WHERE lead_signal = \"high\"",
    "SORT file.name ASC",
    "```",
    "",
    "## Dataview — All leads, by status",
    "",
    "```dataview",
    "TABLE company, stage, ai_native, gtm_motion, lead_signal, status",
    "FROM \"Warmode Pipeline\"",
    "SORT status ASC, lead_signal DESC",
    "```",
    "",
    "## Static — counts (rendered at sync time)",
    "",
    countsByWarmodeStatus(entries),
    "",
  ].join("\n")
}

function countsByStatus(entries: JobEntry[]): string {
  const buckets: Record<string, number> = {}
  for (const e of entries) buckets[e.status] = (buckets[e.status] || 0) + 1
  const lines: string[] = []
  for (const s of ["new", "triaged", "referral_request_ready", "referral_pending", "ready_to_apply", "applied", "interview", "outcome", "skipped"]) {
    lines.push(`- **${s}**: ${buckets[s] || 0}`)
  }
  lines.push("")
  const totalHigh = entries.filter((e) => e.fit === "high").length
  const totalMed = entries.filter((e) => e.fit === "medium").length
  lines.push(`- High-fit: ${totalHigh}, Medium-fit: ${totalMed}, Total tracked: ${entries.length}`)
  return lines.join("\n")
}

function countsByWarmodeStatus(entries: WarmodeEntry[]): string {
  const buckets: Record<string, number> = {}
  for (const e of entries) buckets[e.status] = (buckets[e.status] || 0) + 1
  const lines: string[] = []
  for (const s of ["new", "researching", "outreach_sent", "conversation", "outcome"]) {
    lines.push(`- **${s}**: ${buckets[s] || 0}`)
  }
  lines.push("")
  const highSignal = entries.filter((e) => e.lead_signal === "high").length
  lines.push(`- High-signal leads: ${highSignal}, Total tracked: ${entries.length}`)
  return lines.join("\n")
}

// Kanban-plugin-compatible board file. The plugin renders this file as columns
// (## headings) with cards (- [ ] items). Each card is a wikilink to the
// existing note. The "01 New" column is capped to keep the board scannable.
export function renderJobKanban(
  entries: JobEntry[],
  filenamesByUrl: Map<string, string>,
  newColumnCap = 30
): string {
  const stages: Array<[string, string]> = [
    ["new", "01 New"],
    ["triaged", "02 Triaged"],
    ["referral_request_ready", "03 Referral Request Ready"],
    ["referral_pending", "04 Referral Pending"],
    ["ready_to_apply", "05 Ready to Apply"],
    ["applied", "06 Applied"],
    ["interview", "07 Interview"],
    ["outcome", "08 Outcome"],
    ["skipped", "09 Skipped"],
  ]
  return renderKanban({
    title: "Job Pipeline",
    stages,
    stageLabel: (status) => stages.find((s) => s[0] === status)?.[1] || status,
    entries: entries.map((e) => ({
      status: e.status,
      sortKey: -(e.fit_score ?? 0),
      url: e.url,
      label: cardLabel(e),
    })),
    filenamesByUrl,
    newColumnCap,
    newColumnKey: "new",
    purpose: "**Two-way sync is on.** Drag a card to another column, then run `bun run tools/pipeline-sync/src/cli.ts pull` (or `sync --2way`) to write the new status back to `job_scraper/seen_jobs.json` and re-align everything. You can also edit the JSON `status` directly and run `sync`. The note files live in the stage folders.",
  })
}

export function renderWarmodeKanban(
  entries: WarmodeEntry[],
  filenamesByUrl: Map<string, string>,
  newColumnCap = 30
): string {
  const stages: Array<[string, string]> = [
    ["new", "01 New"],
    ["researching", "02 Researching"],
    ["outreach_sent", "03 Outreach Sent"],
    ["conversation", "04 Conversation"],
    ["outcome", "05 Outcome"],
  ]
  const signalScore = (s: WarmodeEntry["lead_signal"]): number => {
    if (s === "high") return 2
    if (s === "medium") return 1
    return 0
  }
  return renderKanban({
    title: "Warmode Pipeline",
    stages,
    stageLabel: (status) => stages.find((s) => s[0] === status)?.[1] || status,
    entries: entries.map((e) => ({
      status: e.status,
      sortKey: -signalScore(e.lead_signal),
      url: e.url || e.company,
      label: warmodeCardLabel(e),
    })),
    filenamesByUrl,
    newColumnCap,
    newColumnKey: "new",
    purpose: "Edit `job_scraper/warmode_leads.json` `status` field and re-run sync to advance a lead.",
  })
}

interface KanbanCardSpec {
  status: string
  sortKey: number
  url: string
  label: string
}

interface KanbanRenderSpec {
  title: string
  stages: Array<[string, string]>
  stageLabel: (status: string) => string
  entries: KanbanCardSpec[]
  filenamesByUrl: Map<string, string>
  newColumnCap: number
  newColumnKey: string
  purpose: string
}

function renderKanban(spec: KanbanRenderSpec): string {
  const grouped: Record<string, KanbanCardSpec[]> = {}
  for (const e of spec.entries) {
    if (!grouped[e.status]) grouped[e.status] = []
    grouped[e.status].push(e)
  }
  for (const list of Object.values(grouped)) {
    list.sort((a, b) => a.sortKey - b.sortKey)
  }

  const parts: string[] = []
  parts.push("---")
  parts.push("kanban-plugin: board")
  parts.push("---")
  parts.push("")
  parts.push(`> ${spec.purpose}`)
  parts.push("")

  for (const [status, label] of spec.stages) {
    parts.push(`## ${label}`)
    parts.push("")
    const cards = grouped[status] || []
    // Cap the two archive-scale columns ("new" backlog and "skipped") so the
    // board stays renderable; everything else shows in full. Skipped grew to
    // 1,300+ cards after the 2026-10-07 stale-role cleanup, which made the
    // kanban plugin unusable uncapped.
    const cap = status === spec.newColumnKey || status === "skipped" ? spec.newColumnCap : Number.MAX_SAFE_INTEGER
    const shown = cards.slice(0, cap)
    for (const card of shown) {
      const filename = spec.filenamesByUrl.get(card.url)
      const stem = filename ? filename.replace(/\.md$/, "") : card.label
      // Wikilink with alias gives the card a clean display name.
      parts.push(`- [ ] [[${stem}|${card.label}]]`)
    }
    if (cards.length > cap) {
      parts.push(`- [ ] _+${cards.length - cap} more in this stage. Use the Dataview index or file browser to see all._`)
    }
    parts.push("")
  }

  parts.push("")
  parts.push("%% kanban:settings")
  parts.push("```")
  parts.push(JSON.stringify({ "kanban-plugin": "board", "show-checkboxes": false }))
  parts.push("```")
  parts.push("%%")
  parts.push("")
  return parts.join("\n")
}

function cardLabel(e: JobEntry): string {
  const fit = e.fit_score != null ? `[${e.fit_score}] ` : ""
  const loc = e.location ? ` — ${e.location.split(/[|,•]/)[0].trim()}` : ""
  const totalPaths =
    e.referral_direct.length +
    e.referral_brokers.length +
    e.strong_brokers_at_company.length +
    e.two_hop_paths.length
  const refBits: string[] = []
  if (totalPaths > 0) refBits.push(`${totalPaths}path`)
  if (e.two_hop_paths.length > 0) refBits.push(`2hop${e.two_hop_paths.length}`)
  if (e.coach_count && e.coach_count > 0) refBits.push(`coach${e.coach_count}`)
  if (e.materials) refBits.push("materials")
  const refTag = refBits.length > 0 ? ` · ${refBits.join(" ")}` : ""
  return `${fit}${e.company} — ${e.title}${loc}${refTag}`
}

function warmodeCardLabel(e: WarmodeEntry): string {
  const sig = e.lead_signal ? `[${e.lead_signal}] ` : ""
  const stage = e.stage ? ` · ${e.stage.replace(/\s*\(.+\)\s*/, "")}` : ""
  const ai = e.ai_native?.toLowerCase().startsWith("y") ? " · AI-native" : ""
  return `${sig}${e.company}${stage}${ai}`
}
