#!/usr/bin/env bun
// CLI for prefilling US job application forms (Greenhouse, Lever, Ashby,
// Workday, and generic forms) from a local profile file.
//
// This tool NEVER submits an application. It fills fields, attaches documents,
// screenshots the result, and hands the browser to you. See SKILL.md.

import { existsSync, readFileSync } from "fs"
import { resolve as resolvePath, join, dirname } from "path"
import { fileURLToPath } from "url"
import { detectAts, fillApplication, type FillReport } from "./fill.ts"
import { createReviewGateFromEnv } from "./review-gate.ts"
import type { Profile } from "./matcher.ts"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { p: "profile", r: "resume", c: "cover", o: "screenshot" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `ats-autofill — prefill a job application form, never submit it

USAGE
  node --experimental-strip-types src/cli.ts fill <job_url> [flags]
  node --experimental-strip-types src/cli.ts inspect <job_url>
  node --experimental-strip-types src/cli.ts doctor

FILL FLAGS
  --profile, -p <path>   Path to application_profile.json.
                         Default: <repo root>/application_profile.json
  --resume, -r <path>    Resume PDF to attach. Overrides the profile value.
  --cover, -c <path>     Cover letter PDF to attach. Overrides the profile value.
  --screenshot, -o <p>   Where to write the filled-form screenshot.
                         Default: job_scraper/autofill_<timestamp>.png
  --headed               Show the browser and pause for manual review. RECOMMENDED.
  --dry-run              Report what would be filled without touching the page.
  --timeout <ms>         Navigation timeout. Default 30000.
  --format <fmt>         json (default) | table

COMMANDS
  fill      Fill the application form and stop before submitting.
  inspect   List the form's fields and what each would be filled with (implies --dry-run).
  doctor    Check that Playwright, a browser, and the profile file are all present.

EXAMPLES
  node --experimental-strip-types src/cli.ts doctor
  node --experimental-strip-types src/cli.ts inspect https://job-boards.greenhouse.io/acme/jobs/1234567
  node --experimental-strip-types src/cli.ts fill https://jobs.lever.co/acme/abc-123 --headed \\
      -r ../../../../cv/main_acme.pdf -c ../../../../cover_letters/cover_acme_ai_engineer.pdf

This tool does not click Submit. Ever. Review the form yourself and submit it.
Automated submission on LinkedIn, Indeed, and Dice violates their Terms of
Service and risks losing the accounts your job search depends on.
`

function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** Walk up from the CLI directory to the repo root (the dir holding CLAUDE.md). */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "CLAUDE.md"))) return dir
    dir = resolvePath(dir, "..")
  }
  return process.cwd()
}

