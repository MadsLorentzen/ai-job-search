import { describe, test, expect } from "bun:test";
import {
  parseJobCards,
  parseJobDetail,
  extractDivByAttr,
  relativeDateToISO,
} from "../src/helpers";
import { idFromUrl, normalizeDetailUrl } from "../src/commands/detail";

// Real markup as fetched from co.computrabajo.com (2026-08): the rating row's
// class list ("dFlex vm_fx fs16 fc_base mt5") is deliberately NOT matched by
// the location regex (exact class "fs16 fc_base mt5").
function cardMarkup(opts: {
  id?: string;
  title?: string;
  company?: string;
  location?: string;
  date?: string;
  includeCompanyLink?: boolean;
}): string {
  const id = opts.id ?? "E92595FF9C5126D461373E686DCF3405";
  const company = opts.includeCompanyLink === false
    ? ""
    : `<a class="fc_base t_ellipsis" href="https://co.computrabajo.com/adecco-colombia-sa" target='_blank' offer-grid-article-company-url> ${opts.company ?? "Adecco Colombia S.A."} </a>`;
  return `<article class="box_offer sel " data-id='${id}' data-blind="false" id="${id}" data-lc="ListOffers-Score4-0" data-offers-grid-offer-item-container>
    <h2 class="fs18 fwB prB">
      <a class="js-o-link fc_base" href="/ofertas-de-trabajo/oferta-de-trabajo-de-${opts.title?.toLowerCase().replace(/\s+/g, "-") ?? "desarrollador-backend"}-${id}#lc=ListOffers-Score4-0"> ${opts.title ?? "Desarrollador Backend ASO/APX &#x2013; Senior"} </a>
      <div class="tags"><span class="tag postulated hide" applied-offer-tag><span class="icon i_check_circle_full mr5"></span> Postulado </span></div>
    </h2>
    <p class="dFlex vm_fx fs16 fc_base mt5">
      <span class="fx_none mr10"><span class="fwB">4,6</span> <span class="star"></span></span>
      <span class="icon i_verificada mr5"></span>
      ${company}
    </p>
    <p class="fs16 fc_base mt5"><span class="mr10"> ${opts.location ?? "Bogot&#xE1;, D.C., Bogot&#xE1;, D.C."} </span></p>
    <p class="fs13 fc_aux mt15"> ${opts.date ?? "Hace 12 horas"} </p>
  </article>`;
}

function searchPage(...cards: string[]): string {
  return `<!DOCTYPE html><html><body>${cards.join("\n")}</body></html>`;
}

const NOW = new Date("2026-08-17T10:00:00");

describe("parseJobCards", () => {
  test("parses a full card: id, title, url, company, location, date", () => {
    const [card] = parseJobCards(searchPage(cardMarkup({})), NOW);
    expect(card.id).toBe("E92595FF9C5126D461373E686DCF3405");
    expect(card.title).toBe("Desarrollador Backend ASO/APX – Senior");
    expect(card.url).toBe(
      "https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-desarrollador-backend-E92595FF9C5126D461373E686DCF3405",
    );
    expect(card.company).toBe("Adecco Colombia S.A.");
    expect(card.companyUrl).toBe("https://co.computrabajo.com/adecco-colombia-sa");
    expect(card.location).toBe("Bogotá, D.C., Bogotá, D.C.");
    expect(card.date).toBe("2026-08-17"); // "Hace 12 horas" -> same day
  });

  test("location regex does not grab the rating row (dFlex)", () => {
    const [card] = parseJobCards(searchPage(cardMarkup({ location: "Medell&#xED;n, Antioquia" })), NOW);
    expect(card.location).toBe("Medellín, Antioquia");
  });

  test("decodes the en-dash entity in the title", () => {
    const [card] = parseJobCards(searchPage(cardMarkup({ title: "Frontend &#x2013; Junior" })), NOW);
    expect(card.title).toBe("Frontend – Junior");
  });

  test("date null when the card has no date line", () => {
    const [card] = parseJobCards(searchPage(cardMarkup({ date: "" })), NOW);
    expect(card.date).toBeNull();
  });

  test("date null when the date text is not a relative date", () => {
    const [card] = parseJobCards(searchPage(cardMarkup({ date: "Oferta destacada" })), NOW);
    expect(card.date).toBeNull();
  });

  test("a card without a title link is skipped, the rest survive", () => {
    const broken = `<article class="box_offer sel " data-id='AAAA0000BBBBCCCCDDDDEEEEFFFF1111'><p>no link</p></article>`;
    const ok = cardMarkup({ id: "E92595FF9C5126D461373E686DCF3405" });
    const cards = parseJobCards(searchPage(broken, ok), NOW);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe("E92595FF9C5126D461373E686DCF3405");
  });

  test("company null when the card has no company link", () => {
    const [card] = parseJobCards(
      searchPage(cardMarkup({ includeCompanyLink: false })),
      NOW,
    );
    expect(card.company).toBeNull();
    expect(card.companyUrl).toBeNull();
  });
});

