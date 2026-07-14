// Data source: BOSS直聘 (zhipin.com), mainland China's largest tech/security job
// board. Unlike linkedin-search's htmlFetch, this CANNOT be a stateless HTTP client:
// an unauthenticated `fetch()` of the search page returns an empty <div id="app">
// shell (a client-rendered Vue SPA — see url-reference.md). There is no public JSON
// API. Real results only render after JS executes inside an authenticated browser
// session. So instead of `fetch`, every command here shells out to the `ego-browser`
// CLI, which drives a real Chrome tab reusing your own logged-in session — the same
// access a human doing this search manually would have.
//
// Personal use only — this is browser automation of your own account, at low,
// interactive volume. robots.txt disallows automated access to the query-string
// search paths this needs (`?query=`, `?city=`, and a catch-all `/*?*`); keep this to
// what you'd do by hand (a handful of searches, not a crawl). Run on your own
// responsibility. Requires `ego-browser` on PATH and Chrome running with an active
// BOSS直聘 (求职者) login session.

import { spawn } from "node:child_process"

export const BASE_URL = "https://www.zhipin.com"
const TASK_SPACE = "zhipin-cli"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/**
 * Run a JS snippet inside a shared ego-browser task space and return its
 * combined output. The snippet must end with exactly one
 * `cliLog(JSON.stringify(...))` call — we parse the last JSON-shaped line of
 * output for it. Empirically, `ego-browser nodejs` writes ALL output
 * (console.log AND cliLog) to stderr when run non-interactively via stdin —
 * nothing appears on stdout — so we concatenate both streams rather than
 * assume either one.
 */
export async function runEgoBrowser(script: string, timeoutMs = 45000): Promise<string> {
  const full = `const task = await useOrCreateTaskSpace(${JSON.stringify(TASK_SPACE)})\n${script}`
  return new Promise((resolve, reject) => {
    const proc = spawn("ego-browser", ["nodejs"], { stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error(`ego-browser timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()))
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()))
    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "ego-browser CLI not found on PATH — install/configure it first (see the ego-browser skill's references/install.md)",
          ),
        )
      } else {
        reject(err)
      }
    })
    proc.on("close", (code: number | null) => {
      clearTimeout(timer)
      const combined = stdout + stderr
      if (code !== 0 && !combined.trim()) {
        reject(new Error(`ego-browser exited ${code} with no output`))
        return
      }
      resolve(combined)
    })
    proc.stdin.write(full)
    proc.stdin.end()
  })
}

/** Extract the last JSON value printed to stdout. */
export function lastJson<T = unknown>(stdout: string): T {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]) as T
    } catch {
      continue
    }
  }
  throw new Error(`No JSON found in ego-browser output:\n${stdout}`)
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  salary: string | null
  experience: string | null
  education: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
}

// Known verified city codes (BOSS直聘 `city=` param). Empirically confirmed by
// running a live search and checking that result locations match the requested
// city — do NOT add a code here without verifying it the same way (see
// url-reference.md "Finding more city codes").
export const CITY_CODES: Record<string, string> = {
  上海: "101020100",
  shanghai: "101020100",
  北京: "101010100",
  beijing: "101010100",
  杭州: "101210100",
  hangzhou: "101210100",
  苏州: "101190400",
  suzhou: "101190400",
}

export function resolveCity(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{9}$/.test(trimmed)) return trimmed
  return CITY_CODES[trimmed] ?? CITY_CODES[trimmed.toLowerCase()] ?? null
}

export function buildSearchUrl(query: string, cityCode: string): string {
  const params = new URLSearchParams()
  if (query) params.set("query", query)
  params.set("city", cityCode)
  return `${BASE_URL}/web/geek/job?${params.toString()}`
}

/** BOSS直聘 job_detail hrefs are relative, e.g. "/job_detail/<id>.html". */
export function idFromHref(href: string | null): string | null {
  if (!href) return null
  const m = href.match(/\/job_detail\/([^./]+)\.html/)
  return m ? m[1] : null
}

export function urlFromHref(href: string | null): string | null {
  if (!href) return null
  return href.startsWith("http") ? href : `${BASE_URL}${href}`
}

/**
 * The search-results list masks salary behind a canvas overlay; the underlying
 * DOM text node is a literal placeholder like "-K" with no digits. Only the
 * detail page shows the real, unmasked salary. Treat a placeholder as missing
 * data (null) rather than returning garbage.
 */
export function realSalary(raw: string | null): string | null {
  if (!raw || !/\d/.test(raw)) return null
  return raw
}

/**
 * Fallback company-name parse from the detail page's <title>, e.g.
 * "「安全运营工程师招聘」_NIO蔚来招聘-BOSS直聘" -> "NIO蔚来".
 */
export function companyFromTitle(pageTitle: string): string | null {
  const m = pageTitle.match(/_(.+?)招聘-BOSS直聘\s*$/)
  return m ? m[1] : null
}
