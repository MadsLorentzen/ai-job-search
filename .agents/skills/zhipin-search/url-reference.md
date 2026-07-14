# BOSS直聘 (zhipin.com) Reference

> Personal use only. See the "Access model" section below before extending this skill —
> the access pattern here (authenticated browser automation, not a stateless HTTP client)
> exists because plain `fetch`/`curl` genuinely cannot retrieve this data, not as a
> convenience choice.

## Access model

zhipin.com's `/web/geek/job` (and `/web/geek/jobs`) search page is a fully client-rendered
Vue SPA (`zhipin-geek-spa`). An unauthenticated `curl`/`fetch` request to the search URL
returns only:

```html
<div id="app">
  <div class="page-loading">...加载中，请稍候...</div>
</div>
```

followed by ~15 `<script defer>` bundle references. There is no server-rendered HTML with
job data, and no discovered public JSON API backing the search — the bundles call internal
endpoints that were not identified as stable/documented enough to hit directly (and doing so
would face the same robots.txt/ToS issue below regardless).

Real listings only appear after the JS bundle executes inside a **logged-in** session — the
page prioritizes loading a `boss-login-*.js`/`boss-login-*.css` bundle first, and in practice
listings only populated during investigation when driven through `ego-browser`, which reuses
the user's own authenticated Chrome profile.

**Consequence for this CLI**: every command shells out to the `ego-browser` CLI instead of
`fetch`. This is real browser automation of the user's own logged-in account — not a stealth
scraper impersonating a browser. Keep usage at the volume a human would generate manually.

## robots.txt

```
User-agent: *
Disallow: /*?query=*
Disallow: *?city=*
...
Disallow: /*?*        <- catch-all: any URL with a query string, for any crawler
```

This explicitly disallows the exact query parameters (`?query=`, `?city=`) this skill's
search needs, on top of a blanket `/*?*` disallow. Documented here per repo policy for
ToS/robots-restricted portals — this is why the SKILL.md carries a prominent personal-use
warning.

## Search

```
https://www.zhipin.com/web/geek/job?query=<url-encoded text>&city=<9-digit city code>
```

(Redirects to `/web/geek/jobs?query=...&city=...` — same params.)

### Verified city codes

Confirmed by running a live search and checking that result locations actually matched the
requested city (not just accepted without error):

| City | Code | Alias accepted by CLI |
|------|------|------------------------|
| 上海 (Shanghai) | `101020100` | `上海`, `shanghai` |
| 北京 (Beijing) | `101010100` | `北京`, `beijing` |
| 杭州 (Hangzhou) | `101210100` | `杭州`, `hangzhou` |
| 苏州 (Suzhou) | `101190400` | `苏州`, `suzhou` |

**Finding more city codes**: do not guess or reuse codes copied from other sites' "BOSS直聘
city code" tables floating around online without verifying — verify by running a search with
the candidate code and checking that the returned `.company-location` text actually contains
the expected city name, e.g.:

```js
await gotoAndWait(`https://www.zhipin.com/web/geek/jobs?query=安全&city=<candidate-code>`, { timeout: 25, settle: 2 })
await wait(1)
await js(`[...document.querySelectorAll('li.job-card-box .company-location')].slice(0,3).map(e=>e.innerText)`)
```

Add the verified code to `CITY_CODES` in `cli/src/helpers.ts` once confirmed.

### Result DOM (verified against a live page dump, 2026-07)

Each result is `li.job-card-box`:

```html
<li class="job-card-box">
  <div class="job-info">
    <div class="job-title clearfix">
      <a href="/job_detail/<id>.html" class="job-name">安全运营工程师</a>
      <span class="job-salary">-K</span>          <!-- MASKED, see below -->
    </div>
    <ul class="tag-list">
      <li>1-3年</li>                               <!-- experience -->
      <li>本科</li>                                 <!-- education -->
    </ul>
  </div>
  <div class="job-card-footer">
    <a href="/gongsi/<hash>.html" class="boss-info">
      <span class="boss-name">NIO蔚来</span>
    </a>
    <span class="company-location"> 上海·嘉定区·安亭 </span>
  </div>
