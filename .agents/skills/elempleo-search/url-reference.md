# Elempleo Colombia URL Reference

Public HTML pages used by this skill for Colombia (elempleo.com/co).

> Personal use only — automated access is against Elempleo's Terms of Service;
> keep volume low.

## Search

```
GET https://www.elempleo.com/co/ofertas-empleo?q=<query>
```

Query params:

| Param | Meaning | Example |
|-------|---------|---------|
| `q` | Free-text query | `ingeniero+software` |
| `l` | Location (city) | `Bogotá`, `Medellín` |
| `fecha` | Posted-within days | `1`, `3`, `7`, `15`, `30` |
| `pag` | Page number | `1`, `2` |

Returns HTML with job cards. Each card has the attribute:
- `data-offer-id="{NUMERIC_ID}"` — unique 10-digit job ID
- `data-offer-url="{full URL}"` — full detail URL

Each card contains:
- Title: `<a class="js-offer-title">` inside `<h2 class="item-title">`
- URL: `href` of the title link or `data-offer-url`
- Company: company name in card body
- Location: city text
- Salary: price range (e.g. `$2 a $2,5 millones`)
- Date: relative date (e.g. "Hoy", "Ayer", "Hace X días")
- Contract type and work modality: text spans

## Detail

```
GET https://www.elempleo.com/co/ofertas-trabajo/<slug>-<NUMERIC_ID>
```

Example URL:
```
GET https://www.elempleo.com/co/ofertas-trabajo/tecnico-electricista-ami-perdidas-1886736527
```

Returns a single job's HTML page with:
- Title: `<h1>`
- Company: company name and link
- Location: city/department text
- Salary: price range text
- Description: full job description in the description section
- Published date
- Contract type: e.g. "Por obra o labor", "Indefinido"
- Work modality: "Presencial", "Remoto", "Híbrido"
- Experience level: "Profesional", "Técnico", etc.
- Industry and sector information
- Related roles

## Notes

- No authentication required.
- Respect rate limits — the CLI backs off on 429/5xx.
- Job IDs are 10-digit numeric integers (e.g. `1886736527`).
- The detail URL is composed of a slugified title + numeric ID; pass the full URL from search results.
- Elempleo is operated by Leadearsearch S.A.S. in Colombia.
