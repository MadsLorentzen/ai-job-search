import { mkdirSync, readdirSync, statSync, writeFileSync, existsSync, unlinkSync, rmdirSync, copyFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { createHash } from "node:crypto"
import {
  JOB_STAGE_FOLDERS,
  WARMODE_STAGE_FOLDERS,
  type JobEntry,
  type JobStatus,
  type WarmodeEntry,
  type WarmodeStatus,
} from "./types.ts"
import {
  renderJobIndex,
  renderJobKanban,
  renderJobMarkdown,
  renderWarmodeIndex,
  renderWarmodeKanban,
  renderWarmodeMarkdown,
} from "./format.ts"

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

// Mirror the git-tracked Search Journal (documents/search-journal/*.md) into the
// Obsidian vault so dated retrospectives/decisions are readable in Obsidian.
// Source of truth stays in documents/ (the vault is gitignored). Append-style:
// entries are copied, an index is regenerated. Files starting with "_" (template)
// are copied but not listed.
export function syncSearchJournal(vault: string, journalSrc: string): { written: number } {
  const dest = join(vault, "Search Journal")
  ensureDir(dest)
  if (!existsSync(journalSrc)) return { written: 0 }
  const files = readdirSync(journalSrc).filter((f) => f.endsWith(".md")).sort().reverse()
  let written = 0
  const index: string[] = [
    "# Search Journal",
    "",
    "Dated retrospectives, decisions, and weekly reviews from the job search. Newest first.",
    "Source of truth: `documents/search-journal/` (git-tracked); this folder is a read-only mirror.",
    "To add an entry: copy `_TEMPLATE.md` to `documents/search-journal/YYYY-MM-DD-<slug>.md`, fill it in, then run `sync`.",
    "",
  ]
  for (const name of files) {
    copyFileSync(join(journalSrc, name), join(dest, name))
    written++
    if (name.startsWith("_")) continue
    index.push(`- [[Search Journal/${name.replace(/\.md$/, "")}|${name.replace(/\.md$/, "")}]]`)
  }
  writeFileSync(join(dest, "_index.md"), index.join("\n") + "\n")
  return { written }
}

function safeSegment(s: string, maxLen = 60): string {
  return s
    .replace(/[\/\\<>:"|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen)
    .trim() // re-trim: slicing at maxLen can leave a trailing space, which breaks file lookup
}

function urlHash(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 6)
}

function jobFilename(entry: JobEntry, existing: Set<string>): string {
  const base = `${safeSegment(entry.company)} - ${safeSegment(entry.title)}`
  let candidate = `${base}.md`
  if (existing.has(candidate)) {
    candidate = `${base} (${urlHash(entry.url)}).md`
  }
  return candidate
}

function warmodeFilename(entry: WarmodeEntry, existing: Set<string>): string {
  const stem = safeSegment(entry.company)
  let candidate = `${stem}.md`
  if (existing.has(candidate)) {
    const hashSource = entry.url || entry.company + (entry.roles_hiring?.[0] || "")
    candidate = `${stem} (${urlHash(hashSource)}).md`
  }
  return candidate
}

function walkMarkdown(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        walk(full)
      } else if (name.endsWith(".md")) {
        out.push(full)
      }
    }
  }
  walk(root)
  return out
}

function pruneEmptyStageDirs(root: string, stageNames: string[]): void {
  for (const stage of stageNames) {
    const dir = join(root, stage)
    if (existsSync(dir)) {
      const remaining = readdirSync(dir).filter((n) => !n.startsWith("."))
      if (remaining.length === 0) {
        try { rmdirSync(dir) } catch {}
      }
    }
  }
}

export interface SyncStats {
  written: number
  deleted: number
  byStatus: Record<string, number>
}

export function syncJobPipeline(vaultRoot: string, entries: JobEntry[]): SyncStats {
  const root = resolve(vaultRoot, "Job Pipeline")
  ensureDir(root)

  // Ensure all stage folders exist (Obsidian Kanban / folder browser is nicer with stable folder list).
  for (const stage of Object.values(JOB_STAGE_FOLDERS)) {
    ensureDir(join(root, stage))
  }

  // Group entries by stage and pick filenames, handling collisions.
  const byStage: Record<string, JobEntry[]> = {}
  for (const e of entries) {
    const folder = JOB_STAGE_FOLDERS[e.status as JobStatus]
    if (!byStage[folder]) byStage[folder] = []
    byStage[folder].push(e)
  }

  const wanted = new Set<string>()
  const filenamesByUrl = new Map<string, string>()
  let written = 0
  for (const [folder, list] of Object.entries(byStage)) {
    const existing = new Set<string>()
    for (const e of list) {
      const name = jobFilename(e, existing)
      existing.add(name)
      const full = join(root, folder, name)
      writeFileSync(full, renderJobMarkdown(e), "utf8")
      wanted.add(full)
      written++
      // Map URL to the wikilink-target path (folder/stem, vault-relative).
      filenamesByUrl.set(e.url, `Job Pipeline/${folder}/${name.replace(/\.md$/, "")}`)
    }
  }

  // Write index.
  const indexPath = join(root, "_index.md")
  writeFileSync(indexPath, renderJobIndex(entries), "utf8")
  wanted.add(indexPath)

  // Write Kanban board file.
  const kanbanPath = join(root, "Kanban.md")
  writeFileSync(kanbanPath, renderJobKanban(entries, filenamesByUrl), "utf8")
  wanted.add(kanbanPath)

  // Delete orphan markdown files in this pipeline.
  let deleted = 0
  for (const existing of walkMarkdown(root)) {
    if (!wanted.has(existing)) {
      unlinkSync(existing)
      deleted++
    }
  }

  pruneEmptyStageDirs(root, Object.values(JOB_STAGE_FOLDERS))

  const byStatus: Record<string, number> = {}
  for (const e of entries) byStatus[e.status] = (byStatus[e.status] || 0) + 1

  return { written, deleted, byStatus }
}

