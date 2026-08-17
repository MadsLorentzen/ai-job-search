import { afterEach, describe, expect, test } from "bun:test";
import { runSearch, buildSearchUrl } from "../src/commands/search";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;

const CARD = `<article class="box_offer sel " data-id='E92595FF9C5126D461373E686DCF3405'>
  <h2 class="fs18 fwB prB"><a class="js-o-link fc_base" href="/ofertas-de-trabajo/oferta-de-trabajo-de-desarrollador-backend-E92595FF9C5126D461373E686DCF3405#lc=ListOffers-Score4-0"> Desarrollador Backend </a></h2>
  <p class="fs16 fc_base mt5"><span class="mr10"> Bogot&#xE1; </span></p>
  <p class="fs13 fc_aux mt15"> Hace 8 horas </p>
</article>`;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
});

describe("buildSearchUrl", () => {
  test("encodes the query into the /trabajo-de- path", () => {
    expect(buildSearchUrl("desarrollador backend")).toBe(
      "https://co.computrabajo.com/trabajo-de-desarrollador%20backend",
    );
  });
});

describe("runSearch", () => {
  test("--limit 0 emits zero results", async () => {
    globalThis.fetch = (async () => new Response(CARD)) as typeof fetch;

    let stdout = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    const code = await runSearch({ query: "desarrollador backend", page: 1, limit: 0, format: "json" });
    expect(code).toBe(0);
    expect(JSON.parse(stdout).results).toHaveLength(0);
  });

  test("emits parsed cards and a page-1 meta", async () => {
    globalThis.fetch = (async () => new Response(`<body>${CARD}</body>`)) as typeof fetch;

    let stdout = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    const code = await runSearch({ query: "desarrollador backend", page: 1, format: "json" });
    expect(code).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.meta).toEqual({ count: 1, page: 1 });
    expect(out.results[0].title).toBe("Desarrollador Backend");
  });
});