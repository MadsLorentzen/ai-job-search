import { writeError } from "../helpers.js"

export async function runDetail(_input: string | undefined): Promise<number> {
  writeError("official liepin-cli has no documented read-only job detail command; use the stored URL with /rank WebFetch fallback", "DETAIL_UNAVAILABLE")
  return 1
}