function loadProfile(path: string): Profile {
  if (!existsSync(path)) {
    throw new Error(
      `No profile at ${path}. Copy application_profile.example.json to ` +
        `application_profile.json at the repo root and fill it in.`,
    )
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Profile
  const missing: string[] = []
  if (!parsed.identity?.firstName) missing.push("identity.firstName")
  if (!parsed.identity?.lastName) missing.push("identity.lastName")
  if (!parsed.identity?.email) missing.push("identity.email")
  if (typeof parsed.workAuthorization?.authorizedUS !== "boolean")
    missing.push("workAuthorization.authorizedUS")
  if (typeof parsed.workAuthorization?.requiresSponsorship !== "boolean")
    missing.push("workAuthorization.requiresSponsorship")
  if (missing.length) {
    throw new Error(`Profile is missing required fields: ${missing.join(", ")}`)
  }
  parsed.answers ??= {}
  parsed.links ??= {}
  parsed.eeo ??= {}
  parsed.preferences ??= {}
  parsed.documents ??= {}
  return parsed
}

function printReport(report: FillReport, format: string): void {
  if (format === "table") {
    const lines: string[] = []
    lines.push(`URL:        ${report.url}`)
    lines.push(`ATS:        ${report.ats}`)
    lines.push(`Submitted:  no (by design)`)
    if (report.screenshot) lines.push(`Screenshot: ${report.screenshot}`)
    lines.push("")
    lines.push(`FILLED (${report.filled.length})`)
    for (const f of report.filled) {
      const flag = f.confidence === "low" ? "  <-- CHECK" : ""
      lines.push(`  ${f.label}`)
      lines.push(`      = ${f.value}${flag}`)
    }
    if (report.skipped.length) {
      lines.push("")
      lines.push(`NEEDS YOUR INPUT (${report.skipped.length})`)
      for (const s of report.skipped) lines.push(`  ${s.label}  (${s.reason})`)
    }
    process.stdout.write(lines.join("\n") + "\n")
    return
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n")
}

async function runDoctor(profilePath: string): Promise<number> {
  const checks: { name: string; ok: boolean; detail: string }[] = []

  let playwrightOk = false
  try {
    await import("playwright")
    playwrightOk = true
  } catch {
    /* not installed */
  }
  checks.push({
    name: "playwright",
    ok: playwrightOk,
    detail: playwrightOk ? "installed" : "run `bun install` in this directory",
  })

  let browserOk = false
  if (playwrightOk) {
    try {
      const { chromium } = await import("playwright")
      const { launchOptions } = await import("./fill.ts")
      const b = await chromium.launch(launchOptions(true))
      await b.close()
      browserOk = true
    } catch (e) {
      checks.push({ name: "browser-launch-error", ok: false, detail: String(e).slice(0, 200) })
    }
  }
  checks.push({
    name: "chromium",
    ok: browserOk,
    detail: browserOk
      ? `launches${process.env.ATS_AUTOFILL_CHROMIUM ? " (ATS_AUTOFILL_CHROMIUM override)" : ""}`
      : "run `bunx playwright install chromium`, or set ATS_AUTOFILL_CHROMIUM to an existing Chromium binary",
  })

  const profileOk = existsSync(profilePath)
  checks.push({
    name: "profile",
    ok: profileOk,
    detail: profileOk ? profilePath : `missing: ${profilePath}`,
  })

  let profileValid = false
  if (profileOk) {
    try {
      loadProfile(profilePath)
      profileValid = true
    } catch (e) {
      checks.push({ name: "profile-validation", ok: false, detail: (e as Error).message })
    }
  }
  checks.push({ name: "profile-fields", ok: profileValid, detail: profileValid ? "valid" : "invalid" })

  const allOk = checks.every((c) => c.ok)
  process.stdout.write(JSON.stringify({ ok: allOk, checks }, null, 2) + "\n")
  return allOk ? 0 : 1
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const root = repoRoot()
  const profilePath =
    typeof flags.profile === "string"
      ? resolvePath(flags.profile)
      : join(root, "application_profile.json")

  if (cmd === "doctor") return runDoctor(profilePath)

  if (cmd !== "fill" && cmd !== "inspect") {
    writeError(`Unknown command "${cmd}"`, "BAD_CMD")
    return 1
  }

  const url = (flags._ as string[])[1]
  if (!url) {
    writeError(`${cmd} requires a <job_url>`, "NO_URL")
    return 1
  }
  if (!/^https?:\/\//i.test(url)) {
    writeError(`"${url}" is not an http(s) URL`, "BAD_URL")
    return 1
  }

  let profile: Profile
  try {
    profile = loadProfile(profilePath)
  } catch (e) {
    writeError((e as Error).message, "BAD_PROFILE")
    return 1
  }

  if (typeof flags.resume === "string") profile.documents.resume = resolvePath(flags.resume)
  if (typeof flags.cover === "string") profile.documents.coverLetter = resolvePath(flags.cover)

  for (const [label, p] of [
    ["resume", profile.documents.resume],
    ["cover letter", profile.documents.coverLetter],
  ] as const) {
    if (p && !existsSync(resolvePath(p))) {
      writeError(`${label} not found at ${p}`, "MISSING_DOCUMENT")
      return 1
    }
  }

  const dryRun = cmd === "inspect" || flags["dry-run"] === true
  const timeout = flags.timeout ? parseInt(flags.timeout as string, 10) : 30000
  if (isNaN(timeout) || timeout <= 0) {
    writeError(`--timeout must be a positive number, got "${flags.timeout}"`, "BAD_ARG")
    return 1
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const screenshotPath = dryRun
    ? null
    : typeof flags.screenshot === "string"
      ? resolvePath(flags.screenshot)
      : join(root, "job_scraper", `autofill_${stamp}.png`)

  try {
    const report = await fillApplication({
      url,
      profile,
      headed: flags.headed === true,
      dryRun,
      screenshotPath,
      timeoutMs: timeout,
      reviewGate: flags.headed === true ? createReviewGateFromEnv() : undefined,
    })
    printReport(report, (flags.format as string) || (cmd === "inspect" ? "table" : "json"))
    return 0
  } catch (e) {
    writeError((e as Error).message, "FILL_FAILED")
    return 1
  }
}

export { detectAts }

main().then((code) => process.exit(code))
