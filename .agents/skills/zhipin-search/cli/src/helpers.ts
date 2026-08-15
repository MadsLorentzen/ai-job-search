// Data source: the user's logged-in BOSS直聘 session via Chrome CDP.
// Search reads the rendered job cards; detail reads the rendered description.
// Read-only. The DOM selectors below are the current BOSS直聘 markup; if they
// change, update them here and in url-reference.md.

import { CDPSession, getPageTab, sleep } from "./cdp.js"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  salary: string | null
  date: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  applyUrl: string | null
}

// BOSS直聘 city codes. 上海 is verified; the rest are best-effort — confirm by
// checking the `city=` param in the browser URL before relying on them.
export const CITY_CODES: Record<string, string> = {
  上海: "101020100",
  北京: "101010100",
  杭州: "101210100",
  深圳: "101280600",
  广州: "101280100",
  南京: "101190100",
  苏州: "101190400",
  成都: "101270100",
  武汉: "101200100",
  西安: "101110100",
}

export function cityCode(location: string | undefined): string {
  if (!location) return ""
  if (CITY_CODES[location]) return CITY_CODES[location]
  if (/^\d{9}$/.test(location)) return location // raw code passthrough
  return location // unmapped name — pass through and let the site resolve it
}

export function buildSearchUrl(opts: {
  query?: string
  location?: string
  page: number
}): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("query", opts.query)
  const code = cityCode(opts.location)
  if (code) params.set("city", code)
  params.set("page", String(Math.max(1, opts.page)))
  return `https://www.zhipin.com/web/geek/job?${params.toString()}`
}

/** Reuse one page tab across operations. Leave it open — rapid open/close
 *  trips BOSS直聘's risk control and returns empty results. */
async function withPage<T>(driver: (session: CDPSession) => Promise<T>): Promise<T> {
  await sleep(800) // pace consecutive operations so they don't look like a bot
  const target = await getPageTab()
  const session = await CDPSession.connect(target.webSocketDebuggerUrl)
  try {
    await session.send("Page.enable")
    await session.send("Runtime.enable")
    return await driver(session)
  } finally {
    session.close() // keep the tab open for reuse
  }
}

/** Poll until `expression` evaluates truthy, or time out. */
async function waitFor(
  session: CDPSession,
  expression: string,
  timeoutMs = 15000,
  pollMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await session.evaluate(`Boolean(${expression})`)) return true
    await sleep(pollMs)
  }
  return false
}

/**
 * Navigate and wait until the page actually loads the new URL. A bare
 * `Page.navigate` returns before the navigation begins, and BOSS直聘's SPA can
 * restore a stale render from the browser's back/forward cache — so we bounce
 * through `about:blank` first to force a clean load, then wait for the site.
 */
async function navigateAndWait(session: CDPSession, url: string): Promise<void> {
  await session.navigate("about:blank")
  await sleep(300)
  await session.navigate(url)
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    const here = (await session.evaluate("location.href")) as string
    if (here.includes("zhipin.com")) return
    await sleep(300)
  }
}

const SEARCH_EXTRACT = `(() => {
  const text = (root, sel) => {
    const el = root.querySelector(sel);
    return el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
  };
  const out = [];
  for (const card of document.querySelectorAll('li.job-card-box')) {
    const link = card.querySelector('a[href*="/job_detail/"]');
    const href = link ? (link.getAttribute('href') || '') : '';
    out.push({
      href,
      title: text(card, '.job-name'),
      salary: text(card, '.job-salary'),
      company: text(card, '.boss-name'),
      area: text(card, '.company-location')
    });
  }
  return out;
})()`

export function parseJobId(href: string): string | null {
  const m = href.match(/\/job_detail\/([^/?#]+)/)
  if (!m) return null
  return m[1].replace(/\.html$/, "")
}

export async function searchPage(
  query: string | undefined,
  location: string | undefined,
  page: number,
): Promise<JobCard[]> {
  const url = buildSearchUrl({ query, location, page })
  return withPage(async (session) => {
    await navigateAndWait(session, url)
    const ready = await waitFor(
      session,
      `document.querySelectorAll('li.job-card-box').length > 0`,
    )
    if (!ready) await sleep(1500)

    const raw = (await session.evaluate(SEARCH_EXTRACT)) as Array<{
      href: string
      title: string
      salary: string
      company: string
      area: string
    }> | null

    if (!Array.isArray(raw) || raw.length === 0) {
      const here = (await session.evaluate("location.href")) as string
      if (here.includes("passport") || here.includes("security")) {
        throw new Error(
          "BOSS直聘 redirected to a login/security page — log into BOSS直聘 in the Chrome window first.",
        )
      }
      return []
    }

    const cards: JobCard[] = []
    for (const r of raw) {
      const id = parseJobId(r.href || "")
      if (!r.title || !id) continue
      cards.push({
        id,
        title: r.title,
        company: r.company || null,
        location: r.area || null,
        salary: r.salary || null,
        date: null,
        url: r.href.startsWith("http")
          ? r.href
          : `https://www.zhipin.com${r.href}`,
      })
    }
    return cards
  })
}

const DETAIL_EXTRACT = `(() => {
  const text = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
  };
  const inner = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.innerText.replace(/\\s+/g, ' ').trim() : '';
  };
  const company = (() => {
    const a = document.querySelector('.company-info a[href*="/gongsi/"]');
    return a ? (a.getAttribute('title') || a.textContent.replace(/\\s+/g, ' ').trim()) : '';
  })();
  const desc = Array.from(document.querySelectorAll('.job-sec-text'))
    .map((s) => s.innerText.replace(/\\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\\n\\n');
  return {
    title: text('h1'),
    salary: text('.salary'),
    company,
    location: text('.location-address') || text('.job-location'),
    description: desc || inner('.job-detail')
  };
})()`

export async function detailPage(id: string): Promise<JobDetail | null> {
  const url = `https://www.zhipin.com/job_detail/${id}.html`
  return withPage(async (session) => {
    await navigateAndWait(session, url)
    // The description loads via XHR with variable timing; poll the extract
    // directly until it returns usable content (up to ~20s).
    let raw: {
      title: string
      salary: string
      company: string
      location: string
      description: string
    } | null = null
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      raw = (await session.evaluate(DETAIL_EXTRACT)) as {
        title: string
        salary: string
        company: string
        location: string
        description: string
      } | null
      if (raw && (raw.title || raw.description)) break
      await sleep(1000)
    }

    if (!raw || (!raw.title && !raw.description)) {
      const here = (await session.evaluate("location.href")) as string
      if (here.includes("passport") || here.includes("security")) {
        throw new Error(
          "BOSS直聘 redirected to a login/security page — log into BOSS直聘 in the Chrome window first.",
        )
      }
      return null
    }

    return {
      id,
      title: raw.title || "(untitled)",
      company: raw.company || null,
      location: raw.location || null,
      salary: raw.salary || null,
      date: null,
      url,
      description: raw.description || null,
      applyUrl: null,
    }
  })
}
