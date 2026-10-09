import { describe, expect, test } from "bun:test"
import { classifyUpstreamError, formatResults, mapSearchArgs, normalizeRecord, parseUpstreamOutput, parseUpstreamResponse, redactSensitive } from "../src/helpers.js"
import { invokeOfficialCli } from "../src/commands/search.js"

describe("liepin read-only adapter", () => {
  test("maps official search JSON into the standard job contract", () => {
    const jobs = parseUpstreamOutput(JSON.stringify({ data: [{ jobId: 42, jobName: "Python开发", companyName: "示例科技", address: "北京", publishTime: "今天", detailUrl: "https://www.liepin.com/job/42", salary: "15-25K", workExperience: "经验不限", eduLevel: "本科" }] }))
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ id: "42", title: "Python开发", company: "示例科技", portal: "liepin-search", access_mode: "official_cli", salary_min: 15000, salary_max: 25000, experience: "不限", education: "本科" })
  })

  test("drops records without required identity fields", () => {
    expect(normalizeRecord({ jobId: 1, jobName: "缺 URL" })).toBeNull()
    expect(normalizeRecord({ jobId: 1, jobName: "非法 URL", jobUrl: "javascript:alert(1)" })).toBeNull()
    expect(parseUpstreamOutput(JSON.stringify({ jobs: [{ id: "1", title: "ok", url: "https://example.com/1" }, { id: "2", title: "bad" }] }))).toHaveLength(1)
  })

  test("distinguishes a valid empty response from parser degradation", () => {
    expect(parseUpstreamResponse('{"jobs":[]}')).toEqual({ records: 0, results: [] })
    expect(parseUpstreamResponse('{"unexpected":"shape"}')).toEqual({ records: 1, results: [] })
  })

  test("maps one-based page to official zero-based CLI page", () => {
    expect(mapSearchArgs({ query: "后端", city: "上海", page: 2, format: "json" })).toEqual(["job", "search", "--job-name", "后端", "--page", "1", "--output", "json", "--address", "上海"])
  })

  test("keeps machine output and table output contract", () => {
    const job = normalizeRecord({ id: "1", title: "后端", url: "https://example.com/1" })!
    expect(JSON.parse(formatResults([job], 1, "json")).meta.count).toBe(1)
    expect(formatResults([job], 1, "table")).toContain("ID | 职位")
  })

  test("classifies auth failures and redacts credentials", () => {
    process.env.LIEPIN_USER_TOKEN = "secret-token-value"
    expect(classifyUpstreamError("缺少 x-user-token")).toBe("AUTH_REQUIRED")
    expect(classifyUpstreamError("HTTP 403 token expired")).toBe("AUTH_EXPIRED")
    expect(redactSensitive("x-user-token=secret-token-value Bearer abc")).toBe("x-user-token=[REDACTED] Bearer [REDACTED]")
    delete process.env.LIEPIN_USER_TOKEN
  })

  test("official process launcher remains an explicit search-only boundary", () => {
    const source = invokeOfficialCli.toString()
    expect(source).toContain('spawn("liepin-cli"')
    expect(source).toContain('PYTHONUTF8: "1"')
    expect(source).not.toContain("job apply")
    expect(source).not.toContain("resume")
  })
})
