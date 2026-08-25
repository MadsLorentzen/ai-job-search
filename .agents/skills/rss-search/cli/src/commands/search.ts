import { readFileSync } from "fs"
import { fetchText, parseFeed, parseFeedsFile, type JobResult } from "../helpers.js"

export interface SearchOpts {
  query?: string
  jobage?: number
  limit?: number
  page?: number
  feeds: string[]
  feedsFile?: string
  format: "json" | "table" | "plain"
}

export async function runSearch(opts: SearchOpts): Promise<void> {
  const urls = [...opts.feeds]
  if (opts.feedsFile) {
    urls.push(...parseFeedsFile(readFileSync(opts.feedsFile, "utf8")))
  }
  if (urls.length === 0) {
    throw Object.assign(new Error("pass --feed <url> or --feeds-file <path>"), { code: "BAD_ARG" })
  }

  const seen = new Set<string>()
  let results: JobResult[] = []
  for (const feed of urls) {
    const xml = await fetchText(feed)
    if (!xml) continue
    for (const job of parseFeed(xml, feed)) {
      if (seen.has(job.url)) continue
      seen.add(job.url)
      results.push(job)
    }
  }

  if (opts.query) {
    const q = opts.query.toLowerCase()
    results = results.filter((job) => `${job.title} ${job.description ?? ""}`.toLowerCase().includes(q))
  }
  if (opts.jobage != null) {
    const cutoff = Date.now() - opts.jobage * 24 * 60 * 60 * 1000
    results = results.filter((job) => {
      if (!job.date) return true
      return new Date(`${job.date}T00:00:00Z`).getTime() >= cutoff
    })
  }

  const page = opts.page && opts.page > 0 ? opts.page : 1
  const pageSize = opts.limit && opts.limit > 0 ? opts.limit : 20
  const start = (page - 1) * pageSize
  const sliced = results.slice(start, start + pageSize)

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify({ meta: { count: sliced.length, page, total: results.length }, results: sliced }) + "\n")
    return
  }
  if (opts.format === "table") {
    process.stdout.write("#\ttitle\tcompany\tdate\turl\n")
    sliced.forEach((job, i) => {
      process.stdout.write(`${i + 1}\t${job.title}\t${job.company ?? ""}\t${job.date ?? ""}\t${job.url}\n`)
    })
    return
  }
  for (const job of sliced) {
    process.stdout.write(`${job.title}\n${job.url}\n\n`)
  }
}
