# url-reference.md — zhipin-search (BOSS直聘)

Data source: the user's logged-in BOSS直聘 session via Chrome CDP. Read-only.

## Access

- CDP HTTP endpoint: `http://127.0.0.1:9222` (override with `ZHIPIN_CDP_URL`)
- Requires Chrome launched with `--remote-debugging-port=9222 --remote-allow-origins=*`
  and logged into BOSS直聘.
- Flow: `PUT /json/new` to open a tab → WebSocket to `webSocketDebuggerUrl` →
  `Page.navigate` → poll `Runtime.evaluate` until content renders → extract →
  `GET /json/close/<id>`.

## Search page

- URL: `https://www.zhipin.com/web/geek/job?query=<q>&city=<code>&page=<n>`
  (redirects to `/web/geek/jobs` — same params).
- Params:

| param | meaning |
|-------|---------|
| query | keyword search |
| city  | city code (see table below) |
| page  | 1-indexed page |

- Rendering: Vue SPA; job cards render asynchronously. Poll for
  `li.job-card-box` before extracting.
- robots.txt disallows `/*?query=*` and `/job_detail/*` for crawlers — this skill
  does not crawl anonymously; it reads the user's own logged-in session.

## Job card selectors (verified against live DOM, 2026-08)

| field   | selector                      |
|---------|-------------------------------|
| card    | `li.job-card-box`             |
| link    | `a[href*="/job_detail/"]`     |
| title   | `.job-name`                   |
| salary  | `.job-salary`                 |
| company | `.boss-name`                  |
| area    | `.company-location`           |

## Salary obfuscation (search list only)

The search-list salary is rendered via a **custom obfuscating font**
(`kanzhun-mix` / `kanzhun-Regular`): the digit glyphs are mapped to Private-Use-Area
codepoints, so `textContent` returns garbled glyphs (e.g. `30-50K·15薪` shows as
`-K·薪`), and the same digit maps to multiple codepoints (defeats a fixed
lookup table). Decoding requires parsing the font's cmap + glyph names — not yet
implemented.

**The detail page does NOT obfuscate salary** — `.salary` there returns clean text
(e.g. `30-60K·15薪`). Fetch `detail <id>` for the real salary.

## Detail page

- URL: `https://www.zhipin.com/job_detail/<id>.html`
- Selectors (verified):

| field       | selector                                            |
|-------------|-----------------------------------------------------|
| title       | `h1`                                                |
| salary      | `.salary` (clean text)                              |
| company     | `.company-info a[href*="/gongsi/"]` → `title` attr  |
| location    | `.location-address`                                 |
| description | `.job-sec-text` (`.innerText`, excludes hidden junk)|

- The detail page top header shows an anonymized company name (`某500强上市公司`);
  the real name lives in the `公司基本信息` section, reachable via the
  `.company-info a[href*="/gongsi/"]` `title` attribute.
- The description text contains anti-scrape `<span>`s (hidden junk like `直聘`,
  `boss`, plus visible spans wrapping single characters). `.innerText` correctly
  excludes the hidden (`display:none`) junk.

## City codes (上海 verified; others best-effort — confirm via the `city=` param)

| city | code      |
|------|-----------|
| 上海 | 101020100 |
| 北京 | 101010100 |
| 杭州 | 101210100 |
| 深圳 | 101280600 |
| 广州 | 101280100 |
| 南京 | 101190100 |
| 苏州 | 101190400 |
| 成都 | 101270100 |
| 武汉 | 101200100 |
| 西安 | 101110100 |
