import { extractId, htmlFetch, isBlockedPage, parseJobDetail, toStandardJob, writeError } from "../helpers.js"

export async function runDetail(input: string, format: "json" | "plain"): Promise<number> {
  try {
    const ref = extractId(input)
    const html = await htmlFetch(ref.url)
    if (isBlockedPage(html)) { writeError("Zhaopin returned a login or verification page", "BLOCKED_PAGE"); return 1 }
    const result = toStandardJob(parseJobDetail(html, ref.url, ref.id))
    if (format === "json") process.stdout.write(JSON.stringify(result, null, 2) + "\n")
    else process.stdout.write([`id: ${result.id}`, `title: ${result.title}`, `company: ${result.company ?? "-"}`, `location: ${result.location ?? "-"}`, `date: ${result.date ?? "-"}`, `salary: ${result.salary ?? "-"}`, `experience: ${result.experience ?? "-"}`, `education: ${result.education ?? "-"}`, `url: ${result.url}`, "", result.description ?? ""].join("\n") + "\n")
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeError(message, /not found/i.test(message) ? "NOT_FOUND" : /parse/i.test(message) ? "PARSE_ERROR" : "DETAIL_FAILED")
    return 1
  }
}
