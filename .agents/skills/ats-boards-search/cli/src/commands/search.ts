import { readFileSync } from "fs"
import {
  boardUrls,
  jsonFetch,
  matchesLocation,
  matchesQuery,
  parseBoard,
  parseBoardsFile,
  parseAshbyJobs,
  parseGreenhouseJobs,
  parseLeverJobs,
  withinJobAge,
  type BoardRef,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage?: number
  limit?: number
  page?: number
  boards: string[]
  boardsFile?: string
  format: "json" | "table" | "plain"
}

async function loadBoard(board: BoardRef): Promise<JobResult[]> {
  const urls = boardUrls(board)
  let company: string | null = board.token
  if (urls.company) {
    const meta = (await jsonFetch(urls.company)) as { name?: string } | null
    if (meta?.name) company = meta.name
  }
  const payload = await jsonFetch(urls.list)
  if (payload == null) return []
  if (board.kind === "greenhouse") return parseGreenhouseJobs(payload, company)
  if (board.kind === "lever") return parseLeverJobs(payload, company)
  return parseAshbyJobs(payload, company)
}

export async function runSearch(opts: SearchOpts): Promise<void> {
  const refs: BoardRef[] = []
  for (const raw of opts.boards) refs.push(parseBoard(raw))
  if (opts.boardsFile) {
    const text = readFileSync(opts.boardsFile, "utf8")
    refs.push(...parseBoardsFile(text))
  }
  if (refs.length === 0) {
    throw Object.assign(new Error("pass --board kind:token or --boards-file <path>"), { code: "BAD_ARG" })
  }

  const seen = new Set<string>()
  let results: JobResult[] = []
  for (const board of refs) {
    const jobs = await loadBoard(board)
    for (const job of jobs) {
      const bare = job.id.replace(/^(greenhouse|lever|ashby):/, "")
      job.id = `${board.kind}:${board.token}:${bare}`
      if (seen.has(job.id)) continue
      seen.add(job.id)
      results.push(job)
    }
  }

  results = results.filter(
    (job) =>
      matchesQuery(job, opts.query) &&
      matchesLocation(job, opts.location) &&
      withinJobAge(job, opts.jobage),
  )

  const page = opts.page && opts.page > 0 ? opts.page : 1
  const pageSize = opts.limit && opts.limit > 0 ? opts.limit : 20
  const start = (page - 1) * pageSize
  const sliced = results.slice(start, start + pageSize)

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify({ meta: { count: sliced.length, page, total: results.length }, results: sliced }) + "\n")
    return
  }
  if (opts.format === "table") {
    process.stdout.write(`#\tid\ttitle\tcompany\tlocation\tdate\turl\n`)
    sliced.forEach((job, i) => {
      process.stdout.write(`${i + 1}\t${job.id}\t${job.title}\t${job.company ?? ""}\t${job.location ?? ""}\t${job.date ?? ""}\t${job.url}\n`)
    })
    return
  }
  for (const job of sliced) {
    process.stdout.write(`${job.title} — ${job.company ?? "?"} (${job.location ?? "?"})\n${job.url}\n\n`)
  }
}