describe("relativeDateToISO", () => {
  test("Hoy -> today", () => {
    expect(relativeDateToISO("Hoy", NOW)).toBe("2026-08-17");
  });
  test("Ayer -> yesterday", () => {
    expect(relativeDateToISO("Ayer", NOW)).toBe("2026-08-16");
  });
  test("Ayer with a parenthetical note (detail pages)", () => {
    expect(relativeDateToISO("Ayer (actualizada)", NOW)).toBe("2026-08-16");
  });
  test("Hace N días", () => {
    expect(relativeDateToISO("Hace 2 días", NOW)).toBe("2026-08-15");
  });
  test("decodes hex entities inside the date text (live markup: `d&#xED;as`)", () => {
    expect(relativeDateToISO("Hace 2 d&#xED;as", NOW)).toBe("2026-08-15");
  });
  test("Hace 1 semana", () => {
    expect(relativeDateToISO("Hace 1 semana", NOW)).toBe("2026-08-10");
  });
  test("Hace 3 meses (month = 30 days)", () => {
    expect(relativeDateToISO("Hace 3 meses", NOW)).toBe("2026-05-19");
  });
  test("Hace 1 año (year = 365 days)", () => {
    expect(relativeDateToISO("Hace 1 año", NOW)).toBe("2025-08-17");
  });
  test("sub-day units resolve to today", () => {
    expect(relativeDateToISO("Hace 30 minutos", NOW)).toBe("2026-08-17");
    expect(relativeDateToISO("Hace 12 horas", NOW)).toBe("2026-08-17");
  });
  test("collapses irregular whitespace", () => {
    expect(relativeDateToISO("  Hace   12  horas  ", NOW)).toBe("2026-08-17");
  });
  test("non-date text returns null", () => {
    expect(relativeDateToISO("Palabras clave: analyst", NOW)).toBeNull();
    expect(relativeDateToISO("Oferta oculta", NOW)).toBeNull();
  });
  test("null/empty input returns null", () => {
    expect(relativeDateToISO(null, NOW)).toBeNull();
    expect(relativeDateToISO("", NOW)).toBeNull();
  });
});

function detailMarkup(opts: { withOfertaBlock?: boolean } = {}): string {
  const oferta = opts.withOfertaBlock === false ? "" : `
  <div class="mb40 pb40 bb1" div-link="oferta">
    <h3 class="fwB fs18 mb20">Descripci&#xF3;n de la oferta</h3>
    <div class="mbB">
      <span class="tag base mb10">A convenir</span>
      <span class="tag base mb10">Contrato a t&#xE9;rmino indefinido</span>
      <span class="tag base mb10">Tiempo Completo</span>
      <span class="tag base mb10">Presencial y remoto</span>
    </div>
    <p class="mbB">Empresa del sector Retail, solicita Analista de Desarrollador, para Crear y desarrollar nuevos programas o sistemas.</p>
    <p class="mbB">Con experiencia de 2 a&#xF1;os como analista desarrollador.</p>
    <p class="fwB fs18 mtB mb10">Requerimientos</p>
    <ul class="disc mbB">
      <li class='mb10'>Educaci&#xF3;n m&#xED;nima: Universidad / Carrera tecnol&#xF3;gica</li><li class='mb10'>2 a&#xF1;os de experiencia</li>
    </ul>
    <p class="fc_aux fs13 mbB mtB">Palabras clave: analyst</p>
    <p class="fc_aux fs13">Ayer (actualizada)</p>
    <div class="posSticky_m bottom0 bg_white pAllB_m mtB">
      <div class="w40 dFlex tc_fx mAuto w100_m">
        <a data-href-access="https://candidato.co.computrabajo.com/match/?oi=914951A43A87C52A61373E686DCF3405&amp;p=57&amp;idb=1" data-href-offer-apply="https://candidato.co.computrabajo.com/match/?oi=914951A43A87C52A61373E686DCF3405&amp;p=57&amp;idb=1" class="b_primary big w100 t_no_wrap" data-js-t-d> Aplicar </a>
      </div>
    </div>
  </div>`;
  return `<!DOCTYPE html><html><head>
    <title>Empleo de Analista de Desarrollo Tecnol&#xF3;gico en AGAVAL - Medell&#xED;n</title>
  </head><body>
    <p class="fs16 fc_aux">Las mejores empresas para trabajar en Colombia</p>
    <h1 class="fwB fs24 mb5 box_detail w100_m">Analista de Desarrollo Tecnol&#xF3;gico</h1>
    <p class="fs16">AGAVAL - Medell&#xED;n, Antioquia</p>
    ${oferta}
  </body></html>`;
}