</li>
```

**Salary is masked in the list view.** `.job-salary`'s text is a literal placeholder like
`-K` regardless of the real range shown visually elsewhere on the page (BOSS直聘 renders the
real figure as a canvas overlay, not as this DOM node's text) — treat any value with no
digits as missing data (`realSalary()` in `helpers.ts` does this). Only the detail page shows
the real salary.

**No posting date is shown anywhere in the list UI** — there's nothing to map `--jobage` to.

**No pagination controls were observed** beyond the first result batch (and `?page=` is
separately robots.txt-disallowed as a URL param anyway) — `--page` is accepted for
CLI-contract compatibility but currently has no effect.

## Detail

```
https://www.zhipin.com/job_detail/<id>.html
```

`<id>` is an opaque alphanumeric hash (may contain `-` and `~`), not a sequential number.

### Result DOM (verified against a live page dump, 2026-07)

```html
<div class="info-primary">
  <div class="name">
    <h1 title="安全运营工程师">安全运营工程师</h1>
    <span class="salary">25-40K</span>              <!-- REAL, unmasked here -->
  </div>
  <p>
    <a class="text-desc text-city" href="/shanghai/">上海</a>
    <span class="text-desc text-experiece">1-3年</span>   <!-- sic: "experiece" typo in the site's own class name -->
    <span class="text-desc text-degree">本科</span>
  </p>
</div>
...
<div class="location-address">上海嘉定区蔚来汽车</div>
...
<div class="sider-company">
  <div class="company-info">
    <a title="NIO蔚来" href="/gongsi/<hash>.html">...</a>
  </div>
</div>
...
<div class="job-sec-text">职位描述...</div>          <!-- see anti-scraping note below -->
```

Company name fallback: `document.title` is `「<job title>招聘」_<company>招聘-BOSS直聘` —
parsed by `companyFromTitle()` when the sidebar selector comes up empty.

### Anti-scraping text injection in the description (important)

The raw HTML of `.job-sec-text` contains invisible watermark spans injected **mid-word**,
e.g. the literal DOM is `职位描<span class="zpsWpGDSH">BOSS直聘</span>述` for what a user sees
as just "职位描述". These spans are not visible on the rendered page (some CSS
visibility/size trick hides them) but **are** present in `.textContent`/raw HTML/regex
matches against the page source.

**Always read description text via `el.innerText`, never `el.textContent` or regex on raw
HTML.** `.innerText` is CSS-visibility-aware and returns what a human actually sees, which
correctly excludes this injected noise. This is the main reason a static-HTML regex parser
(the pattern `linkedin-search` uses) would not work cleanly here even if the login-wall
problem didn't already rule it out — the anti-scraping layer specifically targets raw-HTML
extraction.

Even with `.innerText`, at least one posting during investigation still showed a garbled
fragment in the middle of its requirements list (reordered/interleaved characters, a
different obfuscation from the mid-word injection above) — treat `description` as
"generally clean, occasionally locally garbled," and sanity-check anything you're about to
act on (e.g. quoting a JD verbatim) against the live page.

## Notes / quirks

- **First navigation to a search URL sometimes renders job cards as empty `<canvas>`
  skeleton placeholders** instead of the real DOM described above, if the SPA hasn't
  finished hydrating. Always use `gotoAndWait(url, { timeout: 25, settle: 2 })` plus one
  extra `await wait(1)` before extracting; if you still see `<canvas>` where `li.job-card-box`
  should be, reload once more.
- Salary masking (list) and description watermarking (detail) both appear to be deliberate
  anti-scraping measures, not rendering bugs — expect BOSS直聘 to keep iterating on these; if
  extraction starts returning garbage, re-verify the selectors against a fresh live page dump
  before assuming the parsing code is wrong.
