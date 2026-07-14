import { runEgoBrowser, lastJson, writeError, BASE_URL, companyFromTitle, type JobDetail } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Raw shape cliLog'd back by the embedded browser script for a single posting. */
export interface RawDetail {
  title: string | null
  salary: string | null
  city: string | null
  experience: string | null
  education: string | null
  address: string | null
  company: string | null
  description: string | null
  pageTitle: string
}

// Verified selectors — see url-reference.md. Two things matter here that don't
// apply to the search-list scrape:
//  1. Salary (`.info-primary .salary`) is REAL on the detail page, unlike the
//     list view's masked placeholder.
//  2. Description is read via `.innerText`, never `.textContent`/raw HTML — the
//     page injects invisible watermark spans (e.g. "BOSS直聘") mid-word into the
//     description's DOM that only `.innerText` (CSS-visibility-aware) filters out.
const DOM_SCRIPT = `(() => {
  const q = s => document.querySelector(s)
  const text = el => el ? el.innerText.trim() : null
  const h1 = q('.info-primary h1')
  const companyA = q('.sider-company .company-info a')
  return {
    title: h1 ? (h1.getAttribute('title') || h1.innerText.trim()) : null,
    salary: text(q('.info-primary .salary')),
    city: text(q('.info-primary .text-city')),
    experience: text(q('.info-primary .text-experiece')),
    education: text(q('.info-primary .text-degree')),
    address: text(q('.location-address')),
    company: companyA ? (companyA.getAttribute('title') || companyA.innerText.trim()) : null,
    description: text(q('.job-sec-text, .job-detail-section .text')),
    pageTitle: document.title,
  }
})()`

export function buildBrowserScript(url: string): string {
  return [
    `await gotoAndWait(${JSON.stringify(url)}, { timeout: 25, settle: 2 })`,
    `await wait(1)`,
    `const result = await js(${JSON.stringify(DOM_SCRIPT)})`,
    `cliLog(JSON.stringify(result))`,
  ].join("\n")
}

/** Accept a bare BOSS直聘 job id (the hash in /job_detail/<id>.html) or a full URL. */
export function normalizeUrl(input: string): string | null {
  if (/^https?:\/\//.test(input)) return input
  if (/^[A-Za-z0-9_~-]+$/.test(input)) return `${BASE_URL}/job_detail/${input}.html`
  return null
}

/** Pure: raw page data -> the documented JobDetail output shape. */
export function shapeDetail(raw: RawDetail, url: string): JobDetail | null {
  if (!raw.title) return null
  const idMatch = url.match(/\/job_detail\/([^./]+)\.html/)
  return {
    id: idMatch ? idMatch[1] : url,
    title: raw.title,
    company: raw.company || companyFromTitle(raw.pageTitle),
    location: raw.address || raw.city,
    date: null,
    url,
    salary: raw.salary,
    experience: raw.experience,
    education: raw.education,
    description: raw.description,
  }
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const url = normalizeUrl(opts.id)
  if (!url) {
    writeError(
      `Could not build a job_detail URL from "${opts.id}" — pass the id from search results or a full zhipin.com job_detail URL`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const stdout = await runEgoBrowser(buildBrowserScript(url))
    const raw = lastJson<RawDetail>(stdout)
    const job = shapeDetail(raw, url)
    if (!job) {
      writeError("Job not found (expired/removed posting, or the page failed to render)", "NOT_FOUND")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"} · ${job.salary || "—"}`,
        job.experience ? `经验: ${job.experience}` : "",
        job.education ? `学历: ${job.education}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
