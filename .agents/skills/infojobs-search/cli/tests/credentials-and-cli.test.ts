import { afterEach, describe, expect, test } from "bun:test"
import { CliError, apiFetch, authHeader } from "../src/helpers"
import { buildParams, runSearch } from "../src/commands/search"
import { normalizeId } from "../src/commands/detail"
import { runCLI } from "./helpers"

const originalFetch = globalThis.fetch
const originalStdoutWrite = process.stdout.write
const originalStderrWrite = process.stderr.write
const originalToken = process.env.INFOJOBS_API_TOKEN
afterEach(() => {
  globalThis.fetch = originalFetch
  process.stdout.write = originalStdoutWrite
  process.stderr.write = originalStderrWrite
  if (originalToken === undefined) delete process.env.INFOJOBS_API_TOKEN
  else process.env.INFOJOBS_API_TOKEN = originalToken
})

function capture(): { out: () => string; err: () => string } {
  let out = ""
  let err = ""
  process.stdout.write = ((c: string | Uint8Array) => ((out += c.toString()), true)) as typeof process.stdout.write
  process.stderr.write = ((c: string | Uint8Array) => ((err += c.toString()), true)) as typeof process.stderr.write
  return { out: () => out, err: () => err }
}

function stderrJSON(stderr: string): { error: string; code: string } {
  return JSON.parse(stderr)
}

const SECRET = "my-client-id:SuperSecretValue123"

describe("authHeader", () => {
  test("builds HTTP Basic auth from client_id:client_secret", () => {
    expect(authHeader({ INFOJOBS_API_TOKEN: "abc:def" })).toBe("Basic " + btoa("abc:def"))
  })

  test("a missing or blank variable is MISSING_CREDENTIALS and names the variable", () => {
    for (const env of [{}, { INFOJOBS_API_TOKEN: "" }, { INFOJOBS_API_TOKEN: "   " }]) {
      const err = (() => {
        try {
          authHeader(env)
        } catch (e) {
          return e as CliError
        }
      })()
      expect(err?.code).toBe("MISSING_CREDENTIALS")
      expect(err?.message).toContain("INFOJOBS_API_TOKEN")
    }
  })

  // Each value carries a marker that appears nowhere in the static error text.
  test.each(["nocolonZQ1", "a:b:cZQ2", "a: bZQ3", ":secretZQ4", "ZQ5idonly:"])("%p is BAD_CREDENTIALS_FORMAT and the value is not echoed", (bad) => {
    let err: CliError | undefined
    try {
      authHeader({ INFOJOBS_API_TOKEN: bad })
    } catch (e) {
      err = e as CliError
    }
    expect(err?.code).toBe("BAD_CREDENTIALS_FORMAT")
    expect(err?.message).not.toContain(bad)
  })
})

describe("apiFetch", () => {
  test("sends the Authorization header and an AbortSignal timeout", async () => {
    process.env.INFOJOBS_API_TOKEN = SECRET
    let init: RequestInit | undefined
    let url = ""
    globalThis.fetch = (async (u: string | URL | Request, i?: RequestInit) => {
      url = String(u)
      init = i
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch
    await apiFetch("/api/9/offer", new URLSearchParams({ q: "x" }))
    expect(url).toBe("https://api.infojobs.net/api/9/offer?q=x")
    expect((init?.headers as Record<string, string>).Authorization).toBe("Basic " + btoa(SECRET))
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  test("makes no request at all when the token is missing", async () => {
    delete process.env.INFOJOBS_API_TOKEN
    let calls = 0
    globalThis.fetch = (async () => (calls++, new Response("{}"))) as unknown as typeof fetch
    const err = await apiFetch("/api/9/offer").catch((e) => e)
    expect(err).toBeInstanceOf(CliError)
    expect(calls).toBe(0)
  })

  test("a 401 is INVALID_CREDENTIALS, is not retried, and never contains the secret", async () => {
    process.env.INFOJOBS_API_TOKEN = SECRET
    let calls = 0
    globalThis.fetch = (async () => (calls++, new Response('{"error":"102"}', { status: 401 }))) as unknown as typeof fetch
    const err = (await apiFetch("/api/9/offer").catch((e) => e)) as CliError
    expect(err.code).toBe("INVALID_CREDENTIALS")
    expect(calls).toBe(1)
    expect(err.message).not.toContain("SuperSecretValue123")
    expect(err.message).not.toContain(btoa(SECRET))
  })

  test("a 404 resolves to null", async () => {
    process.env.INFOJOBS_API_TOKEN = SECRET
    globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch
    expect(await apiFetch("/api/7/offer/abc")).toBeNull()
  })

  test("a non-JSON body is PARSE_FAILED", async () => {
    process.env.INFOJOBS_API_TOKEN = SECRET
    globalThis.fetch = (async () => new Response("<html>")) as unknown as typeof fetch
    const err = (await apiFetch("/api/9/offer").catch((e) => e)) as CliError
    expect(err.code).toBe("PARSE_FAILED")
  })
})

describe("buildParams", () => {
  const base = { jobage: 9999, page: 1, format: "json" as const }

  test("maps query, province key, freshness and page size", () => {
    const p = buildParams({ ...base, query: "ingeniero industrial", location: "Ciudad Real", jobage: 7 })
    expect(p.get("q")).toBe("ingeniero industrial")
    expect(p.get("province")).toBe("ciudad-real")
    expect(p.get("sinceDate")).toBe("_7_DAYS")
    expect(p.get("maxResults")).toBe("20")
    expect(p.has("page")).toBe(false)
  })

  test("page and limit are passed through, with limit capped at 50", () => {
    const p = buildParams({ ...base, query: "x", page: 3, limit: 500, city: "Illescas" })
    expect(p.get("page")).toBe("3")
    expect(p.get("maxResults")).toBe("50")
    expect(p.get("city")).toBe("Illescas")
  })
})

describe("runSearch", () => {
  test("emits the JSON envelope with total and pages", async () => {
    process.env.INFOJOBS_API_TOKEN = SECRET
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ offers: [{ id: "a1", title: "Operario" }], totalResults: 9, totalPages: 1 }))) as unknown as typeof fetch
    const io = capture()
    expect(await runSearch({ query: "x", jobage: 9999, page: 1, format: "json" })).toBe(0)
    const parsed = JSON.parse(io.out())
    expect(parsed.meta).toEqual({ count: 1, page: 1, total: 9, pages: 1 })
  })

  test("missing credentials exit 1 on stderr with nothing on stdout", async () => {
    delete process.env.INFOJOBS_API_TOKEN
    const io = capture()
    expect(await runSearch({ query: "x", jobage: 9999, page: 1, format: "json" })).toBe(1)
    expect(JSON.parse(io.err()).code).toBe("MISSING_CREDENTIALS")
    expect(io.out()).toBe("")
  })
})

