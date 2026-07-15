# Arbeitsagentur Jobsuche API — URL Reference

Official public API of the Bundesagentur für Arbeit (German Federal Employment
Agency), documented by the bund.dev community: https://jobsuche.api.bund.dev/

No registration required. All requests need the static header:

```
X-API-Key: jobboerse-jobsuche
```

## Search endpoint

```
GET https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobs
```

| Parameter            | Meaning                                                        | CLI flag        |
|----------------------|----------------------------------------------------------------|-----------------|
| `was`                | Keyword: job title, skill, profession                          | `--query`       |
| `wo`                 | Location: city, postal code, or region                         | `--location`    |
| `umkreis`            | Radius in km around `wo` (API default 25)                      | `--radius`      |
| `veroeffentlichtseit`| Posting age in days (0–100)                                    | `--jobage`      |
| `page`               | Page number, 1-indexed                                         | `--page`        |
| `size`               | Results per page (max 100)                                     | `--size`        |
| `arbeitszeit`        | `vz` full-time, `tz` part-time, `snw` shift/night/weekend, `ho` home office, `mj` minijob. Multiple: semicolon-joined | `--worktime` |
| `befristung`         | `1` temporary, `2` permanent                                   | `--contract`    |
| `angebotsart`        | `1` job (default), `2` self-employment, `4` apprenticeship/dual study, `34` internship/trainee | `--offertype` |
| `arbeitgeber`        | Filter by employer name                                        | `--employer`    |
| `zeitarbeit`         | `false` excludes temp-agency (Zeitarbeit) postings             | `--no-tempwork` |

Response (JSON): `stellenangebote[]` with `refnr`, `titel`, `beruf`, `arbeitgeber`,
`arbeitsort {plz, ort, region, land, entfernung}`, `aktuelleVeroeffentlichungsdatum`,
`eintrittsdatum`, optional `externeUrl`. Total count in `maxErgebnisse`.

## Detail endpoint

```
GET https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v3/jobdetails/{BASE64(refnr)}
```

The path segment is the **base64-encoded** `refnr` from search results.
**v3 is the working version** — v1/v2 return 403 with this API key (verified 2026-07).

Response fields used: `stellenangebotsTitel`, `firma`, `stellenangebotsBeschreibung`
(plain text), `stellenlokationen[]`, `datumErsteVeroeffentlichung`,
`eintrittszeitraum.von`, `arbeitszeitVollzeit`, `vertragsdauer`, `verguetungsangabe`,
`festgehalt`, `hauptberuf`, `allianzpartnerName`, `allianzpartnerUrl`, `referenznummer`.

## Human-facing URLs

- Job detail page: `https://www.arbeitsagentur.de/jobsuche/jobdetail/{refnr}`
- Externally hosted postings carry `externeUrl` in search results; their detail
  data may be thinner than BA-hosted postings.

## Quirks

- Search covers Germany plus some neighbouring markets (Austrian AMS postings
  appear for German-language queries without `wo`). Pass `--location` to stay in Germany.
- `arbeitsort.strasse` can be the literal string `"null"`.
- `koordinaten` may be `0.0/0.0` for external postings.
- `arbeitsort.entfernung` (km) is only present when searching with `wo`/`umkreis`.
