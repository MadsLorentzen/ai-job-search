---
name: zhaopin-search
version: 1.0.0
description: >
  Search public Zhaopin (智联招聘) job listings or read one public job detail
  page in China. Use for Chinese job discovery when a read-only public page is
  sufficient. Do not use for login, CAPTCHA bypass, bulk crawling, messaging,
  or automatic applications.
context: fork
enabled: true
allowed-tools: Bash(bun run .agents/skills/zhaopin-search/cli/src/cli.ts *)
---

# Zhaopin Search

This skill reads public `zhaopin.com` HTML pages. It has no credential, cookie,
browser-session, or application-submission capability.

## Commands

```bash
bun run .agents/skills/zhaopin-search/cli/src/cli.ts search --query "Python 后端" --city 北京 --limit 10 --format table
bun run .agents/skills/zhaopin-search/cli/src/cli.ts detail CC641354530J40867394510
```

`search` supports `--query/-q`, `--city/-c`, `--page/-p`, `--limit/-n`,
`--jobage`, and `--format json|table|plain`. `detail` accepts an ID or full
`jobdetail` URL. JSON output uses the shared standard job fields and preserves
the original salary and location strings.

All failures are JSON on stderr with a non-zero exit code. Login, CAPTCHA, and
empty/structurally degraded pages are reported as errors rather than saved as
jobs. Requests are low-frequency and read-only.