const DETAIL_URL =
  "https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-analista-de-desarrollo-tecnologico-914951A43A87C52A61373E686DCF3405";

describe("parseJobDetail", () => {
  test("parses title, company/location split, description, requirements, dates", () => {
    const job = parseJobDetail(detailMarkup(), DETAIL_URL, "914951a43a87c52a61373e686dcf3405", NOW);
    expect(job.id).toBe("914951a43a87c52a61373e686dcf3405");
    expect(job.title).toBe("Analista de Desarrollo Tecnológico");
    expect(job.company).toBe("AGAVAL");
    expect(job.location).toBe("Medellín, Antioquia");
    expect(job.salary).toBe("A convenir");
    expect(job.description).toContain("Empresa del sector Retail");
    expect(job.description).toContain("2 años como analista desarrollador");
    expect(job.description).not.toContain("Requerimientos");
    expect(job.requirements).toEqual([
      "Educación mínima: Universidad / Carrera tecnológica",
      "2 años de experiencia",
    ]);
    expect(job.date).toBe("2026-08-16"); // "Ayer (actualizada)" relative to the injected NOW
    expect(job.applyUrl).toBe(
      "https://candidato.co.computrabajo.com/match/?oi=914951A43A87C52A61373E686DCF3405&p=57&idb=1",
    );
    expect(job.deadline).toBeNull();
    expect(job.url).toBe(DETAIL_URL);
  });

  test("does not grab the fc_aux marketing row as company", () => {
    const job = parseJobDetail(detailMarkup(), DETAIL_URL, "x", NOW);
    expect(job.company).toBe("AGAVAL");
    expect(job.location).toBe("Medellín, Antioquia");
  });

  test("no oferta block -> null description, empty requirements, null date", () => {
    const job = parseJobDetail(detailMarkup({ withOfertaBlock: false }), DETAIL_URL, "x", NOW);
    expect(job.description).toBeNull();
    expect(job.requirements).toEqual([]);
    expect(job.salary).toBeNull();
    expect(job.date).toBeNull();
    expect(job.applyUrl).toBeNull();
  });
});

describe("extractDivByAttr", () => {
  test("extracts content from a simple div", () => {
    const html = '<div class="mb40" div-link="oferta">Simple text</div>';
    expect(extractDivByAttr(html, "div-link", "oferta")).toBe("Simple text");
  });

  test("handles nested divs by tracking depth", () => {
    const html = `<div div-link="oferta">
      <div>Requerimientos block</div>
      <ul><li>Skill A</li></ul>
    </div>`;
    expect(extractDivByAttr(html, "div-link", "oferta")).toBe(
      '\n      <div>Requerimientos block</div>\n      <ul><li>Skill A</li></ul>\n    ',
    );
  });

  test("returns null when attribute not found", () => {
    expect(extractDivByAttr("<div>no attr</div>", "div-link", "oferta")).toBeNull();
  });
});

describe("detail URL handling", () => {
  test("normalizeDetailUrl accepts a full URL and strips #lc + query", () => {
    expect(normalizeDetailUrl(`${DETAIL_URL}#lc=Detail&oi=1`)).toBe(DETAIL_URL);
  });
  test("normalizeDetailUrl accepts a relative path", () => {
    expect(normalizeDetailUrl("/ofertas-de-trabajo/oferta-de-trabajo-de-x-E92595FF9C5126D461373E686DCF3405")).toBe(
      "/ofertas-de-trabajo/oferta-de-trabajo-de-x-E92595FF9C5126D461373E686DCF3405",
    );
  });
  test("normalizeDetailUrl rejects a bare id", () => {
    expect(normalizeDetailUrl("E92595FF9C5126D461373E686DCF3405")).toBeNull();
  });
  test("idFromUrl extracts the 32-hex id (lowercased)", () => {
    expect(idFromUrl(DETAIL_URL)).toBe("914951a43a87c52a61373e686dcf3405");
  });
  test("idFromUrl returns null without a 32-hex id", () => {
    expect(idFromUrl("https://co.computrabajo.com/ofertas-de-trabajo/x")).toBeNull();
  });
});