import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Reduced structural fixture from the public DMI enterprise-architect page,
// captured 2026-10-21. Prose is synthetic. Its JSON-LD carried an unescaped
// control character, so the real CLI selected the rendered-HTML fallback.
const PAGE = `<!doctype html><html><head>
<script type="application/ld&#x2B;json">{"@type":"JobPosting","description":"bad\tJSON"}</script>
</head><body><div class="job-list-details">
<div class="job-details-head"><h3 class="title">Architect</h3>
<ul><li>Header company</li><li>Header address</li></ul></div>
<div class="job-details-body">Introductory requirements.<br><br>
<strong>Responsibilities</strong><br><ul><li>Build reliable systems.</li></ul>
<strong>Conditions</strong><br>Work 37 hours weekly.<br><br>
<strong>Application</strong><br>Send a CV and application.</div>
</div></body></html>`

for (const format of ["json", "plain"]) {
  test(`detail ${format} keeps the whole rendered job body`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "jobdanmark-body-"))
    try {
      const fixture = join(dir, "page.html")
      const preload = join(dir, "replay.ts")
      await writeFile(fixture, PAGE)
      // No live requests: only the expected detail URL can read the fixture.
      await writeFile(preload, `globalThis.fetch = async (input) => {
        if (String(input) !== "https://jobdanmark.dk/job/architect") throw new Error("Unexpected URL");
        return new Response(await Bun.file(${JSON.stringify(fixture)}).text());
      };`)
      const proc = Bun.spawn([process.execPath, "run", "--preload", preload,
        join(import.meta.dir, "../src/cli.ts"), "detail", "architect", "--format", format],
        { stdout: "pipe", stderr: "pipe" })
      const [stdout, stderr, exit] = await Promise.all([
        new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
      ])
      expect(exit).toBe(0)
      expect(stderr).toBe("")
      const description = format === "json" ? JSON.parse(stdout).description : stdout.split("description: ")[1]
      expect(description.trim()).toBe([
        "Introductory requirements.", "Responsibilities", "Build reliable systems.",
        "Conditions", "Work 37 hours weekly.", "Application", "Send a CV and application.",
      ].join("\n"))
      expect(description).not.toContain("Header company")
      expect(description).not.toContain("Header address")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
