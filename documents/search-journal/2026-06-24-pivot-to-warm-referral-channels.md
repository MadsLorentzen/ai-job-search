---
date: 2026-06-24
type: decision
trigger: search assessment after ~22 cold auto-applies (1 rejection, 0 advances)
tags: [search-journal, strategy, referrals, cold-apply]
---

# Decision — pivot effort from cold-apply volume to warm/referral channels

## What happened
After the cowork system auto-applied to ~22 roles and AJ inquired about referrals at 3, the early results were 1 form rejection and no advances. We stepped back to assess rather than keep scaling cold volume.

## Why — the honest read
- **Activity isn't progress.** 22 submissions feels like momentum, but for a senior, nonlinear (founder → VP → engineer) profile the metric that matters is *conversations*, and those come disproportionately from warm channels, not the ATS pile.
- **The cold:warm ratio was inverted.** 22 cold vs. 3 referral. Cold ATS apps convert at ~1–3%; senior roles especially are filled through network and recruiter relationships.
- **We were excluding our best targets.** The Upward coach dashboard has referral capacity at strong companies (Salesforce 23, Capital One 18, Adobe 15, NVIDIA 10, Figma, Stripe, Coinbase, Airbnb…) — and we'd been filtering those *out* of the pipeline because they "had a path." That path is the point.

## What it means for the search
The auto-apply machine is worth keeping for coverage, but it's not where the search gets won. The high-conversion paths are warm/referral (a human reads the profile in context) and tight-fit (clean keyword + level match). Shift the week's effort there.

## Actions / adjustments
- [x] Build a `referral_request_ready` pipeline stage (drafted ask, not yet sent) between triaged and referral_pending.
- [x] Surface high-fit roles that sit at coach-dashboard companies; draft warm asks in AJ's voice.
- [ ] Flip the cold:warm ratio — turn 3 referral inquiries into 12–15.
- [ ] Tighten cold-apply to clean-match roles only.
- [ ] Nurture the OpenAI thread (final-round, active pipeline) — highest-value warm lead.
- [ ] Instrument the funnel by channel + fit-tier; revisit in ~2 weeks.

## To revisit
- 2-week funnel review: cold vs. referral vs. inbound conversion. Double down on the winner; cut the medium-fit cold long tail if it stays at ~0.
