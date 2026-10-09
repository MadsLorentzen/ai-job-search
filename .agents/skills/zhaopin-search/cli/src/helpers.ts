import type { StandardJob } from "../../../../shared/job-schema.js"
import { normalizeEducation, normalizeExperience, parseChineseDate, parseChineseSalary } from "../../../../shared/job-normalization.js"

export const BASE_URL = "https://www.zhaopin.com"
const USER_AGENT = "Mozilla/5.0 (compatible; zhaopin-search-cli/0.1; read-only)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export async function htmlFetch(url: string): Promise<string> {
  for (let attempt = 0, delay = 500; attempt <= 4; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml", "Accept-Language": "zh-CN,zh;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (error) {
      throw new Error(`could not reach zhaopin.com: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 4) throw new Error(`request failed: ${response.status} ${response.statusText}`)
      await new Promise((resolve) => setTimeout(resolve, delay + Math.floor(Math.random() * 250)))
      delay = Math.min(delay * 2, 4000)
      continue
    }
    if (response.status === 404) throw new Error("job not found")
    if (!response.ok) throw new Error(`request failed: ${response.status} ${response.statusText}`)
    return response.text()
  }
  throw new Error("request failed after retries")
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => numericEntity(Number.parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => numericEntity(Number.parseInt(n, 16)))
}

export function cleanText(value: string | null | undefined): string | null {
  if (!value) return null
  const text = decodeHtmlEntities(value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim()
  return text || null
}

function classContent(html: string, className: string): string | null {
  const open = new RegExp(`<([a-z0-9]+)[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, "i").exec(html)
  if (!open) return null
  const start = open.index + open[0].length
  const tag = open[1]
  const token = new RegExp(`<\\/?${tag}\\b`, "gi")
  token.lastIndex = start
  let depth = 1
  let match: RegExpExecArray | null
  while ((match = token.exec(html))) {
    if (html.slice(match.index, match.index + 2 + tag.length).toLowerCase() === `</${tag}`.toLowerCase()) depth--
    else depth++
    if (depth === 0) return html.slice(start, match.index)
  }
  return null
}

function firstText(html: string, selectorClass: string): string | null {
  const m = new RegExp(`<[^>]*class=["'][^"']*\\b${selectorClass}\\b[^"']*["'][^>]*>([\\s\\S]*?)</`, "i").exec(html)
  return m ? cleanText(m[1]) : null
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  date: string | null
  salary: string | null
  experience: string | null
  education: string | null
  url: string
}

function publishDates(html: string): Map<string, string> {
  const dates = new Map<string, string>()
  // The SSR position object places publishTime after salary/company metadata;
  // allow that metadata to grow while stopping before another position object.
  const re = /"positionNumber":"?([^",}]+)"?(?:(?!"positionNumber")[\s\S]){0,20000}?"publishTime":"(\d{4}-\d{2}-\d{2})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) dates.set(m[1], m[2])
  return dates
}

