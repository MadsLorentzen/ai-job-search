# Freelance-Informatique — endpoint and parsing reference

Everything here was verified against the live site on 2026-07-29. If the portal
changes its markup, these are the anchors to update in `cli/src/helpers.ts`.

Base URL: `https://www.freelance-informatique.fr`

## robots.txt

```
User-agent: *
Disallow: /forum-freelance/
Disallow: /forum/
Disallow: /fr/freelance/
Disallow: /fr/entreprises/
Disallow: /fr/admin/
Disallow: /*gclid*
Disallow: /*.asp$
Disallow: /*.php$

Sitemap: https://www.freelance-informatique.fr/sitemaps/sitemaps_index.xml
```

No crawl-delay. `/offres-freelance` and `/mission-*` are permitted.

**The `.php` disallow matters.** The site's own search widgets are backed by two
PHP endpoints, both off-limits and therefore unused by this CLI:

| Endpoint | Method | Purpose |
|---|---|---|
| `/_recherche-competences.php` | GET, JSON | Skills autocomplete vocabulary |
| `/sites/liste-localisations.php` | POST, JSON | Location dropdown (select2), returns the opaque ids `localisation=` expects |

## Search

```
GET /offres-freelance?competences=<term>&page=<n>
```

The site's own form submits `POST /offres-freelance`, but GET with the same
field names works identically and is what the CLI uses.

| Parameter | Supported | Notes |
|---|---|---|
| `competences` | ✅ server-side, **with a trap** | Matched against the mission skills taxonomy, **not** full text. Normalised: `Node.js` and `NodeJS` return the same set. A term outside the taxonomy is **silently widened to a related skill** rather than rejected — see below. |
| `page` | ✅ server-side | 1-indexed. 50 cards per page. Past the last page → 0 cards, HTTP 200. Combines with `competences`. |
| `localisation` | ❌ **not usable** | Needs the opaque select2 id from `/sites/liste-localisations.php` (robots-disallowed). Plain values (`Paris`, `75`, `75 - Paris`, `Ile-de-France`) are **silently ignored** — the server returns the full unfiltered page. This is the easiest way to get plausible-looking but wrong output from this portal. `--location` is applied client-side instead. |
| posting age | ❌ none exists | No parameter of any kind. `--jobage` is client-side. |

Unfiltered corpus at time of writing: **722 active missions**, 15 pages.

### The `competences` substitution trap

An unknown term does **not** reliably return nothing. Measured 2026-07-29:

| `competences=` | Cards | Do the results carry the tag? |
|---|---|---|
| `Java` | 39 | ✅ |
| `Python` | 48 | ✅ |
| `AWS` | 46 | ✅ |
| `Kubernetes` | 23 | ✅ |
| `PostgreSQL` | 10 | ✅ |
| `React` | 7 | ✅ |
| `TypeScript` | 4 | ✅ |
| `Node.js` / `NodeJS` | 3 | ✅ (identical sets — server-side normalisation) |
| `Go` | 1 | ✅ (matches a real `GO` tag) |
| **`Rust`** | **7** | ❌ **all seven are C++ missions, none tagged Rust** |
| `NestJS` | 0 | — absent, returns empty |
| `Golang` | 0 | — absent, returns empty |
| `zzzz` | 0 | — absent, returns empty |

So neither "non-empty" nor "empty" is a trustworthy signal on its own. The CLI
resolves it client-side in `skillMatchesQuery`: it reports the genuine tag hits
as `meta.querySkillHits`, warns `QUERY_SUBSTITUTED` on stderr when that is 0
against a non-empty page, and drops the substituted rows under `--strict`.

### Result-card anchors

Cards are split on `<div class="card job-card-line">` and parsed independently.

