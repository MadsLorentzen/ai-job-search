---
framework_version: 1.0.0
---

# Interview Preparation Guide

<!-- SETUP: STAR examples are personalized by running /setup based on your actual experience -->

## STAR Format

Structure answers as: **Situation** (context), **Task** (your responsibility), **Action** (what you did), **Result** (outcome).

Keep answers to 1-2 minutes. Be specific. End with what you learned or would do differently.

## Ready-Made STAR Examples

<!-- These are populated by /setup from your actual experience. Below are templates showing the format. -->

### 1. Game Automation Rebuild (Performance & Reliability Engineering)
**S:** Third-party game automation at TrueIgTech ran as full browser-driven sessions, taking 15-25s per action and prone to timeouts and crashes on long-running sessions.
**T:** Redesign the automation approach to be fast and reliable without losing correctness.
**A:** Rebuilt the pipeline into a hybrid browser+API model, using the browser only where strictly necessary and driving the rest through direct API calls.
**R:** Cut per-action latency from 15-25s to ~300ms and eliminated the timeout/crash failure class entirely.
**Use for:** "Tell me about your biggest technical challenge", "Describe a time you improved system performance"

### 2. Payment Stack Hardening (Fintech / Payments Reliability)
**S:** PrizePlanet needed multiple payment rails (Apple Pay, Google Pay, card via PayCom, payouts via Fyntek) with money-correctness guarantees under real-world webhook unreliability.
**T:** Own the payment integration and ensure it stays consistent even under duplicate/out-of-order webhook delivery and provider-side drift.
**A:** Implemented idempotent webhook handling and a batched, lock-protected reconciliation worker that compares internal state against provider records and corrects drift.
**R:** Payment stack runs in production with no known reconciliation-driven balance discrepancies reported.
**Use for:** "Describe a project involving money/financial correctness", "How do you handle unreliable external systems?"

### 3. OLTP-to-OLAP Analytics Migration (Data/Analytics Architecture)
**S:** Core analytics dashboards ran directly against PostgreSQL (OLTP), causing full table scans and slow load times as data volume grew.
**T:** Move analytics to a system built for it without breaking existing dashboards.
**A:** Migrated to ClickHouse (OLAP), designing the schema around purpose-fit engines (AggregatingMergeTree, SummingMergeTree, ReplacingMergeTree) with hourly pre-aggregated materialized views.
**R:** Dashboard queries went from full table scans to sub-second lookups.
**Use for:** "Tell me about a time you redesigned a data architecture", "How do you approach scaling a system that's outgrown its original design?"

### 4. Distributed Concurrency Control in IC-Poker (Concurrency / Distributed Systems)
**S:** A real-time multiplayer poker platform needed to run 1,000+ concurrent cash games and tournaments without race conditions corrupting game or wallet state.
**T:** Build concurrency control that guarantees correctness under high parallel load with crash recovery.
**A:** Implemented Redis-based distributed locks and atomic operations across the poker game engine, with a crash-recovery mechanism for interrupted operations.
**R:** Achieved zero race conditions across parallel game instances while scaling WebSocket throughput to 10,000+ events/second.
**Use for:** "Describe a concurrency bug you had to solve", "Tell me about building a system that has to be correct under load"

<!-- Add more STAR examples as needed. Aim for 4-6 covering different competencies. -->

## Common Tough Questions

### "Why did you leave [previous company]?"
> [PREPARE YOUR ANSWER - be honest, forward-looking, no negativity about former employer]

### "You don't have [specific skill/experience]."
> [PREPARE YOUR ANSWER - acknowledge the gap, bridge to adjacent experience, show willingness to learn]

### "Where do you see yourself in 5 years?"
> [PREPARE YOUR ANSWER - show ambition aligned with the role's growth path]

### "What's your biggest weakness?"
> [PREPARE YOUR ANSWER - genuine weakness with concrete mitigation strategy]

### "Why this company specifically?"
> Customize per company. Must reference: specific projects, company values, market position, or team structure. Never give a generic answer.

## Questions You Should Ask Interviewers

### About the Role
- "What does a typical week look like in this role?"
- "What would success look like in the first 6 months?"
- "What's the biggest challenge the team is facing right now?"

### About the Team
- "How big is the team, and how do you divide work?"
- "What does the development/project lifecycle look like, from idea to production?"
- "How do you onboard new team members?"

### About Tech & Growth
- "What's your current tech stack for [relevant area]?"
- "Is there room to grow into more architectural or strategic decisions?"
- "How does the team stay current with new tools and methods?"

### About Culture (use these to prevent disappointment)
- "How would you describe the team culture?"
- "What does professional development look like here?"
- "Is there flexibility for remote/hybrid work?"
- "What's the balance between development/new projects and maintenance work?"
- "How would you describe the leadership style in this team?"
- "What do people who thrive here have in common?"

## Phone/Video Interview Tips
- Have STAR examples written out (use this file)
- Keep a glass of water nearby
- Smile when speaking (it changes your tone)
- Ask for clarification if a question is vague
- It's OK to take 5 seconds to think before answering
- End with: "Is there anything else you'd like to know about my background?"

## After the Application (Best Practice)

### Follow-Up Etiquette
- **Don't call to "stand out"** or to learn more about the role post-submission - this risks a negative impression
- If the employer specified a timeline, respect it and wait
- If no timeline was given and significant time has passed (2+ weeks), a brief call to ask about status is acceptable
- If you have genuinely new, relevant information to share, a short follow-up is fine

### Thank-You Notes
- When you receive any update (interview invitation, rejection, or status update), send a brief thank-you message
- Express appreciation for their time and the process
- Keep it short (2-3 sentences)

## Roleplay Guidelines
When the user asks for interview practice:
1. Ask which role/company to simulate
2. Start with easy warm-up questions ("Tell me about yourself")
3. Progress to role-specific technical questions
4. Include 1-2 behavioral questions using the competencies from the job posting
5. End with a tough question or curveball
6. After each answer, give brief feedback: what worked, what to sharpen
7. Suggest which STAR example would work best for each question
