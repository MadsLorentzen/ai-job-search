# HelloWork — endpoint and parsing reference

Everything the CLI depends on, recorded so the parsers can be repaired when
HelloWork changes its markup. Verified live on **2026-07-27**.

Base: `https://www.hellowork.com`

---

## Access rules (robots.txt)

Fetched from `https://www.hellowork.com/robots.txt`.

```
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: GPTBot
User-Agent: ccbot
Allow: /*?
Disallow:

User-Agent: *
Disallow: /*?
Disallow: /fr-fr/candidat/
Disallow: /fr-fr/emploi/recherche.html      ← the search endpoint
Disallow: /fr-fr/emplois/candidature.html
Disallow: /fr-fr/emplois/token/
Disallow: /fr-fr/emplois/ext/
...
```

| Path the CLI uses | Status for `User-Agent: *` |
|---|---|
| `/fr-fr/emploi/recherche.html?…` | **Disallowed** (both by path and by `/*?`) |
| `/fr-fr/emplois/<id>.html` | Allowed — not matched by any `Disallow` rule |

The skill therefore carries a personal-use-only warning. `robots.txt` also
explicitly grants AI crawlers (`GPTBot`, `ChatGPT-User`, `OAI-SearchBot`,
`ccbot`) full query-string access.

No authentication is required for either endpoint.

---

## Search

```
GET /fr-fr/emploi/recherche.html?k=<kw>&l=<place>&c=<contract>&d=<age>&st=<sort>&ray=<km>&p=<page>
```

Server-rendered HTML. **30 results per page.**

### Parameters

| Param | Meaning | Values / notes |
|---|---|---|
| `k` | Keywords | Free text. |
| `l` | Location | **Must be `"<City> <postcode>"`** (`Paris 75000`) or a region name (`Ile-de-France`). A bare city name returns **0 results**, not an error. Omit for all of France. |
| `l_autocomplete` | INSEE commune code | What the website sends alongside `l` (`75056` = Paris). **Ignored on its own** — `l_autocomplete=75056` with no `l` returns the unfiltered set. The CLI does not send it. |
| `c` | Contract type | **Repeats for OR**: `?c=Freelance&c=Independant`. Case-sensitive. |
| `d` | Posting age | `all` \| `h` (24h) \| `d` (3 days) \| `w` (1 week) \| `m` (1 month). |
| `st` | Sort | `relevance` (default) \| `date`. |
| `ray` | Radius in km around `l` | Site default `20`. |
| `p` | Page, 1-indexed | Omitted for page 1. Verified: `p=2` returns 30 fresh ids. |
| `cod` | Contract duration | `all` \| `1m` \| `1-3m` \| `3-6m` \| `6-12m` \| `1-2y` \| `2y`. Not currently exposed by the CLI. |
| `msa` | Minimum salary | Integer. Not currently exposed by the CLI. |

### `c` values (complete, from the facet checkboxes)

`CDI`, `CDD`, `Travail_temp`, `Stage`, `Alternance`, `Independant`, `Franchise`,
`Associe`, `Fonctionnaire`, `Freelance`, `Stage_de_lycee`

`Freelance` and `Independant` are distinct — the CLI accepts either and maps
English aliases (`contractor`→`Freelance`, `permanent`→`CDI`, …).

### Result-card anchors

Cards are `<li>` elements. The CLI splits the page on
`data-id-storage-item-id="` and parses each chunk independently.

| Field | Anchor |
|---|---|
| `id` | `data-id-storage-item-id="<digits>"` (the chunk delimiter). Also present as `data-hide-offer-item-id-value` and in the analytics `product_id`. |
| `url` | `href="/fr-fr/emplois/<id>.html"` |
| `title` | First `<p>` inside the card's `<h3 class="inline">` |
| `company` | Second `<p>` inside the same `<h3>` |
| *fallback for both* | The `data-cy="offerTitle"` anchor's `title="<Title> - <Company>"` attribute (split on the **last** `" - "`) |
| `location` | `data-cy="localisationCard"` div, e.g. `Paris - 75` |
| `contract` | `data-cy="contractCard"` div, e.g. `Freelance` |
| `salary` | The bold pill: `class="… tag-secondary-s typo-s-bold …"`, e.g. `500 - 550 € / jour`. Absent when the employer published no figure. |
| `date` | `class="typo-s text-grey-500 …"` div — a **relative French label**, see below |

