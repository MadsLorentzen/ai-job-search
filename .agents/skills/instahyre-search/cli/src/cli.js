#!/usr/bin/env node
// Instahyre.com job search CLI — India's premium tech job portal
// Personal use only.

const args = process.argv.slice(2);

function parseFlags(argv) {
  const flags = { _: [] };
  const alias = { q: "query", l: "location", n: "limit" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--") || (a.startsWith("-") && a.length === 2)) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "");
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      flags._.push(a);
    }
  }
  return flags;
}

function formatTable(jobs) {
  if (!jobs.length) return "No results found.";
  const rows = jobs.map((j, i) => [
    String(i + 1),
    (j.title || "").slice(0, 45),
    (j.company || "").slice(0, 30),
    (j.location || "").slice(0, 20),
    (j.url || "").slice(0, 50),
  ]);
  const headers = ["#", "Title", "Company", "Location", "URL"];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = widths.map((w) => "-".repeat(w)).join("-+-");
  const fmt = (row) => row.map((c, i) => c.padEnd(widths[i])).join(" | ");
  return [fmt(headers), line, ...rows.map(fmt)].join("\n");
}

async function search(opts) {
  const { query, location, limit = 20, format = "json" } = opts;

  if (!query) {
    process.stderr.write(JSON.stringify({ error: "--query/-q is required", code: "NO_QUERY" }) + "\n");
    process.exit(1);
  }

  const searchUrl = `https://www.instahyre.com/candidate/explore/?designation=${encodeURIComponent(query)}${location ? `&location=${encodeURIComponent(location)}` : ""}`;
  const apiUrl = `https://www.instahyre.com/api/v1/opportunity/?designation=${encodeURIComponent(query)}${location ? `&location=${encodeURIComponent(location)}` : ""}&limit=${Math.min(limit, 50)}&offset=0`;

  let data;
  try {
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://www.instahyre.com/candidate/explore/",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} — visit directly: ${searchUrl}`);
    data = await res.json();
  } catch (e) {
    const fallback = [{ id: "0", title: `Search: "${query}"`, company: "Instahyre", location: location || "India", url: searchUrl, note: "Visit URL directly" }];
    if (format === "table") {
      process.stdout.write(`Instahyre direct search URL:\n${searchUrl}\n\nNote: ${e.message}\n`);
    } else {
      process.stdout.write(JSON.stringify({ meta: { count: 1, query, location, note: e.message }, results: fallback }, null, 2) + "\n");
    }
    process.exit(0);
  }

  const rawJobs = data?.results || data?.objects || [];
  const jobs = rawJobs.slice(0, limit).map((j) => ({
    id: String(j.id || j.opportunity_id || ""),
    title: j.designation || j.title || "",
    company: j.employer?.name || j.company_name || "",
    location: Array.isArray(j.locations) ? j.locations.join(", ") : j.location || "",
    experience: j.min_experience != null ? `${j.min_experience}-${j.max_experience || "+"} yrs` : "",
    salary: j.min_salary ? `${j.min_salary}-${j.max_salary || "?"} LPA` : "",
    skills: Array.isArray(j.skills) ? j.skills.map((s) => s.name || s).join(", ") : "",
    url: j.id ? `https://www.instahyre.com/job-${j.id}/` : "",
  }));

  if (format === "table") {
    process.stdout.write(formatTable(jobs) + "\n");
  } else {
    process.stdout.write(JSON.stringify({ meta: { count: jobs.length, query, location }, results: jobs }, null, 2) + "\n");
  }
}

const flags = parseFlags(args);
const cmd = flags._[0];

if (!cmd || cmd === "help" || flags.help) {
  process.stdout.write(`instahyre-search — search tech jobs on Instahyre.com (India)

USAGE
  node src/cli.js search -q "<keywords>" [flags]

FLAGS
  --query, -q <text>    Job title or keywords (required)
  --location, -l <text> City e.g. "Noida", "Bangalore", "Remote"
  --limit, -n <n>       Max results (default 20)
  --format json|table   Output format (default json)

EXAMPLES
  node src/cli.js search -q "software engineer" -l "Noida" --format table
  node src/cli.js search -q "machine learning" --format table
  node src/cli.js search -q "full stack" -l "Remote" --format table
`);
  process.exit(cmd ? 0 : 1);
}

if (cmd === "search") {
  search({
    query: flags.query,
    location: flags.location,
    limit: flags.limit ? parseInt(flags.limit) : 20,
    format: flags.format || "json",
  });
} else {
  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n");
  process.exit(1);
}
