/**
 * Decide whether the browser-header curl retry in 09-web-research.md may run.
 *
 * Port of tools/robots_check.py. The retry exists to get past bot-filtering
 * firewalls on sites whose robots.txt permits access. It is never used to
 * override a site that has said no.
 *
 * Rules implemented (RFC 9309), deliberately on the cautious side:
 *  * longest-match wins; on equal specificity Disallow wins
 *  * a Disallow for either "*" or "Claude-User" blocks the retry
 *  * blank lines inside a record do not end it
 *  * 404 means no published policy, which is permission
 *  * any other failure to read robots.txt leaves permission unconfirmed,
 *    and the retry does not happen
 *
 * Exit 0 = the retry may proceed. Exit 1 = do not retry; go to escalation step 3.
 */
import { spawnSync } from "node:child_process";

export const BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

export type Fetcher = (url: string, ua: string) => [string, number];

/** curl, not fetch(): some hosts (jobup.ch) hang HTTP clients indefinitely
 * while answering curl in under a second, and --max-time is a hard ceiling. */
export function fetchRobots(url: string, ua: string): [string, number] {
  // "--" terminates option parsing, so a URL beginning with a dash can never
  // be read by curl as a flag. gate() rebuilds the target as
  // scheme://host/robots.txt before calling here, so this is hardening for
  // direct callers rather than a hole in the gate path itself.
  const r = spawnSync(
    "curl",
    [
      "-sS",
      "-L",
      "--max-redirs",
      "5",
      "--max-time",
      "12",
      "-A",
      ua,
      "-H",
      "Accept: text/plain,*/*",
      "-w",
      "\n%{http_code}",
      "--",
      url,
    ],
    { encoding: "utf8", timeout: 20_000 },
  );
  if (r.error || r.status === null || r.status !== 0) {
    throw new Error(`curl exit ${r.status ?? r.error}`);
  }
  const out = r.stdout ?? "";
  const idx = out.lastIndexOf("\n");
  const body = out.slice(0, idx);
  const code = Number.parseInt(out.slice(idx + 1), 10) || 0;
  return [body, code];
}

/** Does this actually look like a robots.txt?
 *
 * A misconfigured host can answer /robots.txt with 200 and an HTML error page.
 * That body parses to zero rules, and zero rules read as "allowed" - so a
 * soft-200 granted permission that was never given. An empty or whitespace-only
 * body IS a valid allow-all under RFC 9309 and stays allowed; a non-empty body
 * with no recognised directive is treated as unreadable. */
export function isRobotsBody(text: string): boolean {
  if (!text.trim()) return true;
  const fields = new Set([
    "user-agent",
    "allow",
    "disallow",
    "sitemap",
    "crawl-delay",
    "host",
  ]);
  for (const raw of text.split("\n")) {
    const line = raw.split("#", 1)[0]!.trim().toLowerCase();
    const idx = line.indexOf(":");
    if (idx !== -1 && fields.has(line.slice(0, idx).trim())) return true;
  }
  return false;
}

/** user-agent -> [(isAllow, pattern)], tolerating blank lines inside a record. */
export function groups(text: string): Map<string, [boolean, string][]> {
  const out = new Map<string, [boolean, string][]>();
  let agents: string[] = [];
  let expect = true;
  for (const raw of text.split("\n")) {
    const line = raw.split("#", 1)[0]!.trim();
    if (!line || !line.includes(":")) continue;
    const idx = line.indexOf(":");
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!expect) agents = [];
      expect = true;
      agents.push(value.toLowerCase());
      if (!out.has(value.toLowerCase())) out.set(value.toLowerCase(), []);
    } else if ((field === "allow" || field === "disallow") && agents.length) {
      expect = false;
      for (const a of agents) {
        out.get(a)!.push([field === "allow", value]);
      }
    }
  }
  return out;
}

const escape = (c: string): string => (c === "*" ? ".*" : c === "$" ? "$" : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

/** RFC 9309 wildcard match; returns match length or -1.
 *
 * The pattern is percent-decoded to match the already-decoded path. Without
 * this, "Disallow: /foo%20bar" never matched "/foo bar" and the rule was
 * silently skipped - a fail-open on any site that encodes its own rules. */
export function match(pattern: string, path: string): number {
  if (pattern === "") return -1;
  pattern = decodeURIComponent(pattern);
  const rx = new RegExp("^" + [...pattern].map(escape).join(""));
  return rx.test(path) ? pattern.length : -1;
}

export function allowed(text: string, agent: string, path: string): boolean {
  const g = groups(text);
  const rules = g.get(agent.toLowerCase()) ?? g.get("*") ?? [];
  let bestLen = -1;
  let bestAllow = true;
  for (const [isAllow, pat] of rules) {
    const n = match(pat, path);
    if (n > bestLen || (n === bestLen && n >= 0 && !isAllow)) {
      bestLen = n;
      bestAllow = isAllow; // ties -> Disallow wins (cautious)
    }
  }
  return bestLen < 0 ? true : bestAllow;
}

/** urlsplit equivalent: never throws, so a garbage URL degrades to an
 * unfetchable robots target instead of an unhandled exception. */
export function splitUrl(url: string): { scheme: string; netloc: string; path: string; query: string } {
  try {
    const u = new URL(url);
    return {
      scheme: u.protocol.replace(/:$/, ""),
      netloc: u.host,
      path: u.pathname,
      query: u.search.replace(/^\?/, ""),
    };
  } catch {
    return { scheme: "", netloc: "", path: url, query: "" };
  }
}

export function gate(url: string, fetchImpl: Fetcher = fetchRobots): [number, string] {
  const parts = splitUrl(url);
  let path = decodeURIComponent(parts.path) || "/";
  if (parts.query) path += "?" + parts.query;
  const robots = `${parts.scheme}://${parts.netloc}/robots.txt`;
  let body: string | null = null;
  let last = "no attempt";
  for (const ua of ["Claude-User", BROWSER]) {
    let result: [string, number];
    try {
      result = fetchImpl(robots, ua);
    } catch (e) {
      last = e instanceof Error ? e.constructor.name : String(e);
      continue;
    }
    const [text, code] = result;
    if (code === 404) return [0, "ALLOWED - no robots.txt published"];
    if (code === 200) {
      if (!isRobotsBody(text)) {
        last = "HTTP 200 but the body is not a robots.txt";
        continue;
      }
      body = text;
      break;
    }
    last = `HTTP ${code}`;
  }
  if (body === null) {
    return [1, `UNCONFIRMED (${last}) - do not retry, go to step 3`];
  }
  for (const a of ["Claude-User", "*"]) {
    if (!allowed(body, a, path)) {
      return [1, `DISALLOWED for ${a} - do not retry, go to step 3`];
    }
  }
  return [0, "ALLOWED - robots.txt permits this path"];
}

export function robotsCheckMain(argv: string[]): number {
  if (argv.length !== 1) {
    process.stderr.write("usage: bun run packages/tools/src/cli.ts robots-check <url>\n");
    return 2;
  }
  const [rc, msg] = gate(argv[0]!);
  console.log(msg);
  return rc;
}
