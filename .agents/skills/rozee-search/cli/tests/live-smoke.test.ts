import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers.js"

if (process.env.ROZEE_LIVE_TEST === "1") {
describe("live Rozee smoke test (low-volume personal use)", () => {
  test("searches a role in Islamabad and reads one returned detail page", async () => {
    const search = await runCLI([
      "search",
      "--query",
      "Machine Learning Intern",
      "--location",
      "Islamabad",
      "--limit",
      "3",
    ])
    expect(search.exitCode).toBe(0)
    const payload = JSON.parse(search.stdout) as {
      results: Array<{ id: string; title: string; url: string }>
    }
    expect(payload.results.length).toBeGreaterThan(0)
    const first = payload.results[0]
    expect(first.id).toBeTruthy()
    expect(first.title).toBeTruthy()
    expect(first.url).toMatch(/^https:\/\/www\.rozee\.pk\//)

    const detail = await runCLI(["detail", first.url, "--format", "plain"])
    expect(detail.exitCode).toBe(0)
    expect(detail.stdout).toContain(first.title)
    expect(detail.stdout).toContain("URL: https://www.rozee.pk/")
  }, 60000)
})
}
