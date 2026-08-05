# We Work Remotely RSS — endpoint reference

Verified live on 2026-08-04.

## Endpoints

| Purpose | Method | URL |
|---------|--------|-----|
| All jobs | GET | `https://weworkremotely.com/remote-jobs.rss` |
| Per category | GET | `https://weworkremotely.com/categories/<slug>.rss` |
| Job detail | — | **Does not exist.** Descriptions ship inside the RSS. |

No authentication or API key. Responses are RSS 2.0 XML.

## Category slugs — the one real server-side filter

All verified HTTP 200 on 2026-08-04:

```
remote-programming-jobs              200
remote-design-jobs                   200
remote-devops-sysadmin-jobs          200
remote-customer-support-jobs         200
remote-sales-and-marketing-jobs      200
remote-product-jobs                  200
remote-management-and-finance-jobs   200
all-other-remote-jobs                200
```

Selecting a category feed genuinely narrows the source — unlike Remotive, where
the documented filter parameters are ignored. `resolveCategory` also accepts short
forms (`programming` → `remote-programming-jobs`) and rejects anything it cannot
resolve rather than silently falling back to the all-jobs feed.

There are **no query parameters** on these feeds, so `--query`, `--region` and
`--jobage` are client-side.

## Feed size

The combined feed returned **100 `<item>` entries**. This is a fixed-size recent
window, not page 1 of an archive — there is no pagination parameter and older
postings simply fall out.

## Item structure

```xml
<item>
  <media:content url="https://wwr-pro.s3.amazonaws.com/logos/…/logo.gif" type="image/png"/>
  <title>Porkbun: Content Creator &amp; Video Producer</title>
  <region>Anywhere in the World</region>
  <country>🇺🇸 United States of America</country>
  <state>Oregon</state>
  <skills>Video Production, Animation, …</skills>
  <category>All Other Remote</category>
  <type>Full-Time</type>
  <link>https://weworkremotely.com/remote-jobs/porkbun-content-creator-video-producer</link>
  <guid>https://weworkremotely.com/remote-jobs/porkbun-content-creator-video-producer</guid>
  <pubDate>Tue, 04 Aug 2026 22:47:08 +0000</pubDate>
  <description>&lt;img …/&gt;&lt;p&gt;&lt;strong&gt;Headquarters:&lt;/strong&gt; …</description>
</item>
```

## Field mapping

Anchors that `helpers.ts:parseFeed` depends on.

| Contract field | RSS tag | Notes |
|----------------|---------|-------|
| `id` | slug from `<link>` | e.g. `stripe-backend-engineer-ai-security`. `<guid>` is the same URL. |
| `title` | `<title>` after the first `:` | see quirk |
| `company` | `<title>` before the first `:` | see quirk |
| `location` | `<country>` → `<region>` | prefers the specific country |
| `date` | `<pubDate>` | RFC-822 → ISO |
| `url` | `<link>` | |
| `category` | `<category>` | e.g. `Back-End Programming` — finer-grained than the feed slug |
| `jobType` | `<type>` | `Full-Time`, `Contract`, … |
| `skills` | `<skills>` | comma-separated free text |
| `region` | `<region>` | broad eligibility, e.g. `Anywhere in the World`, `USA Only` |
| `country` | `<country>` | may carry a flag emoji prefix |
| `description` (detail) | `<description>` | double-escaped HTML |

## Quirks

- **The employer lives in `<title>` as `"Company: Job Title"`.** There is no separate company tag. `splitTitle` splits on the **first** colon only — splitting on the last, or on every colon, breaks titles like `"Acme Corp: Engineer: Platform"`. Company names may contain commas (`"Gusto, Inc."`), so comma-splitting is also wrong.
- **`<description>` is double-escaped HTML.** `decodeHtmlEntities` deliberately replaces `&amp;` **last**; doing it first turns `&amp;lt;` into `<` and over-decodes real content.
- **`<country>` may carry a flag emoji** (`🇺🇸 United States of America`). Harmless, but it means `country` is not a clean identifier.
- `<state>` exists on some items and is not currently mapped.
- **No per-job endpoint.** `detail` scans feeds for the slug. With no `--category` it tries the combined feed then each category feed in turn — nine requests worst case, so pass `--category` when known.
- A posting can be absent from the combined feed but present in its category feed, since each window is independent.
