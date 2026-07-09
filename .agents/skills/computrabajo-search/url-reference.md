# Computrabajo Colombia URL Reference

Public HTML pages used by this skill for Colombia (co.computrabajo.com).

> Personal use only — automated access is against Computrabajo's Terms of Service;
> keep volume low.

## Search

```
GET https://www.computrabajo.com.co/ofertas-de-trabajo/?q=<query>
```

Canonical/semantic form:
```
GET https://co.computrabajo.com/trabajo-de-<slugified-query>
```

Query params:

| Param | Meaning | Example |
|-------|---------|---------|
| `q` | Free-text query | `ingeniero+software` |
| `l` | Location (city or department) | `Bogotá`, `Medellín`, `Antioquia` |
| `pubdate` | Posted within days | `1`, `3`, `7`, `15`, `30` |
| `pag` | Page number (1-indexed) | `1`, `2`, `3` |

Returns HTML with job cards in `<article class="box_offer" data-id="{HEX_ID}">` elements.
~20 results per page.

Each card contains:
- Title: `<a class="js-o-link fc_base">` inside `<h2>`
- URL: the `href` of the title link
- Company: text near the title link
- Location, salary, date, work modality: text spans inside the article

## Detail

```
GET https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-{slug}-{HEX_ID}
```

Returns a single job's HTML page with:
- Title: `<h1>` 
- Company: company name in the page
- Salary: price text (e.g. `$ 4.719.900,00 (Mensual)`)
- Description: in the description section
- Contract type: text containing "Contrato a término..."
- Work modality: "Presencial", "Remoto", "Presencial y remoto"
- Posting date: relative date string (e.g. "Hace 14 horas", "Ayer", "Hoy")
- Location: city/department text

## Notes

- No authentication required.
- Respect rate limits — the CLI backs off on 429/5xx.
- Job IDs are 32-character hex strings (e.g. `F74E146623AC0A6E61373E686DCF3405`).
- For `detail`, pass the full URL from search results — the ID alone cannot reconstruct the URL without the slug.
