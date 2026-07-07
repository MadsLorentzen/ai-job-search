---
date: 2026-06-24
type: note
trigger: understanding why cowork left some staged roles in triage instead of applying
tags: [search-journal, cowork, automation, referrals, linkedin]
---

# Note — how the Claude Cowork auto-apply system actually behaves

## What happened
Cowork worked through a staged batch and submitted some roles but left others in triage. At first this looked like an ATS-compatibility problem (it submitted Ashby but parked Greenhouse/Lever/LinkedIn). AJ clarified the real behavior.

## Why — the honest read
- **Triaged ≠ failed.** Cowork is instructed to **double-check the coach referral database before submitting**, and it **routes roles-that-have-a-path away from cold apply** (into the warm track). The "parked" roles weren't submission failures — they were the warm pipeline working as designed. It even finds paths that weren't documented on the card yet.
- **The one hard blocker is LinkedIn.** Cowork cannot submit on LinkedIn. So LinkedIn-sourced roles won't auto-apply regardless. ATS forms (Greenhouse / Lever / Ashby) all submit fine.
- My earlier "Ashby-only" theory was wrong — it was referral-routing + the LinkedIn blocker, not an ATS-type issue.

## What it means for the search
- **Don't over-engineer referral pre-filtering during sourcing** — cowork is the backstop and catches undocumented paths.
- **Prefer ATS-form roles over LinkedIn** when staging for auto-apply. When a good role is LinkedIn-only, resolve it to its real ATS posting (probe greenhouse/lever/ashby) so cowork can submit; if there's no public ATS board, it's a manual application.
- The auto-apply queue should hold genuinely cold-submittable roles; warm-path roles belong in the referral track.

## Actions / adjustments
- [x] Re-key LinkedIn browser-finds to their real ATS application URLs where a board exists.
- [x] Move LinkedIn-only / no-public-board roles to triage as manual-apply candidates.
- [ ] Keep watching cowork's Greenhouse/Lever reliability across more runs to confirm it's consistent.

## To revisit
- After more overnight runs: confirm the submit/route split holds, and whether any non-LinkedIn ATS types give cowork trouble.
