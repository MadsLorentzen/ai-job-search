#!/usr/bin/env bun
// Extracts background-agent (Task/Agent tool) token-usage stats from Claude Code's
// own session transcript files and appends new rows to job_scraper/agent_token_log.csv.
//
// How this actually works (confirmed empirically, not from documentation - this
// structure isn't publicly documented): completion notifications are NOT stored as
// a tool_result linked to the original "Agent" tool_use call. They live as separate
// top-level transcript entries with `"type":"queue-operation"`, whose `content` field is
// a plain string containing the ENTIRE <task-notification> block verbatim - task-id,
// tool-use-id, a <summary>"Agent "<description>" finished"</summary> line, and (for
// completed agents) a <usage><subagent_tokens>...</subagent_tokens>...</usage> block.
// Everything needed is in that one string; no cross-referencing tool_use/tool_result
// pairs required.
//
// Usage: bun run job_scraper/extract_agent_usage.js
// Safe to re-run anytime - already-logged task_ids are skipped, never duplicated.

import { readdirSync, createReadStream, existsSync, appendFileSync, readFileSync } from "fs"
import { createInterface } from "readline"
import { homedir } from "os"
import { join, resolve } from "path"

const CSV_PATH = join(import.meta.dir, "agent_token_log.csv")

function csvField(value) {
  const s = String(value ?? "")
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function projectSessionDir() {
  // Claude Code encodes the absolute cwd into the session-log directory name by
  // replacing ":" and path separators with "-" - mirrors that so this script finds the
  // right directory for whatever repo it's run from, not hardcoded to one machine.
  const encoded = resolve(process.cwd()).replace(/[:\\/]/g, "-")
  return join(homedir(), ".claude", "projects", encoded)
}

function alreadyLoggedIds() {
  const ids = new Set()
  if (!existsSync(CSV_PATH)) return ids
  const lines = readFileSync(CSV_PATH, "utf8").split("\n")
  const header = lines[0]?.split(",") ?? []
  const idCol = header.indexOf("task_id")
  if (idCol === -1) return ids
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const id = line.split(",").pop()?.trim()
    if (id) ids.add(id)
  }
  return ids
}

function parseNotification(content) {
  const taskId = content.match(/<task-id>(.*?)<\/task-id>/)?.[1]
  if (!taskId) return null
  const status = content.match(/<status>(.*?)<\/status>/)?.[1] ?? "unknown"
  const summary = content.match(/<summary>(.*?)<\/summary>/)?.[1] ?? ""
  // Summary is typically: Agent "<description>" finished  (or "failed: <reason>")
  const description = summary.match(/Agent "(.*?)"/)?.[1] ?? summary
  const usageMatch = content.match(/<subagent_tokens>(\d+)<\/subagent_tokens>[\s\S]*?<tool_uses>(\d+)<\/tool_uses>[\s\S]*?<duration_ms>(\d+)<\/duration_ms>/)
  return {
    taskId,
    status,
    description,
    subagentTokens: usageMatch?.[1] ?? "",
    toolUses: usageMatch?.[2] ?? "",
    durationMs: usageMatch?.[3] ?? "",
  }
}

async function extractFromFile(filePath, seenIds, rows) {
  const rl = createInterface({ input: createReadStream(filePath, "utf8"), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.includes("queue-operation") || !line.includes("<task-notification>")) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type !== "queue-operation" || typeof entry.content !== "string") continue
    const parsed = parseNotification(entry.content)
    if (!parsed || seenIds.has(parsed.taskId)) continue
    seenIds.add(parsed.taskId)
    rows.push({
      date: (entry.timestamp ?? "").slice(0, 10) || "unknown",
      company: "",
      role: "",
      task_type: "",
      subagent_tokens: parsed.subagentTokens,
      tool_uses: parsed.toolUses,
      duration_ms: parsed.durationMs,
      notes: parsed.status !== "completed" ? `status: ${parsed.status}` : "",
      description: parsed.description,
      task_id: parsed.taskId,
    })
  }
}

async function main() {
  const dir = projectSessionDir()
  if (!existsSync(dir)) {
    console.error(`Session directory not found: ${dir}`)
    process.exit(1)
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f))
  if (files.length === 0) {
    console.log("No transcript files found - nothing to extract.")
    return
  }

  const seenIds = alreadyLoggedIds()
  const rows = []
  for (const file of files) {
    await extractFromFile(file, seenIds, rows)
  }

  if (rows.length === 0) {
    console.log("No new agent-dispatch usage entries found (everything already logged).")
    return
  }

  const csvLines = rows.map((r) =>
    [r.date, r.company, r.role, r.task_type, r.subagent_tokens, r.tool_uses, r.duration_ms, r.notes, r.description, r.task_id]
      .map(csvField)
      .join(",")
  )
  appendFileSync(CSV_PATH, csvLines.join("\n") + "\n")
  console.log(`Appended ${rows.length} new row(s) to ${CSV_PATH}`)
  for (const r of rows) {
    console.log(`  ${r.date} | ${r.subagent_tokens || "n/a"} tokens | ${r.tool_uses || "n/a"} tool calls | ${r.description}${r.notes ? " (" + r.notes + ")" : ""}`)
  }
}

main()
