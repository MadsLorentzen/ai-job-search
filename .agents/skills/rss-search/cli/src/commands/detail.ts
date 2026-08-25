import { fetchText, parseFeed } from "../helpers.js"

export interface DetailOpts {
  target: string
  format: "json" | "plain" | "table"
  feed?: string
}

export async function runDetail(opts: DetailOpts): Promise<void> {
  if (!opts.feed) {
    throw Object.assign(new Error("detail requires --feed <rss-or-atom-url> plus the item URL or id"), { code: "BAD_ARG" })
  }
  const jobs = parseFeed(await fetchText(opts.feed), opts.feed)
  const job = jobs.find((item) => item.url === opts.target || item.id === opts.target)
  if (!job) {
    throw Object.assign(new Error("item not found in that feed"), { code: "NOT_FOUND" })
  }
  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(job) + "\n")
    return
  }
  process.stdout.write(`${job.title}\n${job.url}\n\n${job.description ?? ""}\n`)
}
