import {
  runEgoBrowser,
  lastJson,
  writeError,
  resolveCity,
  buildSearchUrl,
  idFromHref,
  urlFromHref,
  realSalary,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location: string
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

/** Raw shape cliLog'd back by the embedded browser script — one entry per job card. */
export interface RawCard {
  href: string | null
  title: string | null
  company: string | null
  companyHref: string | null
  location: string | null
  salaryRaw: string | null
  experience: string | null
  education: string | null
}

// Scroll-loop tuning. BOSS直聘's result list loads in fixed +15-card batches;
// live spike testing (see docs/superpowers/specs/2026-07-14-zhipin-search-scroll-pagination-design.md)
// found real growth never produces more than 1 consecutive flat step, so 3 is a
// safe margin for "genuinely done." Kept as fixed constants (not flags) — this
// tool is personal, low-volume use only, not meant to become a deep crawler.
export const DEFAULT_TARGET_RESULTS = 45
export const MAX_SCROLL_STEPS = 12
export const NO_GROWTH_STOP_THRESHOLD = 3
export const SCROLL_STEP_PX = 1400
export const SCROLL_WAIT_SECONDS = 1.2

export interface ScrollState {
  count: number
  target: number
  noGrowthStreak: number
  steps: number
}

/** Pure: decide whether the scroll loop should stop after observing this step's card count. */
export function shouldStopScrolling(state: ScrollState): boolean {
  if (state.count >= state.target) return true
  if (state.noGrowthStreak >= NO_GROWTH_STOP_THRESHOLD) return true
  if (state.steps >= MAX_SCROLL_STEPS) return true
  return false
}

// Verified selectors (li.job-card-box) — see url-reference.md for how these were
// confirmed against a live page dump. Salary is deliberately read raw here;
// realSalary() decides whether it's real data or the site's masked placeholder.
const DOM_SCRIPT = `(() => {
  const cards = [...document.querySelectorAll('li.job-card-box')]
  return cards.map(c => {
    const a = c.querySelector('a.job-name')
    const bossA = c.querySelector('a.boss-info')
    const bossName = bossA ? bossA.querySelector('.boss-name') : null
    const salaryEl = c.querySelector('.job-salary')
    const tags = [...c.querySelectorAll('.tag-list li')].map(li => li.innerText.trim())
    const locEl = c.querySelector('.company-location')
    return {
      href: a ? a.getAttribute('href') : null,
      title: a ? a.innerText.trim() : null,
      company: bossName ? bossName.innerText.trim() : null,
      companyHref: bossA ? bossA.getAttribute('href') : null,
      location: locEl ? locEl.innerText.trim() : null,
      salaryRaw: salaryEl ? salaryEl.innerText.trim() : null,
      experience: tags[0] || null,
      education: tags[1] || null,
    }
  })
})()`

export function buildBrowserScript(searchUrl: string): string {
  return [
    `await gotoAndWait(${JSON.stringify(searchUrl)}, { timeout: 25, settle: 2 })`,
    `await wait(1)`,
    `const results = await js(${JSON.stringify(DOM_SCRIPT)})`,
    `cliLog(JSON.stringify(results))`,
  ].join("\n")
}

/** Pure: raw cards from the page -> the documented JobCard output shape. */
export function shapeResults(raw: RawCard[], limit?: number): JobCard[] {
  let cards: JobCard[] = raw
    .map((r) => {
      const id = idFromHref(r.href)
      const url = urlFromHref(r.href)
      if (!id || !r.title || !url) return null
      const card: JobCard = {
        id,
        title: r.title,
        company: r.company,
        location: r.location,
        date: null,
        url,
        salary: realSalary(r.salaryRaw),
        experience: r.experience,
        education: r.education,
      }
      return card
    })
    .filter((c): c is JobCard => c !== null)

  if (limit !== undefined && limit >= 0) cards = cards.slice(0, limit)
  return cards
}

export function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 28).padEnd(28)
    const company = (c.company || "—").slice(0, 20).padEnd(20)
    const loc = (c.location || "—").slice(0, 20).padEnd(20)
    const sal = (c.salary || "见detail").padEnd(10)
    return `${c.id.padEnd(30)} ${title} ${company} ${loc} ${sal}`
  })
  const header =
    "ID".padEnd(30) +
    " " +
    "TITLE".padEnd(28) +
    " " +
    "COMPANY".padEnd(20) +
    " " +
    "LOCATION".padEnd(20) +
    " SALARY"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const cityCode = resolveCity(opts.location)
  if (!cityCode) {
    writeError(
      `Unknown location "${opts.location}" — pass a known city name (see CITY_CODES in helpers.ts: 上海/北京/杭州/苏州) or a raw 9-digit BOSS直聘 city code. See url-reference.md for how to verify a new one.`,
      "BAD_LOCATION",
    )
    return 1
  }
  try {
    const url = buildSearchUrl(opts.query || "", cityCode)
    const stdout = await runEgoBrowser(buildBrowserScript(url))
    const raw = lastJson<RawCard[]>(stdout)
    const cards = shapeResults(raw, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.salary || "薪资见 detail（列表页已脱敏）"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