| Field | Anchor |
|---|---|
| link + title | `<h2 class="job-title">` containing either `<a href="/mission-...-<REF>" class="stretched-link">` **or** `<span data-obf="<base64 path>" class="stretched-link">`. The portal alternates between the two at random within one page. |
| `id` | The `<REF>` at the end of the path: `/(\d{6}[A-Za-z]\d{3})/`, e.g. `260728C015` (YYMMDD + letter + sequence). |
| `skills` | `<div class="tags">` → `<span>` / `<a>` children. On cards the `title` attribute is plain text; **on detail pages it contains markup**, so the tag regex must tolerate `>` inside quoted attributes. |
| `excerpt` | `<p class="line-clamp-2">` |
| `date` | `<li><i class="icon icon-clock"></i> …` |
| `location` | `<li><i class="icon icon-map"></i> …` → `"75 - Paris"` or `"Télétravail"` |
| `startDate` | `<li><i class="icon icon-calendar"></i> …` → `DD/MM/YYYY` |
| `duration` | `<li><i class="icon icon-time"></i> …` → `"3 mois"`, `"60 jours ouvrés"` |
| `company` | **Not present.** Every card carries `/avatars/companyN.png` with `alt="Logo client"`. Always `null`. |
| `dailyRate` | **Not present anywhere on the portal.** Always `null`. |

### Publication-date wording

Five forms, in decreasing recency. Only the last carries a date, and it has no
year:

| Wording | Meaning |
|---|---|
| `Publiée à l'instant` | today |
| `Publiée aujourd'hui` | today |
| `Publiée hier` | today − 1 |
| `Publiée il y a N jours` | today − N (observed up to ~6) |
| `Publiée le DD/MM` | that date; assume the most recent occurrence (roll back a year if it would be in the future) |

## Detail

```
GET /mission-<slug>-<REF>
```

**The slug is irrelevant.** Any slug with the right trailing reference
301-redirects to the canonical URL, so the CLI fetches `/mission-x-<REF>` and
follows the redirect:

```
GET /mission-x-260728C015
  → 301 Location: /mission-developpeur-java-sur-paris-260728C015
```

The reference is case-insensitive (`260728c015` redirects the same way).

**Unknown references return HTTP 200**, not 404 — a generic page with no
`<h1 class="title">` and no `Ref :`. Absence of both anchors is the not-found
signal; `htmlFetch`'s 404 handling alone is not enough.

### Detail-page anchors

| Field | Anchor |
|---|---|
| `title` | `<h1 class="title">` |
| `id` | `<small>Ref : 260728C015</small>` |
| `startDate` | `<li title="Date de début">` → `DD/MM/YYYY` |
| `location` | `<li title="Localisation">` |
| `duration` | `<li title="Durée">` → `"3 mois (renouvelables)"` |
| `profile` | `<li title="Profil">` → job family, links to `/job-<name>-<id>` |
| `sector` | `<li title="Secteur d'activité">` |
| skills | `<div class="subtitle">Compétences requises</div>` followed by `<div class="tags">`. Each tag links to `/freelance-<skill>-<id>`; `class="… obligatoire"` marks a required skill, everything else is optional. |
| `description` | `<div class="mission-description">` — rich HTML (`<p>`, `<br>`, `<b>`) |
| `date` | `<div class="card-footer"><small>Publiée …</small>` — same wording as the cards |
| `applyUrl` | `<span class="btn btn-primary btn-postuler …" data-obf="<base64>">` → `/candidature-<slug>-<REF>` |

Each `<li title="…">` repeats its label in a `<div class="fw-bold">` before the
value; that div is stripped before reading the value.

## Encoding

The pages are UTF-8 but the content mixes raw characters with HTML entities,
and the portal frequently **omits the trailing semicolon**. Observed on one
page: `&nbsp` ×325, `&gt` ×75, `&amp` ×41, `&eacute;` ×24. The decoder accepts
`&nbsp`/`&lt`/`&gt`/`&quot`/`&amp` with or without the semicolon, and maps the
French named entities (`&eacute;`, `&agrave;`, `&ccedil;`, …) including their
uppercase forms.
