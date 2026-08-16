import { writeError } from "../helpers.js"

// Foundit search is not implemented on purpose. The keyword/location search
// JSON API lives under /middleware/ (disallowed by robots.txt) and the HTML
// /search/ pages return HTTP 403 to non-browser clients (Akamai bot
// protection). There is no robots-allowed, bot-accessible search surface, so
// this command always fails with a clear pointer to the detail workflow.
export function runSearch(): number {
  writeError(
    "Foundit search is not supported by this skill: its search API is disallowed by robots.txt (/middleware/) and its /search/ pages are bot-blocked (HTTP 403). " +
      "Find postings via LinkedIn or Google (site:foundit.in) and pass the job URL or id to `detail`, e.g. detail https://www.foundit.in/job/<slug>-<id>",
    "SEARCH_UNSUPPORTED",
  )
  return 1
}
