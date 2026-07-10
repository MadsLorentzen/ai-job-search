# Pracuj.pl API Reference

Pracuj.pl uses heavily obfuscated SSR (Server Side Rendering) and Cloudflare anti-bot protection.

## Search
Typical URL format: `https://www.pracuj.pl/praca/[keyword];kw/[city];wp?rd=30`

Fetching this directly via CLI `fetch()` or `curl` results in a Cloudflare JS challenge.

### Possible Workarounds:
1. Use `puppeteer` or `playwright` to load the page and extract the `__NEXT_DATA__` JSON blob from the DOM.
2. Intercept requests from the mobile application.

## Detail
Typical URL: `https://www.pracuj.pl/praca/[slug],oferta,[id]`
Same Cloudflare restrictions apply.
