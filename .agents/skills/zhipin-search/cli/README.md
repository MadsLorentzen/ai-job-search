# zhipin-search CLI

Search BOSS直聘 (zhipin.com) through **your own logged-in Chrome session** via the
Chrome DevTools Protocol (CDP). Read-only: `search` and `detail`.

Unlike the other portal CLIs in this repo, this one does **not** scrape an
anonymous HTTP endpoint. BOSS直聘 is login-walled and anti-bot protected, so the
CLI drives a real Chrome window you have already logged into, and reads the
rendered page. Zero runtime dependencies: just `bun`, which supplies `fetch` and
`WebSocket`.

## Prerequisite

Launch Chrome with remote debugging enabled, logged into BOSS直聘:

```bash
open -a "Google Chrome" --args --remote-debugging-port=9222 \
    --remote-allow-origins=* --user-data-dir="$HOME/zhipin-chrome-profile"
```

- `--remote-allow-origins=*` is required on Chrome 111+ (CDP WebSocket rejects
  connections without it).
- `--user-data-dir` isolates this session from your daily profile so you don't
  clobber your normal tabs; use the same dir next time to stay logged in.

## Usage

```bash
bun run src/cli.ts search -q "算法工程师" -l 上海 --format table
bun run src/cli.ts search -q "AI平台" -l 101020100 --limit 20 --format json
bun run src/cli.ts detail f902a6107a7a3a6b0nF839q0GVBW --format plain
```

## Notes

- **Read-only.** There is no `apply` command and none is planned; use it to find
  and read postings, then apply manually.
- Keep volume low. This uses your own account; treat it as you would manual
  browsing.
- If the DOM selectors in `src/helpers.ts` stop matching (BOSS直聘 changes its
  markup), the CLI returns zero results rather than crashing. Update the
  selectors and `url-reference.md` together.
