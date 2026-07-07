#!/usr/bin/env bun
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { loadAll, type SourcePaths } from "./loaders.ts"
import { mergeJobPipeline, mergeWarmodePipeline } from "./merge.ts"
import { syncJobPipeline, syncWarmodePipeline, writeVaultReadme, syncSearchJournal } from "./vault.ts"
import { readKanbanStatuses } from "./reverse.ts"

// Reverse sync (pull): read board columns -> write changed statuses back to the
// source JSON (seen_jobs.json, else browser_finds.json). Returns the diffs.
function pullFromKanban(
  vault: string,
  sources: SourcePaths,
  apply = true,
): { changes: Array<{ url: string; from: string | null; to: string }>; warnings: string[] } {
  const { intents, warnings } = readKanbanStatuses(vault)
  const seenFile = JSON.parse(readFileSync(sources.seenJobs, "utf8"))
  const bfFile = existsSync(sources.browserFinds)
    ? JSON.parse(readFileSync(sources.browserFinds, "utf8"))
    : { finds: [] }
  const changes: Array<{ url: string; from: string | null; to: string }> = []
  let seenDirty = false
  let bfDirty = false
  for (const it of intents) {
    if (seenFile.seen && seenFile.seen[it.url]) {
      if (seenFile.seen[it.url].status !== it.status) {
        changes.push({ url: it.url, from: seenFile.seen[it.url].status ?? null, to: it.status })
        seenFile.seen[it.url].status = it.status
        seenDirty = true
      }
    } else {
      const find = (bfFile.finds || []).find((f: { url: string }) => f.url === it.url)
      if (find) {
        if (find.status !== it.status) {
          changes.push({ url: it.url, from: find.status ?? null, to: it.status })
          find.status = it.status
          bfDirty = true
        }
      } else {
        warnings.push(`Board card url not found in seen_jobs/browser_finds (skipped): ${it.url}`)
      }
    }
  }
  if (apply) {
    if (seenDirty) writeFileSync(sources.seenJobs, JSON.stringify(seenFile, null, 2))
    if (bfDirty) writeFileSync(sources.browserFinds, JSON.stringify(bfFile, null, 2))
  }
  return { changes, warnings }
}

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..", "..", "..")

const DEFAULTS: SourcePaths = {
  seenJobs: resolve(REPO_ROOT, "job_scraper", "seen_jobs.json"),
  browserFinds: resolve(REPO_ROOT, "job_scraper", "browser_finds.json"),
  warmodeLeads: resolve(REPO_ROOT, "job_scraper", "warmode_leads.json"),
  referrals: resolve(REPO_ROOT, "job_scraper", "referrals.json"),
  referralPaths2hop: resolve(REPO_ROOT, "job_scraper", "referral_paths_2hop.json"),
  strongConnections: resolve(REPO_ROOT, "job_scraper", "strong_connections.json"),
  pipelineActions: resolve(REPO_ROOT, "job_scraper", "pipeline_actions.json"),
}

const DEFAULT_VAULT = resolve(REPO_ROOT, "vault")
const SEARCH_JOURNAL_SRC = resolve(REPO_ROOT, "documents", "search-journal")

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--")) {
      const eq = a.indexOf("=")
      if (eq >= 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        const next = argv[i + 1]
        if (next && !next.startsWith("--")) { flags[a.slice(2)] = next; i++ } else { flags[a.slice(2)] = true }
      }
    } else {
      positional.push(a)
    }
  }
  return { positional, flags }
}

