# Computrabajo Colombia URL Reference

Public, unauthenticated pages used by this skill. Colombia deployment:
`www.computrabajo.com.co` 301-redirects to the canonical host `co.computrabajo.com`.

> Personal use only — automated access is against the portal's terms; keep volume low.

## Search

```
GET https://co.computrabajo.com/trabajo-de-<query>
```

`query` is the URL-encoded keyword (no other params needed). Returns HTML with one
`<article class="box_offer ...">` per offer. Parsing anchors (verified against live
pages, 2026-08):

| Field | Anchor |
|-------|--------|
| id | `article data-id='<32-hex>'` (single-quoted attribute) |
| title | `a.js-o-link.fc_base` inside `h2.fs18.fwB.prB` |
| url | that anchor's `href` (`/ofertas-de-trabajo/...`) minus the `#lc=` fragment, prefixed with the base host |
| company | `a[offer-grid-article-company-url]` (text + same-anchor `href`) |
| location | `<p class="fs16 fc_base mt5"><span class="mr10">City, Dept.</span></p>` — exact class; the rating row above is `dFlex vm_fx fs16 fc_base mt5` and must NOT match |
| date | `<p class="fs13 fc_aux mt15">Hace N horas|Ayer|Hoy</p>` — relative |

## Detail

```
GET https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-<slug>-<32-hex-id>
```

Returns a single offer's HTML. Parsing anchors:

| Field | Anchor |
|-------|--------|
| title | `<h1 class="fwB fs24 ...">` |
| company + location | `<p class="fs16">AGAVAL - Medellín, Antioquia</p>` right under the h1 (split on `" - "`); the marketing row above the h1 carries `fc_aux` |
| oferta block | `<div class="mb40 pb40 bb1" div-link="oferta">` (depth-walked) |
| salary | first `<span class="tag base mb10">` in the block (`"A convenir"` when unpublished) |
| description | `<p class="mbB">` paragraph(s) until the `Requerimientos` heading |
| requirements | `<ul class="disc mbB"><li>` items |
| date | the `<p class="fc_aux fs13">` inside the block whose text parses as relative (e.g. `"Ayer (actualizada)"`; the `Palabras clave:` line does not parse) |
| applyUrl | `a[data-href-offer-apply]` (`candidato.co.computrabajo.com/match/?oi=...`) |

No application deadline is published on offer pages — the CLI always emits `deadline: null`.

## Robots.txt compliance (why page 1 only)

`robots.txt` allows `/trabajo-de-*` and `/ofertas-de-trabajo/*` but disallows
`/Ajax/*`, `/_services/*`, the filter params (`*dis=*`, `*cont=*`, `*sal=*`, ...),
and CV/account routes. Computrabajo's real paginator is Ajax-based, so the CLI
rejects `--page 2+` with `UNSUPPORTED_PAGINATION` instead of fake-paginating
(`?page=2` is ignored server-side; the `-p-2` URL variant returns non-standard cards).

## Notes

- Entities are emitted as hex numeric refs (`&#xE9;`, `&#xED;`, `&#x2013;`) — the CLI decodes them.
- Dates are relative text; the CLI converts to local `YYYY-MM-DD` at parse time (sub-day units → same day; `1 mes` → 30 days, `1 año` → 365 days).
- Query pages without results return HTTP 200 with zero cards — the CLI emits an empty `results` array.