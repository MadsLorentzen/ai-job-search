#!/usr/bin/env node
// Wellfound.com (AngelList Talent) job search CLI
// Uses Wellfound's public job search. Personal use only.

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
    (j.salary || "").slice(0, 15),
    (j.url || "").slice(0, 45),
  ]);
  const headers = ["#", "Title", "Company", "Location", "Salary", "URL"];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = widths.map((w) => "-".repeat(w)).join("-+-");
  const fmt = (row) => row.map((c, i) => c.padEnd(widths[i])).join(" | ");
  return [fmt(headers), line, ...rows.map(fmt)].join("\n");
}

async function search(opts) {
  const { query, location, remote, limit = 20, format = "json" } = opts;

  if (!query) {
    process.stderr.write(JSON.stringify({ error: "--query/-q is required", code: "NO_QUERY" }) + "\n");
    process.exit(1);
  }

  // Wellfound public job search page scrape via their search endpoint
  const searchQuery = [query, location].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    q: searchQuery,
    ...(remote ? { remote: "true" } : {}),
  });

  const url = `https://wellfound.com/jobs?${params}`;

  let html;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    const fallback = [{ id: "0", title: `Search: "${query}"`, company: "Wellfound", location: location || "India", salary: "", url, note: "Visit URL directly — Wellfound blocked automated access" }];
    if (format === "table") {
      process.stdout.write(`Wellfound direct search URL:\n${url}\n\nNote: ${e.message} — visit the URL directly in your browser.\n`);
    } else {
      process.stdout.write(JSON.stringify({ meta: { count: 1, query, location, searchUrl: url, note: e.message }, results: fallback }, null, 2) + "\n");
    }
    process.exit(0);
  }

  // Extract job data from Next.js __NEXT_DATA__ JSON embedded in page
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  let jobs = [];

  if (match) {
    try {
      const nextData = JSON.parse(match[1]);
      // Navigate the Next.js data structure to find job listings
      const pageProps = nextData?.props?.pageProps;
      const jobListings =
        pageProps?.jobListings ||
        pageProps?.jobs ||
        pageProps?.searchResults?.jobListings ||
        [];

      jobs = jobListings.slice(0, limit).map((j) => ({
        id: String(j.id || j.slug || ""),
        title: j.title || j.jobTitle || "",
        company: j.startup?.name || j.company?.name || j.companyName || "",
        location: Array.isArray(j.locationNames)
          ? j.locationNames.join(", ")
          : j.location || (remote ? "Remote" : ""),
        salary: j.compensation || j.salary || "",
        equity: j.equity || "",
        remote: j.remote || false,
        url: j.slug
          ? `https://wellfound.com/jobs/${j.slug}`
          : j.id
          ? `https://wellfound.com/l/2xXXXX/${j.id}`
          : url,
        description: (j.description || "").slice(0, 200),
      }));
    } catch (_) {
      // fallback: return a helpful message
    }
  }

  // If Next.js extraction failed, try regex-based extraction
  if (!jobs.length) {
    const titleMatches = [...html.matchAll(/"title":"([^"]+)"/g)].slice(0, limit);
    const companyMatches = [...html.matchAll(/"companyName":"([^"]+)"/g)].slice(0, limit);
    jobs = titleMatches.map((m, i) => ({
      id: String(i),
      title: m[1] || "",
      company: companyMatches[i]?.[1] || "",
      location: location || (remote ? "Remote" : "India"),
      salary: "",
      url: url,
    }));
  }

  if (!jobs.length) {
    // Return a helpful fallback with the search URL
    jobs = [{
      id: "0",
      title: `Search: "${query}"`,
      company: "Wellfound",
      location: location || "India",
      salary: "",
      url: url,
      note: "Visit URL directly — Wellfound may require JS rendering for full results",
    }];
  }

  if (format === "table") {
    process.stdout.write(formatTable(jobs) + "\n");
    process.stdout.write(`\nSearch URL: ${url}\n`);
  } else {
    process.stdout.write(
      JSON.stringify({ meta: { count: jobs.length, query, location, searchUrl: url }, results: jobs }, null, 2) + "\n"
    );
  }
}

const flags = parseFlags(args);
const cmd = flags._[0];

if (!cmd || cmd === "help" || flags.help) {
  process.stdout.write(`wellfound-search — search startup jobs on Wellfound.com

USAGE
  node src/cli.js search -q "<keywords>" [flags]

FLAGS
  --query, -q <text>    Job title or keywords (required)
  --location, -l <text> Location e.g. "India", "Remote", "Bangalore"
  --remote              Filter remote jobs only
  --limit, -n <n>       Max results (default 20)
  --format json|table   Output format (default json)

EXAMPLES
  node src/cli.js search -q "software engineer" -l "India" --format table
  node src/cli.js search -q "AI engineer" --remote --format table
  node src/cli.js search -q "full stack" -l "Remote" --format table
`);
  process.exit(cmd ? 0 : 1);
}

if (cmd === "search") {
  search({
    query: flags.query,
    location: flags.location,
    remote: !!flags.remote,
    limit: flags.limit ? parseInt(flags.limit) : 20,
    format: flags.format || "json",
  });
} else {
  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n");
  process.exit(1);
}