export function syncWarmodePipeline(vaultRoot: string, entries: WarmodeEntry[]): SyncStats {
  const root = resolve(vaultRoot, "Warmode Pipeline")
  ensureDir(root)

  for (const stage of Object.values(WARMODE_STAGE_FOLDERS)) {
    ensureDir(join(root, stage))
  }

  const byStage: Record<string, WarmodeEntry[]> = {}
  for (const e of entries) {
    const folder = WARMODE_STAGE_FOLDERS[e.status as WarmodeStatus]
    if (!byStage[folder]) byStage[folder] = []
    byStage[folder].push(e)
  }

  const wanted = new Set<string>()
  const filenamesByUrl = new Map<string, string>()
  let written = 0
  for (const [folder, list] of Object.entries(byStage)) {
    const existing = new Set<string>()
    for (const e of list) {
      const name = warmodeFilename(e, existing)
      existing.add(name)
      const full = join(root, folder, name)
      writeFileSync(full, renderWarmodeMarkdown(e), "utf8")
      wanted.add(full)
      written++
      filenamesByUrl.set(e.url || e.company, `Warmode Pipeline/${folder}/${name.replace(/\.md$/, "")}`)
    }
  }

  const indexPath = join(root, "_index.md")
  writeFileSync(indexPath, renderWarmodeIndex(entries), "utf8")
  wanted.add(indexPath)

  const kanbanPath = join(root, "Kanban.md")
  writeFileSync(kanbanPath, renderWarmodeKanban(entries, filenamesByUrl), "utf8")
  wanted.add(kanbanPath)

  let deleted = 0
  for (const existing of walkMarkdown(root)) {
    if (!wanted.has(existing)) {
      unlinkSync(existing)
      deleted++
    }
  }

  pruneEmptyStageDirs(root, Object.values(WARMODE_STAGE_FOLDERS))

  const byStatus: Record<string, number> = {}
  for (const e of entries) byStatus[e.status] = (byStatus[e.status] || 0) + 1

  return { written, deleted, byStatus }
}

export function writeVaultReadme(vaultRoot: string): void {
  ensureDir(vaultRoot)
  const md = [
    "# Pipeline Vault",
    "",
    "Read-only projection of the JSON source files under `job_scraper/`. Edit the JSONs (status field) and re-run `pipeline-sync sync` to update this vault.",
    "",
    "## Pipelines",
    "",
    "- **Job Pipeline** — full-time job-search pipeline. Sources: `seen_jobs.json`, `browser_finds.json`.",
    "- **Warmode Pipeline** — companies signaling growth-need to pitch for Warmode/Omega Point fractional work. Source: `warmode_leads.json`.",
    "",
    "Referral data is overlaid from `referrals.json` and `strong_connections.json` onto each entry's referral section.",
    "",
    "## How to use",
    "",
    "1. Open this directory as the Obsidian vault root.",
    "2. Install community plugins: **Dataview** (renders the `_index.md` tables) and **Kanban** by mgmeyers (renders `Kanban.md` as a board view).",
    "3. Open `Job Pipeline/Kanban.md` (or `Warmode Pipeline/Kanban.md`) to see the board. The Kanban plugin auto-detects the `kanban-plugin: board` frontmatter.",
    "3. To advance a job through the pipeline: edit `status` in `job_scraper/seen_jobs.json` (or `browser_finds.json` for browser-found roles), then re-run `bun run tools/pipeline-sync/src/cli.ts sync`.",
    "",
    "## Status enums",
    "",
    "- **Job Pipeline status:** new, triaged, referral_pending, ready_to_apply, applied, interview, outcome, skipped",
    "- **Warmode Pipeline status:** new, researching, outreach_sent, conversation, outcome",
    "",
  ].join("\n")
  writeFileSync(join(vaultRoot, "_README.md"), md, "utf8")
}
