import {
  API_BASE,
  jsonFetch,
  loadRegistry,
  saveRegistry,
  pool,
  writeError,
  type RawLeverPosting,
} from "../helpers.js"

export interface DiscoverOpts {
  candidates: string[]
  concurrency: number
  dryRun: boolean
  format: "json" | "table" | "plain"
}

export interface Probe {
  slug: string
  resolved: boolean
  jobs: number
}

/** Company name -> candidate Lever site slug (lowercased, punctuation stripped). */
export function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "")
}

/**
 * Probe one slug. Lever returns a bare ARRAY; an empty array means a valid site
 * with no open roles, which still counts as resolved — the company shouldn't
 * silently drop out of the registry during a hiring freeze.
 */
export async function probeSlug(slug: string): Promise<Probe> {
  try {
    const response = await jsonFetch<RawLeverPosting[]>(
      `${API_BASE}/${encodeURIComponent(slug)}?mode=json`,
    )
    if (!Array.isArray(response)) return { slug, resolved: false, jobs: 0 }
    return { slug, resolved: true, jobs: response.length }
  } catch {
    return { slug, resolved: false, jobs: 0 }
  }
}

export async function runDiscover(opts: DiscoverOpts): Promise<number> {
  try {
    const slugs = Array.from(new Set(opts.candidates.map(toSlug).filter(Boolean)))
    if (slugs.length === 0) {
      writeError("discover needs at least one company name or slug", "NO_CANDIDATES")
      return 1
    }

    const known = new Set(await loadRegistry("lever"))
    const fresh = slugs.filter((s) => !known.has(s))
    const alreadyKnown = slugs.filter((s) => known.has(s))

    const probes = await pool(fresh, opts.concurrency, probeSlug)
    const resolved = probes.filter((p) => p.resolved)
    const rejected = probes.filter((p) => !p.resolved)

    let registrySize = known.size
    if (!opts.dryRun && resolved.length > 0) {
      registrySize = await saveRegistry(
        "lever",
        resolved.map((p) => p.slug),
      )
    }

    if (opts.format === "json") {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              probed: fresh.length,
              alreadyKnown: alreadyKnown.length,
              resolved: resolved.length,
              rejected: rejected.length,
              registrySize,
              dryRun: opts.dryRun,
            },
            resolved,
            rejected: rejected.map((p) => p.slug),
          },
          null,
          2,
        ) + "\n",
      )
    } else {
      const lines = [
        `probed ${fresh.length} new candidate(s) (${alreadyKnown.length} already in registry)`,
        ...resolved.map((p) => `  + ${p.slug.padEnd(24)} ${p.jobs} job(s)`),
        ...(rejected.length ? [`  - not a Lever site: ${rejected.map((p) => p.slug).join(", ")}`] : []),
        opts.dryRun
          ? "dry run — registry not modified"
          : `registry now holds ${registrySize} Lever site(s)`,
      ]
      process.stdout.write(lines.join("\n") + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DISCOVER_FAILED")
    return 1
  }
}
