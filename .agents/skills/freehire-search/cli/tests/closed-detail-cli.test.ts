import { expect, test } from "bun:test"
import { join } from "node:path"

// Reduced wire shape; synthetic posting text. The documented golang-zensar
// example was served with a non-null closed_at on 2026-10-21, while detail
// discarded that authoritative state. Open API responses carry explicit null;
// older/self-hosted responses may omit the field, which is unknown, not open.
const JOB = {
  public_slug: "known-job", source: "example", external_id: "example:1",
  url: "https://example.com/jobs/1", title: "Engineer", company: "Example",
  company_slug: "example", location: "Remote", description: "<p>Build systems.</p>",
  skills: [], regions: [], countries: [], cities: [],
  posted_at: "2026-07-06T00:00:00Z", created_at: "2026-07-06T00:00:00Z", enrichment: {},
}
const CASES = [
  { name: "closed", field: { closed_at: "2026-08-04T01:22:13Z" }, status: "closed (2026-08-04T01:22:13Z)" },
  { name: "open", field: { closed_at: null }, status: "open" },
  { name: "unknown", field: {}, status: "unknown" },
]

for (const c of CASES) {
  for (const format of ["json", "plain"]) {
    test(`detail ${format} preserves ${c.name} availability`, async () => {
      const paths: string[] = []
      const server = Bun.serve({
        hostname: "127.0.0.1", port: 0,
        fetch(request) {
          paths.push(new URL(request.url).pathname)
          return Response.json({ data: { ...JOB, ...c.field } })
        },
      })
      try {
        const proc = Bun.spawn([process.execPath, "run", join(import.meta.dir, "../src/cli.ts"),
          "detail", "known-job", "--format", format], {
          env: { ...process.env, FREEHIRE_API_URL: `http://127.0.0.1:${server.port}` },
          stdout: "pipe", stderr: "pipe",
        })
        const [stdout, stderr, exit] = await Promise.all([
          new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
        ])
        expect(exit).toBe(0)
        expect(stderr).toBe("")
        expect(paths).toEqual(["/api/v1/jobs/known-job"])
        if (format === "json") {
          const result = JSON.parse(stdout)
          expect(Object.hasOwn(result, "closed_at")).toBe(c.name !== "unknown")
          if (c.name !== "unknown") expect(result.closed_at).toBe(c.field.closed_at)
          expect(result.description).toBe("Build systems.")
        } else {
          expect(stdout).toContain(`Status: ${c.status}\n`)
          expect(stdout).toContain("Build systems.")
        }
      } finally {
        server.stop(true)
      }
    })
  }
}
