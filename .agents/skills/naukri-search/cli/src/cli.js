#!/usr/bin/env node
// Naukri.com job search CLI
// Uses Naukri's public job search endpoint. Personal use only.

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
    j.experience || "",
    (j.url || "").slice(0, 50),
  ]);
  const headers = ["#", "Title", "Company", "Location", "Exp", "URL"];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = widths.map((w) => "-".repeat(w)).join("-+-");
  const fmt = (row) => row.map((c, i) => c.padEnd(widths[i])).join(" | ");
  return [fmt(headers), line, ...rows.map(fmt)].join("\n");
}

async function search(opts) {
  const { query, location, experience, limit = 20, format = "json" } = opts;

  if (!query) {
    process.stderr.write(JSON.stringify({ error: "--query/-q is required", code: "NO_QUERY" }) + "\n");
    process.exit(1);
  }

  // Naukri public search API
  // Build Naukri search URL (public search page)
  const keywordSlug = query.toLowerCase().replace(/\s+/g, "-");
  const locationSlug = location ? location.toLowerCase().replace(/\s+/g, "-") : "india";
  const expParam = experience ? `&experience=${experience}` : "";
  const searchUrl = `https://www.naukri.com/${keywordSlug}-jobs-in-${locationSlug}?k=${encodeURIComponent(query)}&l=${encodeURIComponent(location || "India")}${expParam}`;

  // Use Naukri's internal API with correct headers
  const apiUrl = `https://www.naukri.com/jobapi/v3/search?noOfResults=${Math.min(limit, 50)}&urlType=search_by_keyword&searchType=adv&keyword=${encodeURIComponent(query)}&location=${encodeURIComponent(location || "")}&experience=${experience || ""}&k=${encodeURIComponent(query)}&l=${encodeURIComponent(location || "")}`;

  let data;
  try {
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "appid": "109",
        "systemid": "Naukri",
        "Referer": "https://www.naukri.com/",
        "Origin": "https://www.naukri.com",
        "gid": "LOCATION,INDUSTRY,EDUCATION,FAREA_ROLE",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} — Naukri may be blocking automated access. Visit directly: ${searchUrl}`);
    data = await res.json();
  } catch (e) {
    // Graceful fallback: return the search URL so the agent can open it
    const fallback = [{ id: "0", title: `Search: "${query}"`, company: "Naukri", location: location || "India", experience: "", salary: "", date: "", url: searchUrl, note: "Visit URL directly — Naukri blocked automated access" }];
    if (format === "table") {
      process.stdout.write(`Naukri direct search URL:\n${searchUrl}\n\nNote: ${e.message}\n`);
    } else {
      process.stdout.write(JSON.stringify({ meta: { count: 1, query, location, note: e.message }, results: fallback }, null, 2) + "\n");
    }
    process.exit(0);
  }

  const rawJobs = data?.jobDetails || data?.jobs || [];
  const jobs = rawJobs.slice(0, limit).map((j) => ({
    id: j.jobId || j.id || "",
    title: j.title || j.jobTitle || "",
    company: j.companyName || j.company || "",
    location: Array.isArray(j.placeholders)
      ? j.placeholders.find((p) => p.type === "location")?.label || location || ""
      : j.location || location || "",
    experience: Array.isArray(j.placeholders)
      ? j.placeholders.find((p) => p.type === "experience")?.label || ""
      : j.experience || "",
    salary: Array.isArray(j.placeholders)
      ? j.placeholders.find((p) => p.type === "salary")?.label || ""
      : j.salary || "",
    date: j.footerPlaceholderLabel || j.createdDate || "",
    url: j.jdURL ? `https://www.naukri.com${j.jdURL}` : searchUrl,
    description: (j.jobDescription || "").slice(0, 200),
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
  process.stdout.write(`naukri-search — search jobs on Naukri.com (India)

USAGE
  node src/cli.js search -q "<keywords>" [flags]

FLAGS
  --query, -q <text>       Job title or keywords (required)
  --location, -l <text>    City or region e.g. "Noida", "Delhi NCR", "Remote"
  --experience <years>     Years of experience e.g. "2"
  --limit, -n <n>          Max results (default 20)
  --format json|table      Output format (default json)

EXAMPLES
  node src/cli.js search -q "software engineer" -l "Noida" --format table
  node src/cli.js search -q "AI engineer" -l "Delhi NCR" --experience 2 --format table
  node src/cli.js search -q "full stack developer" -l "Remote" --format table
`);
  process.exit(cmd ? 0 : 1);
}

if (cmd === "search") {
  search({
    query: flags.query,
    location: flags.location,
    experience: flags.experience,
    limit: flags.limit ? parseInt(flags.limit) : 20,
    format: flags.format || "json",
  });
} else {
  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n");
  process.exit(1);
}