describe("normalizeId", () => {
  const ID = "eb371a01c14f97838d790d19d606ce"
  test.each([
    [ID, ID],
    [ID.toUpperCase(), ID],
    [`https://www.infojobs.net/toledo/ingeniero/of-i${ID}`, ID],
    [`infojobs.net/x/y/of-i${ID}/`, ID],
  ])("accepts %s", (input, expected) => {
    expect(normalizeId(input)).toBe(expected)
  })

  test.each([
    `https://evil.com/x/of-i${ID}`,
    `https://infojobs.net.evil.io/x/of-i${ID}`,
    `https://infojobs.net@evil.io/x/of-i${ID}`,
    "https://www.infojobs.net/ofertas-trabajo",
    "abc",
    "",
  ])("rejects %s", (input) => {
    expect(normalizeId(input)).toBeNull()
  })
})

describe("the real CLI (no network: every case fails before a request)", () => {
  test("search without a token exits 1 with MISSING_CREDENTIALS", async () => {
    const r = await runCLI(["search", "-q", "ingeniero"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("MISSING_CREDENTIALS")
    expect(r.stdout).toBe("")
  })

  test("detail without a token exits 1 with MISSING_CREDENTIALS", async () => {
    const r = await runCLI(["detail", "eb371a01c14f97838d790d19d606ce"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("MISSING_CREDENTIALS")
  })

  test("a malformed token exits 1 with BAD_CREDENTIALS_FORMAT and never prints it", async () => {
    const r = await runCLI(["search", "-q", "x"], { INFOJOBS_API_TOKEN: "notvalid" })
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_CREDENTIALS_FORMAT")
    expect(r.stderr).not.toContain("notvalid")
  })

  test.each(["--token", "--api-token", "--client-secret"])("%s is rejected as an unknown flag, so a secret cannot ride a flag", async (flag) => {
    const r = await runCLI(["search", "-q", "x", flag, "abc:def"])
    expect(r.exitCode).toBe(1)
    const err = stderrJSON(r.stderr)
    expect(err.code).toBe("UNKNOWN_FLAG")
    expect(r.stderr).not.toContain("abc:def")
  })

  test("no --query/--location/--city exits 1 with NO_QUERY", async () => {
    const r = await runCLI(["search"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("NO_QUERY")
  })

  test.each(["0", "1.5", "abc"])("--jobage %s exits 1 with BAD_ARG", async (v) => {
    const r = await runCLI(["search", "-q", "x", "--jobage", v])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("detail with a foreign URL exits 1 with BAD_ID", async () => {
    const r = await runCLI(["detail", "https://evil.com/of-ieb371a01c14f97838d790d19d606ce"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ID")
  })

  test("an unknown command exits 1 with BAD_CMD", async () => {
    const r = await runCLI(["frobnicate"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_CMD")
  })
})