Accented characters arrive as hex entities (`D&#xE9;veloppeur`), so entity
decoding is mandatory on every text field.

#### Date labels (there is no machine-readable timestamp)

Observed values: `moins d'une heure`, `il y a 3 heures`, `il y a 18 heures`,
`il y a 2 jours`, `il y a 26 jours`.

Two traps:

1. **The freshest listings have no `il y a` prefix** — they read
   `moins d'une heure`. A parser gated on `il y a` silently returns no date for
   exactly the newest results, which are the ones a daily sweep cares about.
2. **Section separators share the date div's class.** HelloWork inserts
   `<div class="typo-s text-grey-500 …">Les offres ci-dessous sont basées sur
   les mots-clés de votre recherche</div>` between result groups. It falls
   inside the preceding card's chunk, so a card lacking its own date picks the
   separator up as its date. The CLI scans **all** candidates in a chunk and
   keeps the first that matches the relative-date shape (`RELATIVE_DATE_RE`).

---

## Detail

```
GET /fr-fr/emplois/<id>.html
```

Returns the full posting page. **Not disallowed by robots.txt.**

### Primary source: schema.org JSON-LD

The page carries four `<script type="application/ld+json">` blocks; the one with
`"@type": "JobPosting"` holds the entire posting. This is the CLI's primary
source — no markup parsing needed.

| JSON-LD path | Maps to |
|---|---|
| `title` | `title` |
| `description` | `description` (HTML → text) |
| `qualifications` | `qualifications` (HTML → text) |
| `datePosted` | `date` (ISO 8601) |
| `validThrough` | `validThrough` |
| `employmentType` | `employmentType` — **`FULL_TIME`/`PART_TIME`, not the French contract** |
| `hiringOrganization.name` / `.sameAs` | `company` / `companyUrl` |
| `jobLocation.address.{addressLocality,postalCode,addressRegion}` | `location` |
| `baseSalary.value.{minValue,maxValue,unitText}` + `.currency` | `salary`. **`unitText: "DAY"` is the TJM case** (`500-550 EUR/day`); MONTH/YEAR/HOUR/WEEK also occur. |
| `experienceRequirements.monthsOfExperience` | `experienceMonths` |
| `educationRequirements.credentialCategory` | `education` |
| `industry` | `industry[]` |
| `skills` | `skills[]` — a useful keyword list for CV tailoring |
| `url` | `url` |

The search-results page has **no** `JobPosting` JSON-LD — only `WebSite`,
`Organization`, and `BreadcrumbList`. Structured data is a detail-page-only
affordance.

### Contract type — the one field JSON-LD does not carry

**Do not read `data-cy="contractCard"` on a detail page.** Those divs belong to
the *related-offers sidebar*. On posting `81690954` (a Paris freelance mission)
the first such div reads `CDI` and belongs to a different job in Buc — a silent
wrong-value bug, not a parse failure.

Authoritative source, in order of preference:

1. **GTM dataLayer blob**, scoped to this posting's id:
   ```js
   window.dataLayer.push({ …, "idOffre":"81690954", …, "contrat":"Freelance",
                           "datePublicationOffre":"20260725", … })
   ```
   Regex: `"idOffre":"<id>"[\s\S]{0,3000}?"contrat":"([^"]*)"`.
   The blob also carries `Tags`, `Metier`, `Region`, `Departement`, `Ville`, and
   `Nom-Entreprise` if more fields are ever needed.
2. **Header tag list** under the `<h1>`:
   `<ul class="mt-3 inline-flex"><li>Paris - 75</li><li>Freelance</li></ul>`

### Apply

`directApply: true` and a `data-cy="applyButtonHeader"` button; applications go
through an in-page form. There is no external apply URL to extract, and
`/fr-fr/emplois/candidature.html` is robots-disallowed, so `applyUrl` is set to
the posting URL when an apply button is present.

---

## Fetching

- Browser `User-Agent`, `Accept-Language: fr-FR,fr;q=0.9,en;q=0.8`
- Exponential backoff with jitter on 429/5xx, max 6 retries, 20 s timeout
- 404/410 → `""`, surfaced as a `NOT_FOUND` error rather than a crash
- No cookies or session are required for either endpoint
