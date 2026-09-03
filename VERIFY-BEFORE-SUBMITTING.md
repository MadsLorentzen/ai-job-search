# Verify Before Submitting

Claims Caroline flagged during `/setup` as needing confirmation, plus gaps `/setup` could not fill.
**Nothing on this list may appear in a submitted CV, cover letter or application answer until it is confirmed.**
The generated profile files deliberately exclude every unconfirmed figure below.

Tick an item, move the confirmed fact into `.claude/skills/job-application-assistant/01-candidate-profile.md`, and delete the line here.

## Blocking — figures that appear in older CV versions but are not yet verified

- [ ] **~CAD 38,000 projected cost reduction** (JY Construction) — what was the baseline, over what scope, and was it projected or realized?
- [ ] **Engagement values up to ~CAD 568,000** — is this a single engagement, and is it contract value or a quotation?
- [ ] **13 active projects within the 20+ portfolio** — as of when? Portfolio size moves.
- [ ] **"Quotation cycle reduced from days to hours"** — needs the measured before-state and the workflow's current status. Without both, this reads as marketing.
- [ ] **Which multi-agent components are actually live vs prototype** — recorded as "some live, some prototype". Name the live ones and the count so the CV can say "N workflows in active use" instead of hedging.
- [ ] **Realized saving from combining Victoria travel/ferry/accommodation** (Burger King #8515 + New York Fries #3302) — currently written as an identified efficiency, not a figure.

## Blocking — facts that change what documents may say

- [ ] **UBC degree conferral date** — check the Student Service Centre. Until confirmed, no document may say the degree was conferred or awarded; `Bachelor of Commerce, 2022-2026` is the safe form.
- [ ] **UBC Chinese Debate Club** — which term was President, which was Event Coordinator. Currently shown as one combined entry.
- [ ] **Jobster.il** — confirm the company name spelling and the actual location. `.il` is the Israeli TLD, and the role is listed as Vancouver/remote.
- [ ] **Debate championship award** — exact name, level and year, for the Honors and Awards section.

## Non-blocking — needed before these can be used at all

- [ ] **Certifications** — none recorded. Asked twice during `/setup`. If genuinely none, that is an `/upskill` input.
- [ ] **GitHub URL** — omitted from the CV. Add it or confirm it stays off.
- [ ] **References** — none recorded. Name, title, company, relationship, contact.
- [ ] **Independent AI projects** — URLs, repositories, tech stack, user numbers, deployment and privacy status, before presenting as a portfolio.
- [ ] **UBC Asian Studies events** (Laneige Campus Beauty Ambassador; "Worlds, Food and Culture") — attendance, exact responsibilities, dates, outcomes.
- [ ] **RedNote analytics** — the recorded figures (~732,600 impressions / 26 days; ~300,000 views / 5 months; ~53,100 likes and saves; 2,000+ followers) may span different reporting windows and must not be combined until checked.
- [ ] **Lofter figures** — 10M+ views, ~250,000 readers, 6,000+ followers, 500,000+ words, and the Harry Potter: Magic Awakened campaign name and its second-place ranking.
- [ ] **Behavioral free-text answers** — best environment, what drains you, decision style, what you want to be better at. `02-behavioral-profile.md` currently leans on MBTI inference; these four answers would replace it with something real. Re-run `/setup --section behavioral`.
- [ ] **Target companies to monitor** — none recorded; `/scrape` currently searches by role and skill only.

## Standing guardrails (not a checklist — these never expire)

See the **Claim Guardrails** section of `CLAUDE.md`. In short: coordination not ownership; no personally-performed trade, engineering or construction work; no engineering design ownership; no SAP architecture authority; no senior accounting framing; no advanced SQL, ML, RAG, API or production-integration claims; always distinguish deployed from prototype from planned.