export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const dates = publishDates(html)
  const cardRe = /<div[^>]*class=["'][^"']*joblist-box__item(?=[\s"'])[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]*class=["'][^"']*joblist-box__item(?=[\s"'])[^"']*["']|$)/gi
  let card: RegExpExecArray | null
  while ((card = cardRe.exec(html))) {
    const chunk = card[1]
    const link = chunk.match(/<a(?=[^>]*class=["'][^"']*jobinfo__name[^"']*["'])[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
    if (!link) continue
    const parsedUrl = new URL(link[1], BASE_URL)
    parsedUrl.protocol = "https:"
    const url = parsedUrl.toString()
    const id = url.match(/jobdetail\/([^/?#]+)/i)?.[1]?.replace(/\.html?$/i, "") ?? ""
    if (!id) continue
    const info = [...chunk.matchAll(/<div[^>]*class=["'][^"']*jobinfo__other-info-item[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)].map((m) => cleanText(m[1]))
    const companyLink = chunk.match(/<a(?=[^>]*class=["'][^"']*companyinfo__name[^"']*["'])[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
    results.push({
      id,
      title: cleanText(link[2]) ?? "(untitled)",
      company: companyLink ? cleanText(companyLink[2]) : firstText(chunk, "companyinfo__name"),
      companyUrl: companyLink ? new URL(companyLink[1], BASE_URL).toString() : null,
      location: info[0],
      date: dates.get(id) ?? null,
      salary: firstText(chunk, "jobinfo__salary"),
      experience: info[1],
      education: info[2],
      url,
    })
  }
  return results
}

export interface JobDetail extends JobCard {
  description: string | null
  deadline: string | null
  recruitCount: number | null
}

export function parseJobDetail(html: string, url: string, id: string): JobDetail {
  const title = firstText(html, "summary-planes__title")
  if (!title) throw new Error("failed to parse job listing HTML")
  const infoBlock = classContent(html, "summary-planes__info") ?? ""
  const infos = [...infoBlock.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => cleanText(m[1]))
  const companyLink = html.match(/<a(?=[^>]*class=["'][^"']*company-info__name[^"']*["'])[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
  const descBlock = classContent(html, "describtion-card__detail-content")
  const location = cleanText(classContent(html, "address-info__content")) ?? (infos.slice(0, 2).filter(Boolean).join("·") || null)
  const salary = firstText(html, "summary-planes__salary")
  const bodyText = cleanText(descBlock)
  const dateMatch = html.match(/(?:publishTime|positionPublishTime)["']?\s*[:=]\s*["'](\d{4}-\d{2}-\d{2})/i)
  return {
    id, title, company: companyLink ? cleanText(companyLink[2]) : null,
    companyUrl: companyLink ? new URL(companyLink[1], BASE_URL).toString() : null,
    location, date: dateMatch?.[1] ?? null, salary,
    experience: infos[2], education: infos[3], url,
    description: bodyText, deadline: null, recruitCount: null,
  }
}

export function toStandardJob(job: JobCard | JobDetail, source: StandardJob["source"] = "cli"): StandardJob {
  const salary = parseChineseSalary(job.salary)
  const date = parseChineseDate(job.date)
  return {
    id: job.id, title: job.title, company: job.company, location: job.location, date,
    url: job.url, description: "description" in job ? job.description : null, salary: job.salary,
    salary_min: salary.min, salary_max: salary.max, salary_months: salary.months, salary_unit: salary.unit,
    experience: normalizeExperience(job.experience), education: normalizeEducation(job.education),
    employment_type: null, work_mode: null, recruit_count: "recruitCount" in job ? job.recruitCount : null,
    deadline: "deadline" in job ? parseChineseDate(job.deadline) : null, portal: "zhaopin-search", source,
    access_mode: "public_html", raw_id: job.id, fetched_at: new Date().toISOString(),
  }
}

export function buildSearchUrl(query: string, page: number, city?: string): string {
  const params = new URLSearchParams({ kw: [query, city].filter(Boolean).join(" "), p: String(page) })
  return `${BASE_URL}/sou?${params.toString()}`
}

export function extractId(input: string): { id: string; url: string } {
  const bare = input.replace(/\.html?$/i, "")
  const url = input.startsWith("http") ? new URL(input) : new URL(`${BASE_URL}/jobdetail/${bare}.htm`)
  url.protocol = "https:"
  const id = url.pathname.match(/jobdetail\/([^/.]+)/i)?.[1]
  if (!id) throw new Error("detail requires a valid Zhaopin job ID or URL")
  return { id, url: url.toString() }
}

export function isBlockedPage(html: string): boolean {
  // Normal public pages include a header login link. Treat auth markers as a
  // block only when the expected job content is absent, otherwise every valid
  // SSR page would be rejected before parsing.
  if (/joblist-box__item|summary-planes__title|describtion-card__detail-content/.test(html)) return false
  return /passport\.zhaopin\.com|验证码|安全验证|登录\/注册/.test(html)
}
