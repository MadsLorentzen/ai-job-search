# Infoempleo URL Reference

Public, unauthenticated pages of `https://www.infoempleo.com`. Verified live on 2026-10-18.
Spanish market; no per-country parameter.

## robots.txt (checked 2026-10-18)

`User-agent: *` disallows, among others, `/home*`, the **path-style** filters
`/trabajo/fecha_*/*`, `/trabajo/categoria-profesional_*/*`, `/trabajo/pais_*/*`,
`/*/pagina_*` and `/ver_rss/`. The CLI uses none of these: it only requests
`/trabajo/` with **query-string** parameters and `/ofertasdetrabajo/...` detail pages,
which are not disallowed. If a future robots.txt disallows those, stop using this skill.

## Search

```
GET https://www.infoempleo.com/trabajo/?search=<keywords>&region=<place>&ordenacion=fechaAlta&diasPublicacion=<1|7|15>&pagina=<n>
```

| Parameter | Meaning |
|-----------|---------|
| `search` | Free-text keywords. Matching is loose (OR-like), not exact-phrase. |
| `region` | Province or city name as plain text (`Toledo`, `Illescas`). |
| `ordenacion` | `fechaAlta` = newest first (the CLI always sets it); `Relevancia` is the site default. |
| `diasPublicacion` | Freshness filter. The site's radio buttons offer `1`, `7`, `15` (and "any"). |
| `pagina` | 1-indexed page, 20 offers per page. Omit for page 1. |

These are the parameters the site's own `recargar()` / `enviar()` JavaScript builds, found in
the page source. A path slug route also exists (`/trabajo/oferta-empleo/<job-title>/en_<province>/`)
but only accepts job titles the site already knows (anything else is a 404), so the CLI does not use it.

### Response structure

- Result count: `Mostrando 1-20 de 111 ofertas` (thousands use `.`).
- Offers: `<ul class="mt15 positions">` holding `<li class="offerblock">` cards. The list is
  **not well-formed** (no closing `</li>`), and the same class is reused by ad slots
  (`robapaginas`) and course modules (`ModuloCursos`), so the parser splits on the opener and
  keeps only chunks containing an offer link.
- Per card:
  - Title + link: `<h2 class="title ..."><a href="/ofertasdetrabajo/<slug>/<city>/<id>/">`
  - Requirements excerpt: `<p class="trunkat ...">`
  - Experience / contract / salary line: `<p class="small extra-data ...">`
  - Company: `<div class="logoplusname ..."> ... <span class="extra-data">NAME</span>`. Absent for anonymous offers.
  - Location: text after the `icon-map-marker` svg
  - Age: `icon-clock` svg, then `<span class="extra-data">Hace 18 horas ...`

## Detail

```
GET https://www.infoempleo.com/ofertasdetrabajo/<slug>/<city>/<id>/
```

Only the trailing numeric `<id>` is significant: `/ofertasdetrabajo/x/y/<id>/` resolves the
same offer, and an unknown or expired id returns 404. The CLI uses that so `detail <id>` works
without the slug.

The page embeds several `<script type="application/ld+json">` blocks. The one with
`"@type":"JobPosting"` holds: `title`, `datePosted`, `validThrough` (deadline),
`description` (HTML), `hiringOrganization.name`, `jobLocation.address`, `baseSalary`
(`minValue`/`maxValue`/`unitText`), `employmentType`, `workHours`, `experienceRequirements`,
`industry`, `occupationalCategory`. Other blocks (`Action`, `Occupation`, `BreadcrumbList`) are ignored.

## Quirks

- Responses are UTF-8; accented characters appear as numeric entities (`&#237;`) in the HTML
  and are decoded by the CLI.
- Relative ages on cards: `Hace N minutos|horas|días|semanas|meses`. `Hace más de 100 días` is
  a lower bound and decodes to `null`.
- Staffing agencies post one offer across many cities; the card shows `"<city> y N más"`.
