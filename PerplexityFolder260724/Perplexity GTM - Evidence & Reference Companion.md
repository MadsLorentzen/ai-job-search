# Evidence Pack — Perplexity GTM Discussion

Companion document to _Thoughts on Perplexity GTM for discussion_. Organized to mirror that doc's section order so evidence sits directly under the claim it supports. Bare research outline from the original Appendix is expanded into cited entries; the "Archive" section (skeletal outline of my working notes) is reformatted at the end as a working-notes register for anything the main doc referenced but did not source in-line.

Two conventions:

- **Citations are inline as markdown links** on the fact they support. Where a table or list carries a shared citation, the citation appears once in the section preamble.
- **Numbers are point-in-time.** Everything here reflects publicly available data as of late-July 2026. Where sources report a range, I take the middle of the range and cite both endpoints.

---

## Perplexity's Position — supporting evidence

### Consumer market share and referral position

The claim in the doc is that Perplexity's consumer reach has slowed and may be a temporary source of brand lift. The evidence:

- ChatGPT commands approximately 52-77% of AI-chatbot activity depending on methodology; Gemini ~27%; Claude ~9%; **Perplexity approximately 1.3% by web traffic and falling** ([Momentic on SimilarWeb data](https://momenticmarketing.com/blog/top-ai-chatbots); [fatjoe/SimilarWeb](https://fatjoe.com/blog/perplexity-ai-stats/)).
- **Gemini overtook Perplexity as the #2 source of AI-chatbot referrals in March 2026**, and Perplexity's referral share has fallen more than 40% from its April 2025 peak ([Statcounter press release](https://gs.statcounter.com/press/google-gemini-overtakes-perplexity-to-become-second-largest-source-of-ai-chatbot-referrals-to-websites)).
- Cloudflare's "actively-chosen traffic" metric suggests **brand pull among engaged users runs meaningfully higher than aggregate share would predict** ([Cloudflare via AI Business Weekly](https://aibusinessweekly.net/p/ai-market-share-2026)).

### Enterprise market share and revenue asymmetry

The doc argues Perplexity's brand recognition is disproportionate to its market share, which is the arbitrage that makes the upmarket move possible. The evidence:

- **Anthropic earns an estimated 40% of enterprise LLM spend** to Perplexity's low-single-digit share and wins approximately 70% of head-to-head first-time enterprise deals ([Menlo Ventures 2025 Enterprise Report](https://menlovc.com/wp-content/uploads/2025/12/menlo_ventures_enterprise_ai_report-2025-123125.pdf); [Ramp AI Index March 2026](https://ramp.com/data/ai-index-march-2026)).
- Perplexity trades at roughly **$20-23B** ([Teahose](https://www.teahose.com/guides/perplexity-valuation); [Value Add VC](https://valueaddvc.com/blog/perplexity-ai-valuation-revenue-2026-23b-450m-arr)) versus **Anthropic at ~$965B and OpenAI at ~$852B** ([NYT](https://www.nytimes.com/2026/05/28/technology/anthropic-tops-openai-valuation.html); [Forbes](https://www.forbes.com/sites/antoniopequenoiv/2026/05/28/anthropic-is-now-worth-almost-1-trillion-more-than-openai/)) — roughly 2-3% of their combined market cap.
- **No clean cross-population brand survey exists** comparing Perplexity to the frontier labs; the "third or fourth company mentioned in almost every generalist AI conversation" claim is inference from proxies: press coverage cadence roughly on par with Anthropic, and actively-chosen traffic among engaged users.

### Perplexity's own GTM stack (referenced verbatim in the doc)

Compiled from Perplexity's public job postings ([Perplexity careers page](https://www.perplexity.ai/hub/careers)):

- **Salesforce** — CRM system of record.
- **Snowflake** — data warehouse.
- **Apollo, Clay, Unify** — outbound data enrichment and sequencing (Lead Generation Specialist JD).
- **LinkedIn Sales Navigator** — prospecting.
- **Hightouch / Census** — reverse ETL (Sales Systems Engineer JD).
- **Looker / Omni / Hex** — BI (Demand Gen Lead JD).
- **Workato** — workflow automation (Sales Systems Engineer JD).

Warehouse-native and reverse-ETL-driven rather than traditional-MAP-driven. Modern, engineering-forward configuration. Compilation done via Perplexity Computer.

---

## The State of GTM — supporting evidence

### The four eras of B2B demand gen

Provided in the doc as context for why AI-era GTM is not a variation of the previous shape. Sources for the era boundaries:

1. **MQL-factory era (~2006–2018).** Marketo/HubSpot-driven lead scoring. Success measured as MQL volume passed to sales. Funnel-shaped, linear, lead-centric ([HubSpot founding story](https://www.hubspot.com/company/about), [Marketo history](https://en.wikipedia.org/wiki/Marketo)).
2. **Account-based era (~2016–2021).** SiriusDecisions/Terminus/6sense push toward targeting named accounts and buying committees. ABM tiers (1:1, 1:few, 1:many) become standard vocabulary ([Forrester on ABM history](https://www.forrester.com/what-it-means/ep154-forresters-2020-abm-predictions/)).
3. **Intent-data era (~2019–2023).** Third-party intent signals (Bombora, G2, TechTarget) layered onto ABM. "Signal-based selling" emerges as a category term.
4. **AI-native era (2023–2026).** LLM-driven personalization at scale, AI SDRs/agents, programmatic outbound, dark-funnel measurement problems, MQL rejected as primary metric in favor of buyer-group and signal models ([Kyle Poyar / Growth Unhinged 2025 State of B2B GTM](https://www.growthunhinged.com/p/2025-state-of-b2b-gtm-report)).

### The new operating model

Every credible GTM voice converges on the same shape:

- Owned, high-quality artifacts (Spaces, changelogs, research reports, templates) engineered for AI discoverability, not just Google.
- Individual-brand distribution — founders, engineers, functional experts posting under their own names, not the company page.
- Signal-triggered, human-in-the-loop outbound replacing volume sequences.
- Product-led loops measured by trial-to-first-value, not MQL count.
- Consumption / outcome pricing alongside or replacing per-seat pricing.
- Incrementality testing (geo, holdout, matched cohort, MMM) replacing multi-touch attribution.
- Developer or community substrate as the durable moat that compounds regardless of channel volatility.

Sources: [Chris Walker on revenue attribution and dark funnel](https://www.linkedin.com/posts/chriswalker171_revenue-attribution-sales-activity-7138525823707320320-5-cn); [Kyle Poyar / Growth Unhinged 2025 report](https://www.growthunhinged.com/p/2025-state-of-b2b-gtm-report); [Sangram Vajre / GTM Partners](https://gtmpartners.com/); [Jason Lemkin / SaaStr](https://www.saastr.com/).

### Old model vs new model

|Departing-era GTM (2015-2023)|Perplexity's GTM (2026-2028)|
|:--|:--|
|MQL volume as primary scorecard|Trial-to-first-value + retention as primary scorecard|
|Multi-touch attribution|Marketing mix modeling + geo-holdout + matched cohort|
|LinkedIn company page as broadcast channel|Employee/founder individual channels; company page as archive|
|Per-seat expansion as sole growth lever|Per-seat + consumption + outcome, buyer's choice|
|Cold outbound at volume|Signal-triggered, human-in-the-loop outbound only|
|Marketing automation suites (Marketo, Pardot)|Composable stack (Common Room + Clay + Perplexity Agent API)|
|SEO for Google-indexed content|AEO for LLM-cited content, with SEO as byproduct|
|Analyst reports (Gartner, Forrester) as authority|Owned research index (Verification Index) + LLM citation frequency|
|Case studies as PDFs|Case studies as Perplexity Spaces engineered for LLM legibility|
|ABM based on firmographic scoring|Signal-based selling on behavioral + intent + product-signal data|
||

### Why MMM is back

- Multi-touch attribution now sees an estimated **30–60% of actual touchpoints** at best due to third-party cookie deprecation, Apple's App Tracking Transparency, and general signal loss ([The Matchbox on MMM adoption](https://www.thematchbox.inc/resources/marketing-mix-modeling-guide)).
- Google open-sourced **Meridian** (Bayesian causal MMM) in early 2025, and Meta's **Robyn** offers a comparable package — collapsing the traditional six-figure-consulting entry cost.
- In a TransUnion survey reported by eMarketer, **46.9% of US brand and agency marketers plan to invest in MMM** over the next year, and **27.6% now name it their single most reliable measurement method** (ahead of MTA's 19.4%) ([The Matchbox](https://www.thematchbox.inc/resources/marketing-mix-modeling-guide)).
- IAB published a vendor-neutral "Modernizing MMM" best-practice guide in December 2025.
- eMarketer separately reports **71% of brands have reduced reliance on user-level data** as of 2025.

**2026 consensus is triangulation, not replacement:** MMM for strategic budget allocation, incrementality testing (geo/holdout) as causal ground truth, MTA retained only for tactical in-platform optimization where tracking still functions.

### Lead-based to account/buyer-group shift

Forrester's own data shows **95% of B2B purchases involve 3+ people across 2+ departments**. Lead-level scoring systematically undercounts real buying activity — five contacts from the same account each triggering a "new lead" fragments what is actually one deal. Practitioners are converging on scoring and routing at the **account** or **buying-group** level.

### Signal precision critique

Third-party intent-data precision against actual buyer behavior is estimated at only **30–40%** ([Leadgen Economy on AI SDR failure forensics](https://www.leadgen-economy.com/blog/ai-sdr-cancellation-wave-failure-forensics/)), which is why first-party product-usage and community signals are displacing them as trusted inputs. An estimated **64% of B2B organizations lack a formal UTM tagging policy** (Gartner via aggregator sources) — the input-hygiene problem often matters more than the modeling choice.

### Attribution model reference

|Model|Mechanic|Best fit|
|:--|:--|:--|
|First-touch|100% credit to first interaction|Simple top-of-funnel channel comparison|
|Last-touch|100% credit to final interaction before conversion|Simple, but systematically overweights bottom-funnel/branded-search channels|
|Multi-touch (linear)|Equal credit across all touches|Fairer but ignores stage importance|
|**U-shaped** (position-based)|Heavy credit to first touch + conversion touch, light middle|Common recommendation for 50–250 employee B2B teams|
|**W-shaped**|Heavy credit to first touch, lead-creation touch, opportunity-creation touch|Popular in B2B because it credits the three moments sales/marketing care about most|
|Data-driven / algorithmic|Model-fit credit based on observed conversion paths|Requires volume; degrading in accuracy|
|**Marketing Mix Modeling (MMM)**|Aggregate econometric modeling — no individual-level tracking required|Ascendant in 2025–2026 as user-level attribution degrades|
||

### Product-led metrics reference

|Metric|Definition|
|:--|:--|
|**PQL**|Individual user crossing a usage threshold that predicts conversion|
|**PQA**|Account-level aggregate of PQL-qualified users (commonly 50%+ threshold)|
|**Activation rate**|% of signups reaching a defined "aha moment"/core-value action|
|**Time-to-value (TTV)**|Elapsed time from signup to first realized value|
|**Expansion signal**|Usage crossing a seat/tier threshold (e.g., 80% of licensed seats), triggering an automated upsell motion|
||

Recommended operational trigger from current PLG playbooks: when usage exceeds ~80% of licensed seats or a new business unit is detected inside an account, auto-create a CRM expansion opportunity and notify the AE/CSM rather than waiting for a renewal conversation ([Prospeo on land-and-expand](https://prospeo.io/s/land-and-expand-strategy)).

---

## Parallel Phenomenon: the "Pedagogical Singularity" — supporting evidence

This section is the least-cited in the submitted doc. The claims made and the evidence that supports each:

### Claim 1: The creator economy remains in explosive growth

- The creator economy is estimated at approximately **$313 billion in 2026**, up from roughly $250 billion in 2024, a ~12% CAGR ([Presenc AI on Goldman Sachs TAM analysis](https://presenc.ai/research/creator-economy-market-size-2026); [Graphy Blog aggregating Goldman Sachs](https://graphy.com/blog/creator-economy-stats/)).
- Goldman Sachs projects a total addressable market of approximately **$480 billion by 2027** ([Goldman Sachs 2025 Creator Economy report PDF](https://creatorswithinfluence.com/wp-content/uploads/2025/04/Goldman-Sachs-Global-Investment-Research-Creator-Economy-Framing-Market-Opportunity-Download-Report-March-26-2025.pdf)).
- Global creator economy market valued at **$189.4 billion in 2025** across ad, subscription, sponsorship, merchandise, and crowdfunding revenue ([Dataintelo research](https://dataintelo.com/report/creator-economy-market)).

### Claim 2: Educational content is the winning content category

- **Educational Creator Economy: $154.2 billion in North America in 2025 (~40% of global revenues)** ([Market Intelo educational creator economy report](https://marketintelo.com/report/educational-creator-economy-edu-influencer-monetization-market/amp)).
- Digital education market: **$26 billion in 2024 growing to $133.7 billion by 2030 at ~31% annual growth** ([Graphy Blog](https://graphy.com/blog/creator-economy-stats/)).
- **Finance & Investing Education** is the largest single content category at ~~28.6% of segment revenue (~~$111 billion global in 2025); **Professional Skills Development** is second at ~23.4% including coding, data science, product management, UX, marketing, sales, and AI competencies ([Market Intelo](https://marketintelo.com/report/educational-creator-economy-edu-influencer-monetization-market/amp)).
- Digital products (courses, templates, e-books) carry **70-90% profit margins** ([Graphy Blog](https://graphy.com/blog/creator-economy-stats/)).

### Claim 3: AI is collapsing the content-production skill barrier

The doc's claim: skills (1) entrepreneurial hustle and (2) content-production skill are eroding as differentiators, with AI hitting (2) hardest.

- "AI slop" — the flood of generic machine-made content — has produced a measurable consumer backlash by mid-2026. The market is recalibrating toward "originality, judgment, taste, and proprietary proof." **The advantage moved up the stack** — average content no longer differentiates anyone ([MITPO on the post-AI-slop backlash](https://www.mitpo.io/blog/authenticity-is-the-new-moat-post-ai-slop-2026)).
- University of Florida research on "AI slop" documents specific consumer and creator harms from low-quality generative content flooding platforms ([University of Florida News](https://news.ufl.edu/2026/03/ai-slop/)).
- MIT Initiative on the Digital Economy research on public regard for AI-created content indicates continued suspicion toward AI-generated material without disclosed provenance ([MIT IDE research brief](https://ide.mit.edu/wp-content/uploads/2023/10/RB__final.pdf)).

### Claim 4: The expected-value calculus for domain experts is tipping toward independent creation

The doc's claim: iterative R&D for content monetization approaches a tipping point where expected value of a "reasonably consistent domain expert" can compete with institutional salaries.

- Erik Hoel, Tufts biology research professor, left his position for full-time Substack — reported his newsletter "replaced 80 percent of his Tufts salary within six months" ([Inside Higher Ed](https://www.insidehighered.com/news/tech-innovation/digital-publishing/2023/07/18/academics-turn-paid-newsletters-scholarly); [Hoel's own announcement](https://www.theintrinsicperspective.com/p/goodbye-academia-hello-substack)).
- Boston College history professor Heather Cox Richardson's _Letters From an American_ has an estimated **$1M-$5M annual revenue from 1.2 million subscribers** ([Inside Higher Ed](https://www.insidehighered.com/news/global/2023/10/13/substack-brave-new-world-academic-publishing)).
- Substack reports **107% year-over-year growth in academic publications** (July 2022–July 2023) and 42% growth in academic paid subscriptions in the same period ([Inside Higher Ed](https://www.insidehighered.com/news/tech-innovation/digital-publishing/2023/07/18/academics-turn-paid-newsletters-scholarly)). UK-based academic paid subscriptions grew **8x year-over-year** ([Inside Higher Ed 2023 followup](https://www.insidehighered.com/news/global/2023/10/13/substack-brave-new-world-academic-publishing)).
- Adjunct pay in US higher education: **average $2,700/class, less than $30,000/year total, ~75% of faculty on non-tenure-track appointments** ([Peter Maguire on the independent scholarship gap](https://petermaguire.substack.com/p/why-i-left-academia-to-help-independent)).
- LinkedIn creator monetization: consulting/services pipeline is the dominant model with **$5K-$50K/month** typical earnings for established B2B creators. Cohort programs ($500-$2,000 seats) can generate **$50K-$200K per cohort** with modest audience ([Earning A Living Online 2026 LinkedIn playbook](https://www.earninglivingonline.com/linkedin-creator-monetization/); [Writio 2026 LinkedIn monetization roadmap](https://writio.ai/blog/how-to-make-money-as-linkedin-creator-2026-monetization-roadmap)).
- LinkedIn creator content is shifting away from "lifestyle" and toward expertise: "**What wins now is expertise, niche authority, personality, and education first content**" ([LinkedIn 2026 Creator Economy report via Alessandro Bogliari](https://www.linkedin.com/posts/alessandrobogliari_the-creator-economy-is-reaching-new-heights-activity-7434607889538850816-8aLU)).
- The rise of **academic and credentialized expert creators as a specific market segment** — driven by academic stagnation and the accessibility gap in higher education — is now being flagged as a category by observers inside the segment ([Shae's Substack on academic/expert content creators](https://open.substack.com/pub/shaeomonijo/p/heres-why-i-believe-humanists-should)).

### Claim 5: Consumer demand is graduating from first-order to second-order content

The doc claims that as AI zeros out entry-level primer content, audience appetites will pull the frontier upward toward second-order skills and non-obvious syntheses.

- LinkedIn 2026 report explicitly documents this shift: "**Lifestyle content is crowded. What wins now is expertise, niche authority, personality, and education-first content. Brands are asking: what value does this creator bring beyond reach?**" ([LinkedIn 2026 Creator Economy report via Alessandro Bogliari](https://www.linkedin.com/posts/alessandrobogliari_the-creator-economy-is-reaching-new-heights-activity-7434607889538850816-8aLU)).
- Post-AI-slop analysis: the winning content signal in 2026 is "a real point of view, original data, specific examples, craft signals, consistency" — all attributes tied to genuine domain fluency, not production budget ([MITPO](https://www.mitpo.io/blog/authenticity-is-the-new-moat-post-ai-slop-2026)).
- The LinkedIn rate-card research finds that **audience seniority and company-size distribution drive 70% of pricing, content format drives 20%, and follower count drives only 10%** ([CreatorScore rate-card research](https://creatorscore.io/rate-card/linkedin)) — a direct empirical read that audience quality (which tracks expertise-signaling content) has displaced audience volume as the pricing lever.

### Claim 6: "Writes" are where the exponential alpha lives

The doc's claim: citations serve "reads" (consumption of cited knowledge), but reputational risk lives in "writes" — where an expert publishes under their own name. This is where the growth flywheel accrues.

- Diagnostic and case-study posts by named experts drive the fastest LinkedIn consulting-lead conversion — described as "the most efficient path" for revenue-attributable content in 2026 ([Writio LinkedIn monetization roadmap](https://writio.ai/blog/how-to-make-money-as-linkedin-creator-2026-monetization-roadmap)).
- LinkedIn's algorithm heavily favors native video and expert-authored content in 2026; **specific-number posts** ("I charged $18,000 for this and here's what I delivered") attract exactly the buyers who want to pay those rates ([Writio](https://writio.ai/blog/how-to-make-money-as-linkedin-creator-2026-monetization-roadmap)).
- LinkedIn "Thought Leader ads" (paid brand amplification of individual expert content) launched as an internal test in 2026, and the BrandLink program shares ad revenue with over 100 creators on video content — confirming platforms are pricing individual expert reach at a premium ([Business Insider on LinkedIn creator features](https://www.businessinsider.com/linkedin-creator-plans-new-features-roadmap-2026-6)).
- The creator power law: **top 1% of creators capture ~90% of total revenue; median creator earns less than $500/year** ([Second Order Effects on the creator power law](https://soe.lagbase.com/entry/M019/); [Mosaic Ventures on the same](https://www.mosaicventures.com/blog/the-creator-economy-a-power-law)). This is the reason the "luminary wedge" exists as a real strategic category — the value is concentrated at the top of the distribution, and the tools that serve the top of the distribution have disproportionate strategic value.

### Interpretive note on the claim as a whole

The evidence supports every empirical premise of the singularity thesis independently, but does not yet prove the emergent claim (that Perplexity specifically will win the substrate role). The core empirical supports:

- Educational content is the largest and fastest-growing creator category (Market Intelo).
- AI is compressing the production-skill differentiator, and post-AI-slop consumer demand is rewarding authenticated expertise (MITPO, UF, MIT IDE).
- Domain experts are increasingly able to replace institutional salaries with independent creator income (Hoel, Cox Richardson, Substack academic-growth stats).
- Consumer demand is measurably graduating up-market from first-order to expertise-signaling content (LinkedIn 2026 report, CreatorScore rate-card research).
- The value in creator economies concentrates at the top 1% (Second Order Effects, Mosaic Ventures).

What is inference rather than data: that Perplexity's citation-first product identity is the specific substrate expert creators will adopt for their production stack. That is a testable claim, and the probe design work (individual-brand pilot for Perplexity employees, then luminary rollout) is the mechanism to test it.

---

## Bones of Strategy — supporting evidence

The doc's seven takeaways are compressions of arguments made earlier. The evidence for each traces back to the corresponding section above. Only the sources that live specifically inside this synthesis need a home here:

- **"Elevated brand outpacing market share"** — see Consumer Market Share and Enterprise Market Share sections above. Cloudflare "actively-chosen traffic" is the sharpest supporting data point.
- **"Reflexive GTM as compounding benefit"** — the Ramp case study ([Perplexity: Ramp](https://www.perplexity.ai/enterprise/customers/ramp)) is the referenced instance in the doc; there is no external validating source for the reflexive-multiplier claim beyond structural argument.
- **"Anti-fragile via incrementality measurement"** — see Why MMM is Back section above.
- **"Luminary wedge / writes as KPI"** — see Pedagogical Singularity section above.

---

## 30/60/90 — reference notes only

The 30/60/90 in the submitted doc is intentionally placeholder-shaped. The evidence-worthy claims embedded in it are:

- **Account-level expansion scoring as first bet:** the JD explicitly names "downstream conversion to revenue" as a metric, and the Sales Systems Engineer JD names the pipeline/infrastructure ownership. **Given tens of millions of users and 50,000+ organizations touching Perplexity's product,** even a rough v1 scoring model (domain-match + seat density + growth rate + persona mix) would likely surface hundreds of qualified expansion accounts not currently being worked. This is the highest-leverage first bet because it organizes demand that already exists rather than generating new top-of-funnel.
- **Signal-based outbound on Pro-user-dense accounts** matches the JD's literal language on "AI-native tooling — programmatic outbound, AI-personalized sequences, intent-based targeting" applied to the highest-quality intent signal available: **existing product usage inside a named account**, materially stronger than Bombora/6sense third-party intent.
- **Shadow-IT-to-Enterprise Comet motion:** Comet Enterprise launched March 2026, directly IT-buyer-facing, with **500+ policy controls and a CrowdStrike partnership** solving governance anxiety for security teams whose employees already use the free Comet browser.
- **Business Fellowship as demand-gen channel:** the program recruits senior GTM/strategy leaders globally (mentors include Jensen Huang, Aaron Levie, Ali Ghodsi) and grants a free Enterprise Pro subscription. Structurally it is a lead-gen and land-and-expand mechanism, but nothing in public material suggests it is being tracked or attributed as a demand-gen channel with ARR influence.
- **Partner enablement rather than partner-competition:** SoftBank's 7,000-person enterprise sales team and Databricks/Snowflake/AWS co-sell motions are effectively pre-built demand capacity that requires enablement rather than displacement.

---

## Illustrative Big Bet: Perplexity Studios — supporting evidence

The doc frames Studios as a distribution primitive with a personal-brand-production component. Supporting research:

- The **top 1% of creators capture ~90% of total revenue** — the value in creator ecosystems concentrates at the top of the distribution, which is why the "luminary" wedge is a real strategic category rather than a segmentation flourish ([Second Order Effects](https://soe.lagbase.com/entry/M019/); [Mosaic Ventures](https://www.mosaicventures.com/blog/the-creator-economy-a-power-law)).
- Ghostwriting for executives has become a category that "didn't meaningfully exist five years ago and now supports thousands of full-time writers" ([PostEverywhere on LinkedIn creator earnings](https://posteverywhere.ai/blog/how-much-do-linkedin-creators-make)) — evidence that individual-brand production is already an established B2B economic category with paid infrastructure, which validates the market for a Perplexity Studios wedge.
- Perplexity Computer's native research substrate is the specific differentiator against OpenClaw / ChatGPT Work / Claude Cowork for personal-brand production because expert content is research-heavy and current orchestration layers have no native research substrate — this is a claim from the doc's earlier writes/luminary section, not from a third-party source.
- Ramp case study ([Perplexity: Ramp](https://www.perplexity.ai/enterprise/customers/ramp)) is the referenced structural precedent for how a reflexive GTM case study functions — dogfooded work becomes a marketing artifact.

---

## Vendor and stack reference

Reference only — the operational tables from the appendix consolidated here so they do not clutter the section flow above.

### ABM / account intelligence

|Vendor|One-liner|
|:--|:--|
|**6sense**|Predictive AI buying-stage modeling; sales-led intent prioritization; Forrester "Leader" in B2B Revenue Marketing Platforms|
|**Demandbase**|Native DSP and account-based advertising; marketing-led paid-media orchestration; Forrester "Leader"|
||

Practical difference: 6sense's predictive/sales orientation vs. Demandbase's advertising/marketing orientation.

### Intent data

|Vendor|One-liner|
|:--|:--|
|**Bombora**|Company Surge intent-signal data aggregated from a co-op of B2B publisher sites|
|**G2**|Buyer-intent signals from product-review research/comparison behavior|
||

Both face the **30–40% precision critique** from third-party intent data cited above.

### Signal / warm outbound

|Vendor|One-liner|
|:--|:--|
|**Common Room**|Aggregates community, product, and firmographic signals into unified warm-lead routing|
|**UserGems**|Tracks champion job changes and warm-network signals to trigger relationship-based outbound|
|**Clay**|Data-enrichment and workflow automation stitching many signal sources for human-run (or lightly AI-assisted) outreach|
|**Koala**|Website/product intent-signal capture for real-time sales alerting|
||

### Marketing automation

|Vendor|One-liner|
|:--|:--|
|**HubSpot**|Dominant in SMB/mid-market; Gartner Magic Quadrant Leader five years running; Pro ~$890/mo, Enterprise ~$3,600/mo|
|**Marketo (Adobe)**|Dominant in enterprise, especially Salesforce-native orgs; implementations commonly $150K–$200K+ first-year TCO|
|**Iterable**|Strong in product-led B2B SaaS for omnichannel lifecycle; Vista Equity-backed; shipped Iterable AI in 2025|
||

### CRM & RevOps

|Vendor|One-liner|
|:--|:--|
|**Salesforce**|Enterprise CRM system-of-record standard; deepest ecosystem of GTM-tool integrations|
|**HubSpot**|CRM native to its marketing automation suite; dominant in SMB/mid-market|
|**Attio**|AI-native, relationship-intelligence-first CRM positioned for modern, fast-moving GTM teams that find Salesforce too heavy|
||

### Chat / conversational

|Vendor|One-liner|
|:--|:--|
|**Drift**|Pioneer of conversational marketing/website chat routed to sales in real time|
|**Qualified**|Salesforce-native conversational marketing for enterprise ABM website engagement|
|**Intercom**|Broader customer messaging spanning marketing, sales, support, with AI agent (Fin) capability|
||

### Content / SEO tooling

|Vendor|One-liner|
|:--|:--|
|**Clearscope**|Content-optimization scoring against target-keyword relevance|
|**Ahrefs**|Backlink and keyword-research suite, widely used for competitive SEO analysis|
|**Semrush**|Broad SEO/content/competitive-intelligence suite, all-in-one alternative to Ahrefs|
||

### Attribution & analytics

|Vendor|One-liner|
|:--|:--|
|**Bizible (Adobe Marketo Measure)**|Legacy enterprise multi-touch attribution, deeply integrated with Marketo|
|**Dreamdata**|Warehouse-native, B2B revenue-attribution rooted in pipeline "revenue science"|
|**HockeyStack**|Unified GTM AI/analytics blending product and marketing data, strong fit for PLG motions|
||

**Dreamdata vs. HockeyStack** is the most-cited head-to-head pairing in 2025–2026. Dreamdata's strength is CRM/pipeline rigor from a data-warehouse foundation; HockeyStack's is blending product-usage data with marketing touchpoints for PLG-hybrid motions.

### CDP / reverse ETL

|Vendor|One-liner|
|:--|:--|
|**Segment**|Category-defining customer data platform for event collection and routing|
|**mParticle**|Enterprise-grade CDP with strong mobile/app data specialization|
|**Hightouch**|Reverse-ETL syncing warehouse data (Snowflake, BigQuery) directly into GTM tools|
||

### Sales enablement

|Vendor|One-liner|
|:--|:--|
|**Gong**|Conversation-intelligence platform recording/analyzing sales calls for coaching and deal-risk signals|
|**Chorus (ZoomInfo)**|Comparable conversation-intelligence, now part of the ZoomInfo suite|
|**Highspot**|Sales-content and enablement focused on asset management and buyer-facing content delivery|
||

---

## Working-notes register (from the doc's archive outline)

Bullet outline from the doc's archive, reformatted as a working-notes register. These are threads I have partial evidence for but did not fully develop in the main doc — kept here as an audit trail of what informed the argument.

**GTM disruption (4 dimensions).** Pricing, build vs buy, channel saturation, AI brand awareness × product velocity. Supporting evidence for each is in the State of GTM section above.

**Structural vs volatile landscape.** Three-class taxonomy: structural (bank on), volatile (build agility for), directional-but-pace-volatile (regulatory implementation, agent-mediated purchasing, open-weight enterprise adoption pace). Not developed in the submitted doc — kept as a reference frame.

**Perplexity's unique position.** Brand asymmetry, model agnostic, citations & accuracy, pricing. All addressed in section 1 of the main doc; supporting evidence in Perplexity's Position section above.

**Related landscape thesis.** Creator-sphere → expert-sphere migration; AI-driven Cambrian "pedagogical" explosion. All addressed in the Pedagogical Singularity section above.

**Perplexity GTM recommendations — system layer.** First principles; anti-fragile via measurement; reflexive via dogfood → build in public → sell use case. All in main doc.

**Perplexity GTM recommendations — strategy layer.** Leverage brand; capture luminary segment (authors, PhDs, Substack, airport lounges); emphasize citation as keystone differentiator (idea: cite the models themselves); ambiently educate on model-dependency risks; maximize impressions of Perplexity-facilitated information. All in main doc.

**Illustrative bet — Perplexity Studios.** Use Perplexity products to support personal-brand reach and influence; content cadence, high-production styled content, feedback loop; incubate with Perplexity employees; roll out to luminary network. Addressed in Big Bet section.

---

## What is not in this pack (and why)

- **Full source-list for the four eras of GTM.** Standard industry history; a full historiography would balloon this doc without adding to Raman's read.
- **Vendor pricing detail.** HubSpot and Marketo pricing above is the compressed version; anyone in the seat would replace these numbers with current-quarter figures inside a week.
- **Explicit source for the "no clean cross-population brand survey" claim.** The claim is an absence of data, not a positive finding — best defended by naming the absence rather than citing a specific denial.
- **Third-party validation for the reflexive GTM multiplier claim.** The claim rests on the Ramp case study as its structural precedent. External validation of the "1 unit of internal GTM work → 4 units of external output" ratio does not exist as cited empirical work; it is a structural inference from the case pattern.