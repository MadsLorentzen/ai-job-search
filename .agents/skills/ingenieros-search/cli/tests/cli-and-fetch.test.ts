import { afterEach, describe, expect, test } from "bun:test"
import { CliError, htmlFetch } from "../src/helpers"
import { runSearch } from "../src/commands/search"
import { normalizeId } from "../src/commands/detail"
import { runCLI } from "./helpers"

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

const LISTING = `<section class="bolsa-ultimas">
<article class="bolsa-oferta"><h3><a href="https://www.ingenieros.es/bolsa_de_trabajo/detalles_oferta/3509">Ingeniero proyectos</a></h3>
<p><strong>Fecha:</strong> 02/10/2026 <span>·</span> <strong>Lugar:</strong> Valencia</p>
<p><strong>Empresa:</strong> <a href="x">Grupotec</a></p></article>
<article class="bolsa-oferta"><h3><a href="https://www.ingenieros.es/bolsa_de_trabajo/detalles_oferta/3507">CSS ZARAGOZA</a></h3>
<p><strong>Fecha:</strong> 24/09/2026 <span>·</span> <strong>Lugar:</strong> Zaragoza</p>
<p><strong>Empresa:</strong> <a href="x">HRSWORKERS</a></p></article></section>`

function stderrJSON(stderr: string): { error: string; code: string } {
  return JSON.parse(stderr)
}

describe("flag validation (no network)", () => {
  test("an unknown flag exits 1 with UNKNOWN_FLAG", async () => {
    const r = await runCLI(["search", "--bogus-flag", "xyz"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test.each(["0", "1.5", "abc"])("--jobage %s exits 1 with BAD_ARG", async (v) => {
    const r = await runCLI(["search", "--jobage", v])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("a bad --format exits 1 with BAD_ARG", async () => {
    const r = await runCLI(["search", "--format", "xml"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG")
  })

  test("detail without an id exits 1 with NO_ID", async () => {
    const r = await runCLI(["detail"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("NO_ID")
  })

  test("detail with a foreign URL exits 1 with BAD_ID", async () => {
    const r = await runCLI(["detail", "https://evil.com/bolsa_de_trabajo/detalles_oferta/3509"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_ID")
  })

  test("an unknown command exits 1 with BAD_CMD", async () => {
    const r = await runCLI(["frobnicate"])
    expect(r.exitCode).toBe(1)
    expect(stderrJSON(r.stderr).code).toBe("BAD_CMD")
  })
})

describe("normalizeId", () => {
  test.each([
    ["3509", "3509"],
    ["https://www.ingenieros.es/bolsa_de_trabajo/detalles_oferta/3509", "3509"],
    ["ingenieros.es/bolsa_de_trabajo/detalles_oferta/3509/", "3509"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeId(input)).toBe(expected)
  })

  test.each([
    "https://evil.com/bolsa_de_trabajo/detalles_oferta/3509",
    "https://ingenieros.es.evil.io/bolsa_de_trabajo/detalles_oferta/3509",
    "https://ingenieros.es@evil.io/bolsa_de_trabajo/detalles_oferta/3509",
    "https://www.ingenieros.es/bolsa_de_trabajo/detalles_empresa/261",
    "0",
    "abc",
    "",
  ])("rejects %s", (input) => {
    expect(normalizeId(input)).toBeNull()
  })
})

describe("htmlFetch", () => {
  test("passes an AbortSignal timeout so a stalled connection cannot hang the CLI", async () => {
    let init: RequestInit | undefined
    globalThis.fetch = (async (_u: string | URL | Request, i?: RequestInit) => {
      init = i
      return new Response("<html></html>")
    }) as unknown as typeof fetch
    await htmlFetch("https://www.ingenieros.es/bolsa_de_trabajo")
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  test("a 403 is reported as BLOCKED and is not retried", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response("denied", { status: 403 })
    }) as unknown as typeof fetch
    const err = await htmlFetch("https://www.ingenieros.es/x").catch((e) => e)
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).code).toBe("BLOCKED")
    expect(calls).toBe(1)
  })
})

describe("runSearch", () => {
  const base = { jobage: 9999, page: 1, format: "json" as const }

  test("lists the front page and reports how many offers it held", async () => {
    globalThis.fetch = (async () => new Response(LISTING)) as unknown as typeof fetch
    const io = capture()
    expect(await runSearch({ ...base })).toBe(0)
    const parsed = JSON.parse(io.out())
    expect(parsed.meta).toEqual({ count: 2, page: 1, listed: 2 })
  })

  test("filters client-side and still reports the unfiltered count", async () => {
    globalThis.fetch = (async () => new Response(LISTING)) as unknown as typeof fetch
    const io = capture()
    expect(await runSearch({ ...base, query: "ingeniero", location: "valencia" })).toBe(0)
    const parsed = JSON.parse(io.out())
    expect(parsed.meta).toEqual({ count: 1, page: 1, listed: 2 })
    expect(parsed.results[0].id).toBe("3509")
  })

  test("--page 2 is an error, not an empty result", async () => {
    let fetched = false
    globalThis.fetch = (async () => ((fetched = true), new Response(LISTING))) as unknown as typeof fetch
    const io = capture()
    expect(await runSearch({ ...base, page: 2 })).toBe(1)
    expect(JSON.parse(io.err()).code).toBe("BAD_ARG")
    expect(fetched).toBe(false)
  })

  test("a page with no latest-offers section is PARSE_FAILED, not 'zero jobs'", async () => {
    globalThis.fetch = (async () => new Response("<html>maintenance</html>")) as unknown as typeof fetch
    const io = capture()
    expect(await runSearch({ ...base })).toBe(1)
    expect(JSON.parse(io.err()).code).toBe("PARSE_FAILED")
  })

  test("a front page that really has no offers is an empty success", async () => {
    globalThis.fetch = (async () => new Response('<section class="bolsa-ultimas"></section>')) as unknown as typeof fetch
    const io = capture()
    expect(await runSearch({ ...base })).toBe(0)
    expect(JSON.parse(io.out()).results).toEqual([])
  })
})
