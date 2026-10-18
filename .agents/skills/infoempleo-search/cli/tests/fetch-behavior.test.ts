import { afterEach, describe, expect, test } from "bun:test"
import { CliError, htmlFetch } from "../src/helpers"
import { buildUrl, runSearch } from "../src/commands/search"

const originalFetch = globalThis.fetch
const originalStdoutWrite = process.stdout.write
const originalStderrWrite = process.stderr.write
afterEach(() => {
  globalThis.fetch = originalFetch
  process.stdout.write = originalStdoutWrite
  process.stderr.write = originalStderrWrite
})

describe("htmlFetch", () => {
  test("passes an AbortSignal timeout so a stalled connection cannot hang the CLI", async () => {
    let init: RequestInit | undefined
    globalThis.fetch = (async (_u: string | URL | Request, i?: RequestInit) => {
      init = i
      return new Response("<html></html>", { status: 200 })
    }) as unknown as typeof fetch
    await htmlFetch("https://www.infoempleo.com/trabajo/")
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  test("a 404 resolves to an empty string", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch
    expect(await htmlFetch("https://www.infoempleo.com/x")).toBe("")
  })

  test("a 403 is reported as BLOCKED and is not retried", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response("denied", { status: 403 })
    }) as unknown as typeof fetch
    const err = await htmlFetch("https://www.infoempleo.com/x").catch((e) => e)
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).code).toBe("BLOCKED")
    expect(calls).toBe(1)
  })
})

describe("buildUrl", () => {
  const base = { jobage: 9999, page: 1, format: "json" as const }

  test("maps query and location to search/region and sorts newest first", () => {
    const u = new URL(buildUrl({ ...base, query: "jefe de producción", location: "Toledo" }))
    expect(u.origin + u.pathname).toBe("https://www.infoempleo.com/trabajo/")
    expect(u.searchParams.get("search")).toBe("jefe de producción")
    expect(u.searchParams.get("region")).toBe("Toledo")
    expect(u.searchParams.get("ordenacion")).toBe("fechaAlta")
    expect(u.searchParams.has("diasPublicacion")).toBe(false)
    expect(u.searchParams.has("pagina")).toBe(false)
  })

  test("--jobage 14 rounds up to the 15-day bucket and page 3 sets pagina", () => {
    const u = new URL(buildUrl({ ...base, query: "x", jobage: 14, page: 3 }))
    expect(u.searchParams.get("diasPublicacion")).toBe("15")
    expect(u.searchParams.get("pagina")).toBe("3")
  })
})

describe("runSearch", () => {
  test("--limit 0 emits zero results but still reports the page total", async () => {
    globalThis.fetch = (async () =>
      new Response(
        `Mostrando 1-20 de 50 ofertas<li class="offerblock"><h2 class="title"><a href="/ofertasdetrabajo/a/b/1234567/">T</a></h2>`,
      )) as unknown as typeof fetch
    let out = ""
    process.stdout.write = ((c: string | Uint8Array) => ((out += c.toString()), true)) as typeof process.stdout.write
    const code = await runSearch({ query: "x", jobage: 9999, page: 1, limit: 0, format: "json" })
    expect(code).toBe(0)
    const parsed = JSON.parse(out)
    expect(parsed.results).toHaveLength(0)
    expect(parsed.meta.total).toBe(50)
  })

  test("a blocked request surfaces the BLOCKED code on stderr", async () => {
    globalThis.fetch = (async () => new Response("denied", { status: 403 })) as unknown as typeof fetch
    let err = ""
    process.stderr.write = ((c: string | Uint8Array) => ((err += c.toString()), true)) as typeof process.stderr.write
    const code = await runSearch({ query: "x", jobage: 9999, page: 1, format: "json" })
    expect(code).toBe(1)
    expect(JSON.parse(err).code).toBe("BLOCKED")
  })
})
