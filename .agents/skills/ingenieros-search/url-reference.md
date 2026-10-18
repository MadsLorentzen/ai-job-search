# Ingenieros.es URL Reference

Public, unauthenticated pages of `https://www.ingenieros.es`. Verified live on 2026-10-18.

## robots.txt (checked 2026-10-18)

`User-agent: *` disallows only `/admin/`, `/index.php/admin/`, `/ckfinder/`, `/files/fotos/`,
`/files/cv/`, `/file/noticias/` and `/file/Noticias1/`. The CLI requests none of them.

## Listing

```
GET https://www.ingenieros.es/bolsa_de_trabajo
```

One page, no pagination, no query parameters. It holds a "Últimas ofertas de empleo" section:

```html
<section class="bolsa-ultimas" aria-labelledby="bolsa-ultimas-titulo">
<article class="bolsa-oferta">
<h3><a href=".../bolsa_de_trabajo/detalles_oferta/3511">TITLE</a></h3>
<p><strong>Fecha:</strong> 16/10/2026 <span class="bolsa-separador">·</span> <strong>Lugar:</strong> PLACE</p>
<p><strong>Empresa:</strong> <a href=".../bolsa_de_trabajo/detalles_empresa/261">COMPANY</a></p>
</article>
```

Dates are `DD/MM/YYYY`. The CLI splits on `<article class="bolsa-oferta">` and parses each card
independently. The `bolsa-ultimas` section id is what separates "the board has no offers" from
"the layout changed" (the latter is `PARSE_FAILED`).

## Search (not used)

`/bolsa_de_trabajo/buscar` renders an advanced-search form that POSTs to
`/bolsa_de_trabajo/buscar/avanzado` with a `portal_csrf` token and a session cookie
(fields: `palabras`, `categoria`, `provincia`, `poblacion`, `estudios`, `experiencia`,
`tipo_contrato`, `tipo_jornada`, `salario`). A plain POST with the token returned a page with no
offers, so the CLI filters the public listing client-side instead.

## Detail

```
GET https://www.ingenieros.es/bolsa_de_trabajo/detalles_oferta/<id>
```

`<article class="bolsa-detalle">` with a `<header class="bolsa-detalle-cabecera">` (`<h2>` title,
`Publicada el DD/MM/YYYY`) followed by `<section class="bolsa-detalle-seccion">` blocks, each led by an `<h3>`:

| Section (`<h3>`) | Content |
|------------------|---------|
| La empresa | `Fecha de la oferta`, `Nombre de la empresa`, `Sede central en` |
| Ubicación de la empresa | company country / province / town (not the job's place) |
| Descripción de la oferta | `Puesto vacante`, `Provincia`, `Lugar del trabajo`, `Sector`, `Nivel`, `Número de vacantes`; text block "Descripción de la oferta" |
| Requisitos | `Estudios mínimos`, `Experiencia mínima`; text blocks "Requisitos mínimos" and "Requisitos deseados" |
| Contrato | `Tipo de contrato`, `Jornada laboral`, `Horario`, `Salario (€ brutos/año)` |

Label/value pairs are `<p><span style="color:#5890A8">Label:</span> value</p>`; text blocks are
`<div class="bolsa-detalle-texto"><h4>Heading</h4><div>...</div></div>`. A removed offer returns the
normal page shell without a `bolsa-detalle-cabecera`, which the CLI reports as `PARSE_FAILED`.

## Quirks

- Responses are UTF-8 with named entities (`&ntilde;`, `&aacute;`, `&hellip;`); the CLI decodes the Spanish set.
- The listing shows the job's place (`Lugar`) only; the province is on the detail page.
- Some offers are placed abroad by Spanish recruiters; the place is then a foreign town.
