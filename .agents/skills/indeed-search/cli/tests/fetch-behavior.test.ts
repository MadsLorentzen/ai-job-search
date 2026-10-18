import { afterEach, describe, expect, test } from "bun:test"
import { CliError, htmlFetch } from "../src/helpers"
import { runSearch } from "../src/commands/search"

const originalFetch = globalThis.fetch
const originalStdoutWrite = process.stdout.write
const originalStderrWrite = process.stderr.write
afterEach(() => {
  globalThis.fetch = originalFetch
  process.stdout.write = originalStdoutWrite
  process.stderr.write = originalStderrWrite
})

function capture(): { out: () => string; err: () => string } {
  let out = ""
  let err = ""
  process.stdout.write = ((c: string | Uint8Array) => ((out += c.toString()), true)) as typeof process.stdout.write
  process.stderr.write = ((c: string | Uint8Array) => ((err += c.toString()), true)) as typeof process.stderr.write
  return { out: () => out, err: () => err }
}

const PAGE =
  'window.mosaic.providerData["mosaic-provider-jobcards"]=' +
  JSON.stringify({
    metaData: {
      mosaicProviderJobCardsModel: {
        results: [
          { jobkey: "aaaaaaaaaaaaaaaa", title: "Uno" },
          { jobkey: "bbbbbbbbbbbbbbbb", title: "Dos" },
        ],
      },
    },
  }) +
  ';"totalJobCount":2,'

describe("htmlFetch", () => {
  test("passes an AbortSignal timeout so a stalled connection cannot hang the CLI", async () => {
    let init: RequestInit | undefined
    globalThis.fetch = (async (_u: string | URL | Request, i?: RequestInit) => {
      init = i
      return new Response("<html></html>", { status: 200 })
    }) as unknown as typeof fetch
    await htmlFetch("https://es.indeed.com/jobs?q=x")
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  test("identifies itself honestly rather than impersonating a browser", async () => {
    let headers: Record<string, string> = {}
    globalThis.fetch = (async (_u: string | URL | Request, i?: RequestInit) => {
      headers = i?.headers as Record<string, string>
      return new Response("ok")
    }) as unknown as typeof fetch
    await htmlFetch("https://es.indeed.com/jobs?q=x")
    expect(headers["User-Agent"]).toContain("indeed-search-cli")
  })

  test("a 403 is retried once through curl, and reported as BLOCKED only if curl is refused too", async () => {
    let fetchCalls = 0
    let curlCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls++
      return new Response("denied", { status: 403 })
    }) as unknown as typeof fetch
    const err = await htmlFetch("https://es.indeed.com/jobs?q=x", async () => {
      curlCalls++
      return { status: 403, body: "denied" }
    }).catch((e) => e)
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).code).toBe("BLOCKED")
    expect(fetchCalls).toBe(1)
    expect(curlCalls).toBe(1)
  })

  test("BLOCKED also stands when curl is not available", async () => {
    globalThis.fetch = (async () => new Response("denied", { status: 403 })) as unknown as typeof fetch
    const err = await htmlFetch("https://es.indeed.com/jobs?q=x", async () => null).catch((e) => e)
    expect((err as CliError).code).toBe("BLOCKED")
  })

  test("when curl is let through, its body is returned", async () => {
    globalThis.fetch = (async () => new Response("denied", { status: 403 })) as unknown as typeof fetch
    const body = await htmlFetch("https://es.indeed.com/jobs?q=x", async () => ({ status: 200, body: "<html>ok</html>" }))
    expect(body).toBe("<html>ok</html>")
  })

  test("curl is not consulted when the first request succeeds", async () => {
    let curlCalls = 0
    globalThis.fetch = (async () => new Response("fine")) as unknown as typeof fetch
    await htmlFetch("https://es.indeed.com/jobs?q=x", async () => (curlCalls++, null))
    expect(curlCalls).toBe(0)
  })
})

describe("runSearch", () => {
  test("emits the JSON envelope with count, page and total", async () => {
    globalThis.fetch = (async () => new Response(PAGE)) as unknown as typeof fetch
    const io = capture()
    const code = await runSearch({ query: "x", jobage: 9999, page: 2, format: "json" })
    expect(code).toBe(0)
    const parsed = JSON.parse(io.out())
    expect(parsed.meta).toEqual({ count: 2, page: 2, total: 2 })
    expect(parsed.results.map((r: { id: string }) => r.id)).toEqual(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"])
  })

  test("--limit 0 emits zero results", async () => {
    globalThis.fetch = (async () => new Response(PAGE)) as unknown as typeof fetch
    const io = capture()
    const code = await runSearch({ query: "x", jobage: 9999, page: 1, limit: 0, format: "json" })
    expect(code).toBe(0)
    expect(JSON.parse(io.out()).results).toHaveLength(0)
  })

  test("a challenge page surfaces PARSE_FAILED rather than an empty result set", async () => {
    globalThis.fetch = (async () => new Response("<html>Authenticating...</html>")) as unknown as typeof fetch
    const io = capture()
    const code = await runSearch({ query: "x", jobage: 9999, page: 1, format: "json" })
    expect(code).toBe(1)
    expect(JSON.parse(io.err()).code).toBe("PARSE_FAILED")
    expect(io.out()).toBe("")
  })

  test("a blocked request surfaces the BLOCKED code on stderr", async () => {
    globalThis.fetch = (async () => new Response("denied", { status: 403 })) as unknown as typeof fetch
    const io = capture()
    const code = await runSearch({ query: "x", jobage: 9999, page: 1, format: "json" }, async () => null)
    expect(code).toBe(1)
    expect(JSON.parse(io.err()).code).toBe("BLOCKED")
  })

  test("a search succeeds when the 403 is only Bun's client being refused and curl is let through", async () => {
    globalThis.fetch = (async () => new Response("denied", { status: 403 })) as unknown as typeof fetch
    const io = capture()
    const code = await runSearch({ query: "x", jobage: 9999, page: 1, format: "json" }, async () => ({ status: 200, body: PAGE }))
    expect(code).toBe(0)
    expect(JSON.parse(io.out()).meta.count).toBe(2)
  })
})
