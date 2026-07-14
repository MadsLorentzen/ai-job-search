# Test fixtures

Real HTML captured **once** from LinkedIn's public `jobs-guest` endpoints via the
CLI's own `htmlFetch`. These are deliberately **not** hand-written: the parsers are
regex-based against LinkedIn's real markup, so a hand-made fixture would test our
assumptions rather than the actual page shape.

| File | Source | Captured |
| --- | --- | --- |
| `search-list.html` | `search --query "agentic ai engineer" --location Italy --jobage 14 --remote remote` (`seeMoreJobPostings/search`) | 2026-07-14 |
| `detail-orbis.html` | `detail 4345841651` (`jobPosting/4345841651`) — the "Agentic AI Engineer – Full remote – Europe" @ Orbis Group posting that was still open in AIV-977 (`first_seen 2026-07-06`) | 2026-07-14 |

## Regenerating

Fixtures are static and versioned; regenerate only when LinkedIn's markup changes
and a parser test starts failing for the right reason. From the `cli/` directory:

```ts
// capture.ts (throwaway)
import { htmlFetch, SEARCH_URL, DETAIL_URL } from "./src/helpers.ts"
await Bun.write(
  "test/__fixtures__/search-list.html",
  await htmlFetch(`${SEARCH_URL}?keywords=agentic%20ai%20engineer&location=Italy&f_TPR=r1209600&f_WT=2&start=0`),
)
await Bun.write("test/__fixtures__/detail-orbis.html", await htmlFetch(`${DETAIL_URL}/4345841651`))
```

`bun run capture.ts`, then update the expected values in the tests to match. Keep
volume low — this hits LinkedIn's public pages (personal use only, LinkedIn ToS).