function usage(): string {
  return `pipeline-sync — project job_scraper JSONs to an Obsidian vault.

USAGE
  pipeline-sync sync [--2way] [--vault <dir>]
      Full sync: write markdown, delete orphans.
      With --2way, first pull status changes made on the Kanban board back into
      the JSON (board drag = status change), then forward-sync.

  pipeline-sync pull [--dry-run] [--vault <dir>]
      Two-way sync. Read the Kanban board, write each card's column (= status)
      back to seen_jobs.json / browser_finds.json, then forward-sync to
      re-align stage folders, note frontmatter, and the board. Reports the
      status changes it applied. (Same as: sync --2way)
      --dry-run reads the board and reports what it WOULD change, writing
      nothing — use it to confirm Obsidian saved your drag to disk first.
      A pull with no changes leaves the vault untouched.

  pipeline-sync status [--vault <dir>]
      Print counts per status, no writes.

  pipeline-sync log-outreach --url <url> --to <name> [flags]
      Append an outreach event to pipeline_actions.json and re-sync.
      Flags:
        --channel <linkedin_dm|email|inmail|phone|other>   default: linkedin_dm
        --note <text>                                       what was said / sent
        --via-broker <name>                                 for 2-hop intros
        --follow-up <YYYY-MM-DD>                            schedule a follow-up
        --fallback <text>                                   set/replace fallback plan
        --date <YYYY-MM-DD>                                 default: today

  pipeline-sync set-status --url <url> --to <stage>
      Update a job's status field and re-sync. Stage is one of:
      new|triaged|referral_request_ready|referral_pending|ready_to_apply|applied|interview|outcome|skipped
`
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2)
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(usage())
    return 0
  }
  const { flags } = parseArgs(rest)
  const vault = typeof flags.vault === "string" ? resolve(flags.vault) : DEFAULT_VAULT
  const sources: SourcePaths = { ...DEFAULTS }

  if (cmd === "sync" || cmd === "pull") {
    // `pull` and `sync --2way` first read board (Kanban) status changes back into
    // the JSON, then forward-sync to re-align folders/frontmatter/board.
    const twoWay = cmd === "pull" || flags["2way"] === true || flags["2way"] === "true"
    const dryRun = flags["dry-run"] === true || flags["dry-run"] === "true"
    if (dryRun) {
      // Read-only: report what pull WOULD change, write nothing. Use this to
      // confirm Obsidian saved your drag to disk before committing.
      const preview = pullFromKanban(vault, sources, false)
      process.stdout.write(JSON.stringify({ vault, dry_run: true, would_change: preview.changes, warnings: preview.warnings }, null, 2) + "\n")
      return 0
    }
    let pulled: ReturnType<typeof pullFromKanban> | null = null
    if (twoWay) pulled = pullFromKanban(vault, sources)

    // A pure `pull` with nothing to apply leaves the vault untouched — so a
    // premature pull never regenerates (and clobbers) a board the user is still
    // editing in Obsidian. `sync`/`sync --2way` always forward-syncs.
    if (cmd === "pull" && pulled && pulled.changes.length === 0) {
      process.stdout.write(JSON.stringify({
        vault,
        pulled_from_board: [],
        pull_warnings: pulled.warnings,
        note: "No board changes found on disk. Vault left untouched. If you just dragged a card in Obsidian, make sure it saved to Kanban.md first (switch off the board / Cmd+S), then run pull again.",
      }, null, 2) + "\n")
      return 0
    }

    const { seenJobs, browserFinds, warmodeLeads, referrals, referralPaths2hop, strongConnections, pipelineActions } = loadAll(sources)
    const jobs = mergeJobPipeline(seenJobs.seen, browserFinds.finds, referrals, referralPaths2hop, strongConnections, pipelineActions)
    const warmode = mergeWarmodePipeline(warmodeLeads.leads, referrals, referralPaths2hop, strongConnections, pipelineActions)

    writeVaultReadme(vault)
    const jobStats = syncJobPipeline(vault, jobs)
    const warmodeStats = syncWarmodePipeline(vault, warmode)
    const journalStats = syncSearchJournal(vault, SEARCH_JOURNAL_SRC)

    process.stdout.write(JSON.stringify({
      vault,
      ...(pulled ? { pulled_from_board: pulled.changes, pull_warnings: pulled.warnings } : {}),
      job_pipeline: { entries: jobs.length, ...jobStats },
      warmode_pipeline: { entries: warmode.length, ...warmodeStats },
      search_journal: { entries_mirrored: journalStats.written },
    }, null, 2) + "\n")
    return 0
  }

  if (cmd === "log-outreach") {
    const url = typeof flags.url === "string" ? flags.url : ""
    const to = typeof flags.to === "string" ? flags.to : ""
    if (!url || !to) throw new Error("log-outreach requires --url and --to")
    const channel = typeof flags.channel === "string" ? flags.channel : "linkedin_dm"
    const note = typeof flags.note === "string" ? flags.note : undefined
    const viaBroker = typeof flags["via-broker"] === "string" ? flags["via-broker"] : undefined
    const followUp = typeof flags["follow-up"] === "string" ? flags["follow-up"] : undefined
    const fallback = typeof flags.fallback === "string" ? flags.fallback : undefined
    const date = typeof flags.date === "string" ? flags.date : new Date().toISOString().slice(0, 10)

    const fs = await import("node:fs")
    const path = sources.pipelineActions
    const file = fs.existsSync(path)
      ? JSON.parse(fs.readFileSync(path, "utf8"))
      : { actions: {} }
    if (!file.actions) file.actions = {}
    if (!file.actions[url]) file.actions[url] = { outreach: [] }
    if (!file.actions[url].outreach) file.actions[url].outreach = []
    file.actions[url].outreach.push({
      date,
      channel,
      to,
      ...(viaBroker ? { via_broker: viaBroker } : {}),
      ...(note ? { note } : {}),
      outcome: "pending",
    })
    if (followUp) file.actions[url].follow_up_due = followUp
    if (fallback) file.actions[url].fallback_plan = fallback
    fs.writeFileSync(path, JSON.stringify(file, null, 2))

    const { seenJobs, browserFinds, warmodeLeads, referrals, referralPaths2hop, strongConnections, pipelineActions } = loadAll(sources)
    const jobs = mergeJobPipeline(seenJobs.seen, browserFinds.finds, referrals, referralPaths2hop, strongConnections, pipelineActions)
    const warmode = mergeWarmodePipeline(warmodeLeads.leads, referrals, referralPaths2hop, strongConnections, pipelineActions)
    writeVaultReadme(vault)
    syncJobPipeline(vault, jobs)
    syncWarmodePipeline(vault, warmode)
    process.stdout.write(JSON.stringify({ logged: { url, date, channel, to, via_broker: viaBroker, follow_up_due: followUp }, vault }, null, 2) + "\n")
    return 0
  }

  if (cmd === "set-status") {
    const url = typeof flags.url === "string" ? flags.url : ""
    const to = typeof flags.to === "string" ? flags.to : ""
    if (!url || !to) throw new Error("set-status requires --url and --to")
    const allowed = ["new", "triaged", "referral_request_ready", "referral_pending", "ready_to_apply", "applied", "interview", "outcome", "skipped"]
    if (!allowed.includes(to)) throw new Error(`--to must be one of ${allowed.join("|")}`)
    const fs = await import("node:fs")
    const seenPath = sources.seenJobs
    const seenFile = JSON.parse(fs.readFileSync(seenPath, "utf8"))
    if (!seenFile.seen[url]) {
      // Also check browser_finds.
      const bfPath = sources.browserFinds
      const bfFile = JSON.parse(fs.readFileSync(bfPath, "utf8"))
      const find = (bfFile.finds || []).find((f: { url: string }) => f.url === url)
      if (!find) throw new Error(`URL not found in seen_jobs or browser_finds: ${url}`)
      find.status = to
      fs.writeFileSync(bfPath, JSON.stringify(bfFile, null, 2))
    } else {
      seenFile.seen[url].status = to
      fs.writeFileSync(seenPath, JSON.stringify(seenFile, null, 2))
    }
    const { seenJobs, browserFinds, warmodeLeads, referrals, referralPaths2hop, strongConnections, pipelineActions } = loadAll(sources)
    const jobs = mergeJobPipeline(seenJobs.seen, browserFinds.finds, referrals, referralPaths2hop, strongConnections, pipelineActions)
    const warmode = mergeWarmodePipeline(warmodeLeads.leads, referrals, referralPaths2hop, strongConnections, pipelineActions)
    writeVaultReadme(vault)
    syncJobPipeline(vault, jobs)
    syncWarmodePipeline(vault, warmode)
    process.stdout.write(JSON.stringify({ updated: { url, to }, vault }, null, 2) + "\n")
    return 0
  }

  if (cmd === "status") {
    const { seenJobs, browserFinds, warmodeLeads, referrals, referralPaths2hop, strongConnections, pipelineActions } = loadAll(sources)
    const jobs = mergeJobPipeline(seenJobs.seen, browserFinds.finds, referrals, referralPaths2hop, strongConnections, pipelineActions)
    const warmode = mergeWarmodePipeline(warmodeLeads.leads, referrals, referralPaths2hop, strongConnections, pipelineActions)
    const counts = (list: { status: string }[]) => {
      const b: Record<string, number> = {}
      for (const e of list) b[e.status] = (b[e.status] || 0) + 1
      return b
    }
    process.stdout.write(JSON.stringify({
      job_pipeline: { entries: jobs.length, by_status: counts(jobs) },
      warmode_pipeline: { entries: warmode.length, by_status: counts(warmode) },
    }, null, 2) + "\n")
    return 0
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command: ${cmd}`, code: "UNKNOWN_COMMAND" }) + "\n")
  process.stderr.write("\n" + usage())
  return 1
}

try {
  const code = await main()
  process.exit(code)
} catch (e) {
  process.stderr.write(JSON.stringify({ error: (e as Error).message, code: "RUNTIME_ERROR", stack: (e as Error).stack }) + "\n")
  process.exit(1)
}
