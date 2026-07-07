// Reverse sync: read the Obsidian Kanban board and recover the user-intended
// status of each card (the column it now sits under). The board is the
// SECONDARY editor; the JSON files remain source of truth. `pull` writes board
// changes back to the JSON, then a normal forward sync re-aligns everything.
//
// Why parse the board (not the note's folder): the Obsidian Kanban plugin moves
// a card's LINE between `## Column` headings in Kanban.md on drag, but does NOT
// move the underlying note file. So the column heading is the intent signal; the
// note file (still in its old folder) is just where we read the card's url from.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { JOB_STAGE_FOLDERS, type JobStatus } from "./types.ts"

// "NN Label" -> status, inverted from the canonical folder map.
const LABEL_TO_STATUS: Map<string, JobStatus> = new Map(
  (Object.entries(JOB_STAGE_FOLDERS) as [JobStatus, string][]).map(([status, label]) => [label, status]),
)

// Pull the `url` out of a note's YAML frontmatter (written by the forward sync as
// `url: "<value>"`).
function frontmatterUrl(noteAbsPath: string): string | null {
  if (!existsSync(noteAbsPath)) return null
  const m = readFileSync(noteAbsPath, "utf8").match(/^url:\s*(.+?)\s*$/m)
  if (!m) return null
  let v = m[1].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  v = v.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  return v || null
}

export interface KanbanIntent {
  url: string
  status: JobStatus
  card: string // wikilink target, for diagnostics
}

export interface KanbanReadResult {
  intents: KanbanIntent[]
  warnings: string[]
}

// Read the Job Pipeline Kanban board and return each card's intended status.
export function readKanbanStatuses(vault: string): KanbanReadResult {
  const warnings: string[] = []
  const intents: KanbanIntent[] = []
  const kanbanPath = join(vault, "Job Pipeline", "Kanban.md")
  if (!existsSync(kanbanPath)) {
    warnings.push("Job Pipeline/Kanban.md not found — nothing to pull.")
    return { intents, warnings }
  }
  let currentStatus: JobStatus | null = null
  for (const line of readFileSync(kanbanPath, "utf8").split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      const label = heading[1].trim()
      currentStatus = LABEL_TO_STATUS.get(label) ?? null
      if (!currentStatus) warnings.push(`Unrecognized column "${label}" — its cards are skipped.`)
      continue
    }
    // Card line: `- [ ] [[target|alias]]` or `- [ ] [[target]]`. The alias often
    // contains a `]` (e.g. the "[60]" fit score), so extract by position rather
    // than a single regex: take the text inside the first `[[ ... ]]`, then the
    // part before the first `|`. Skip the capped-column placeholder
    // ("- [ ] _+N more…_") which has no wikilink.
    if (!currentStatus) continue
    if (!/^- \[.\]/.test(line)) continue
    const open = line.indexOf("[[")
    if (open < 0) continue
    const close = line.indexOf("]]", open + 2)
    if (close < 0) continue
    const inner = line.slice(open + 2, close)
    const target = (inner.split("|")[0] || "").trim()
    if (!target) continue
    const url = frontmatterUrl(join(vault, target + ".md"))
    if (!url) {
      warnings.push(`Could not resolve a url for board card "${target}" — skipped.`)
      continue
    }
    intents.push({ url, status: currentStatus, card: target })
  }
  return { intents, warnings }
}
