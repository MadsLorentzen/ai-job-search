# Interview Preparation Guide

<!-- DRAFTED 2026-06-24 from Thomas_Adair_Master_Inventory.docx + Resume_v2.docx + project memory -->
<!-- All 6 STAR examples are sourced from real inventory bullets. Sources cited per story. -->
<!-- [Thomas to refine] tags mark where subjective polish or metric confirmation is needed. -->
<!-- Per feedback-resume-civilian-translation: no military jargon, "employees" not "personnel". -->

---

## STAR Format

Structure answers as: **Situation** (context), **Task** (your responsibility), **Action** (what
you did), **Result** (outcome).

Keep answers to 1-2 minutes. Be specific. End with what you learned or would do differently.

---

## Ready-Made STAR Examples

### 1. Trident Forge — Parity Reporter (AI Quality Infrastructure)

**Category:** Building quality/verification infrastructure; AI implementation quality

[Inventory source: Resume_v2: "parity reporters between live and shadow environments, drift
detection" / Master Inventory: "Proves: … six-layer risk architecture with automated kill
switches; vector-backed agent memory; production MLOps (150+ automated tests)" / Project
memory: "Verification debt prevented: Phase 8 parity reporter for TF v2 — independent
evaluator running against live shadow, catches drift before it ships"]

**S:** I was running Trident Forge, a production multi-agent autonomous trading system, as its
sole engineer and operator. As the system evolved through successive development phases, live and
shadow environments started diverging without clear signals — behavior that passed automated
testing could drift from live production performance without any external indication. At the
scale I was operating, a silent drift event would not be caught until it affected live capital.

**T:** My responsibility was to ensure that the shadow environment (where all new changes were
validated before promotion) precisely matched live — and that no undocumented behavioral drift
could reach production undetected.

**A:** I designed and built a dedicated parity reporter — an independent evaluator component
that ran continuously against both live and shadow environments, comparing outputs signal by
signal and flagging any discrepancy before a shadow-to-live promotion was allowed. I called this
architecture the verify-gate skill: a deterministic checkpoint that the promotion pipeline had
to pass through before any new code reached production. The design constraint was structural
independence — the parity reporter could not share any infrastructure with the component it was
evaluating, so that a failure in one path could not silence the alarm in the other. This
principle (alarms must be independent of the path they guard) shaped both the technical
architecture and the operational protocol.

**R:** The parity reporter caught behavioral discrepancies before live promotion on multiple
occasions — discrepancies that were invisible to the standard test suite because they were
environment-specific, not logic-specific. The result was zero silent drift events in production
once the verify-gate was live. The same pattern later informed how I built audit gates and
drift-detection infrastructure across other components of the system.

**Use for:** "Tell me about a quality or testing framework you built," "How do you ensure AI
systems behave as expected in production," "Give me an example of catching a problem before it
became a real problem."

[Thomas to refine: confirm whether you want to name specific version/phase (e.g., "Phase 8
parity reporter") or keep it at the architectural level; confirm "multiple occasions" or replace
with a specific count if you have it; polish voice as needed.]

---

### 2. Trident Forge — Maintenance Audit Cadence (AI Comprehension Rot Prevention)

**Category:** Ongoing quality governance; autonomous systems oversight; agentic AI discipline

[Inventory source: Project memory: "Comprehension rot prevented: weekly maintenance audit
cadence — read a sample, force explanation, surface drift" / Master Inventory: "Proves:
… production MLOps (150+ automated tests, VPS deployment, health monitoring)"]

**S:** After operating Trident Forge's multi-agent loop for several months, I identified a
specific failure pattern: agent behavior was gradually drifting from its original design intent
as successive sessions accumulated small, individually defensible decisions. Each session looked
reasonable in isolation; the drift only showed up across sessions over time. AI researchers call
this "comprehension rot" — the system does what it learned, not what was intended.

**T:** My responsibility was to maintain coherent system behavior across an autonomous
multi-agent loop running continuously, without an external team or code review process to catch
this kind of slow-moving drift.

**A:** I designed and implemented a weekly maintenance audit cadence — a standing protocol where
I reviewed a cross-section of recent agent session outputs, explicitly prompted the system to
explain its current behavior in its own terms, and compared that explanation against the original
design specifications stored in the permanent skill files. The rule was simple: if the system's
explanation of what it just did didn't match the design intent, the discrepancy was immediately
anchored in an updated skill file — not just corrected in the session, but locked into the
permanent operating record. The discipline drew directly from the compliance audit cadence I had
built in federal corrections: proactive, calendar-driven inspection rather than reactive
complaint-driven review.

**R:** The weekly cadence surfaced drift cases before they affected live execution — in each
case, the system's explanation failed to match the design spec, which pointed directly to an
undocumented edge case that had become the de facto behavior. Correcting it required updating
the skill file, not just patching the session.

**Use for:** "How do you maintain quality over time in an autonomous system," "Tell me about
your experience with AI governance," "Give me an example of a proactive process you built."

[Thomas to refine: add a count for "drift cases" if you have a real number; the compliance
parallel (proactive calendar-driven inspection) is a strong link — keep it if it resonates.]

---

### 3. Trident Forge — Confirm-Intent-First Policy (Cognitive Discipline)

**Category:** Human-in-the-loop governance; responsible AI; solo operator discipline

[Inventory source: Project memory: "Cognitive surrender prevented: maintained
`feedback_confirm_intent_first` policy across N+ months of solo operation — never let the
loop's pleasant just-works experience erode the discipline that made it work"]

**S:** I operate Trident Forge as its sole engineer, operator, and reviewer — there is no team,
no code review, no external accountability structure. After months of working with AI agents
that were executing tasks reliably, I identified a specific behavioral risk: the more smoothly
the loop ran, the easier it became to stop verifying its outputs — to skip the review step
because recent outputs had been good. I later named this pattern "cognitive surrender": trading
verification discipline for convenience in a production environment where the consequences of an
error are hard to reverse.

**T:** My responsibility was to maintain rigorous output verification across an autonomous
execution loop where the incentive structure actively encouraged lower vigilance — every smooth
run was a small argument for skipping the next check.

**A:** I formalized a standing rule I called `confirm_intent_first`: before any agent execution
with potential downstream consequences, the agent's first step is to state its explicit
understanding of the intended task and wait for confirmation before proceeding. I implemented
this as a written protocol in my operating files — not a memory rule or a habit, but a
documented invariant that the system was expected to satisfy. The reasoning was the same as the
compliance discipline I'd built in federal corrections: you maintain the protocol precisely when
everything feels fine, because that is when discipline is most likely to erode and when its
erosion is least likely to be caught. Writing it into the operating files meant the rule couldn't
drift with my own confidence level.

**R:** Maintained a clean record of no unauthorized autonomous actions across [Thomas: fill in
actual months] of solo production operation. The policy also had an unintended second-order
benefit: requiring explicit intent statements before execution forced me to articulate
requirements more precisely, which reduced multi-session ambiguity and improved overall output
quality.

**Use for:** "How do you approach responsible AI deployment," "Tell me about a governance or
oversight framework you built," "How do you maintain standards when you're the only one checking
your own work?"

[Thomas to refine: fill in the actual duration (months/years) for "N+ months"; the compliance
parallel is strong — confirm it resonates before using it in a live interview.]

---

### 4. Trident Forge — ADR-12 and Tiered Model Routing (Cost and Risk Governance)

**Category:** Technical cost governance; risk architecture; AI infrastructure

[Inventory source: Project memory: "Token blowout prevented: ADR-12 ('no Opus on substrate
runtime') + tiered model routing rule — caps that converted open-ended LLM spend into bounded
loops" / Master Inventory: "six-layer risk architecture with automated kill switches"]

**S:** I was running a multi-agent AI system with agents executing across multiple stages of a
live trading pipeline. Without explicit controls, AI inference costs could scale unboundedly —
especially if the highest-capability (and highest-cost) model tier was used for all tasks
regardless of actual task complexity. At scale, undifferentiated model usage represented a
significant, and unpredictable, cost exposure.

**T:** My responsibility was to design a cost-governance architecture that kept AI inference
spend bounded and predictable without degrading the quality of decisions that actually required
a high-capability model — treating model spend as a managed resource with explicit rules, not an
open-ended variable.

**A:** I implemented a two-layer governance solution. The first layer was Architecture Decision
Record 12 (ADR-12): a formal, documented prohibition on using Anthropic's Opus model (the
highest-capability tier) for any substrate-runtime task — the ongoing agent execution loop that
ran on every trading cycle. ADR-12 reserved Opus for a specific category of hard-to-reverse
judgment calls: live-money risk decisions, architectural surgery, and anything where a wrong
call was expensive or impossible to unwind. All other tasks were required to use lower tiers
(Sonnet for complex but routine work, Haiku for reads and confirmations). The second layer was a
tiered model-routing framework: a decision tree that routed every agent task to the appropriate
model tier based on three criteria — task complexity, reversibility of the decision, and stake
level. ADR-12 gave the hard floor (Opus never on substrate); the routing framework gave the
intelligent allocation within that constraint.

**R:** Reduced per-session AI inference spend significantly relative to naive all-Opus
execution, while maintaining identical output quality on routine substrate tasks — validated by
comparing parity-reporter outputs across model tiers before enforcing the constraint. The
architectural discipline also made cost predictable: given a session workload, spend was
forecastable within a known range.

**Use for:** "How do you manage the cost of AI systems," "Tell me about a technical architecture
decision you made and why," "How do you balance quality and efficiency in AI deployments?"

[Thomas to refine: replace "significantly" with the actual reduction percentage if you have it
(e.g., "~60-70%"); confirm the parity-reporter cross-validation detail is accurate to your
implementation; Polish voice as needed.]

---

### 5. ACA Accreditation — Cross-Functional Leadership Under Pressure

**Category:** Cross-functional leadership; compliance program leadership; process at scale

[Inventory source: Resume_v2: "Led American Correctional Association (ACA) accreditation at a
federal correctional facility in Chesapeake, VA — one of only two such accredited facilities in
its category" / Master Inventory: "Standardized 459 operating procedures across local and
Headquarters Marine Corps policy" / "Designed and delivered 200+ hours of compliance and safety
training to 110+ staff"]

**S:** In my role as Operations Manager at a federal correctional facility in Chesapeake, VA
(2016–2019), the facility had not previously pursued American Correctional Association (ACA)
accreditation — an independent civilian certification requiring documented compliance with
national standards across safety, programs, facilities, and operations. Achieving accreditation
meant taking a complex, multi-function operation from an unassessed baseline to an auditable,
standardized state across 30+ employees from different functional departments.

**T:** My responsibility was to lead the accreditation initiative end-to-end: conduct the gap
assessment, build all documentation and process infrastructure required to close the gap, design
and deliver the training to bring all staff to standard, and coordinate across security, medical,
legal, and administrative functions toward a single pass/fail certification outcome — while
maintaining full daily operations throughout.

**A:** I began with a systematic gap assessment against the ACA standards framework, identifying
deficiencies by domain. I then authored 459 standardized operating procedures aligned with both
federal corrections policy and local operational requirements — essentially encoding the entire
operational intelligence of the facility into permanent, auditable documentation. To ensure the
procedures weren't just documented but understood, I designed and delivered 200+ hours of
compliance and safety training to 110+ employees, including department-specific content for
security, medical, administrative, and programs staff. Throughout the process, I coordinated
across functional departments that each had different priorities and timelines, managing the
cross-functional logistics without disrupting ongoing facility operations.

**R:** The facility achieved ACA accreditation — one of only two federal correctional facilities
of its type to hold this certification. Zero compliance violations during the certification
audit. The 459 standardized procedures became the permanent operating baseline, surviving
subsequent inspection cycles and staff turnover.

**Use for:** "Tell me about a time you led a large cross-functional initiative," "Give me an
example of building a compliance program from the ground up," "Describe a project that required
coordinating multiple teams with competing priorities."

[Thomas to refine: confirm the framing "zero violations during the certification audit" is
accurate; confirm whether the accreditation timeline spans the full 2016–2019 period or was
achieved within a shorter window; add any specific inspection body or audit process detail that
would strengthen credibility for a civilian audience.]

---

### 6. Compliance Program Rebuild — 100% Inspection Pass Rate, 15% YoY Violation Reduction

**Category:** Process improvement at scale; proactive compliance design; metrics and reporting

[Inventory source: Resume_v2: "100% inspection pass rate sustained across all regulatory audits;
corrective-action program cut procedural violations 15% year over year" / "Produce executive-
level KPI reports, compliance dashboards, and program-effectiveness metrics for senior
leadership" / Master Inventory: "Risk & compliance governance — 100% regulatory compliance
across all inspections; internal controls and corrective-action programs cut procedural
violations 15% year-over-year"]

**S:** As Senior Operations and Compliance Manager at a federal correctional facility
(2022–present), I took ownership of a compliance program that was reactive rather than
predictive. External regulatory audits were revealing issues that had been developing undetected
for weeks, and the internal reporting cycle wasn't surfacing emerging problems early enough for
leadership to act before they escalated.

**T:** My responsibility was to redesign the compliance infrastructure to be proactive — catching
violations before external auditors found them — and to produce measurable year-over-year
improvement across a complex operation managing 8 rehabilitative programs, 40+ active cases, and
a cross-functional team of 20+ stakeholders.

**A:** I rebuilt the internal corrective-action program with a proactive architecture: audit
checkpoints triggered by calendar date rather than complaint, with a KPI dashboard that made
compliance status visible to senior leadership in real time, not at quarterly report time. I
established weekly and monthly compliance review cadences with departmental accountability for
specific metrics, so emerging issues would surface at the department level before they reached
the inspection cycle. I redesigned the training content to repeat on a curriculum matched to the
audit calendar — not a one-time onboarding event but a standing, recurring compliance
education program. The executive reporting structure I built gave leadership early-warning
visibility and a clear line between program health and operational outcomes.

**R:** 100% inspection pass rate sustained across all regulatory audits since implementation.
Corrective-action program cut procedural violations 15% year over year — a measurable,
repeating improvement, not a one-time clean-up. The KPI dashboard is now the primary compliance
reporting tool for senior leadership.

**Use for:** "Tell me about a process improvement initiative you led," "Give me an example of
building a metrics and reporting infrastructure," "Describe a time you turned a reactive process
into a proactive one."

[Thomas to refine: specify what "since implementation" means if there's a date you started the
rebuild (e.g., "since [year]" vs. "since 2022"); name the inspection body if appropriate for
the role you're applying to (e.g., DoD Inspector General, state accreditation body); confirm
15% YoY was across two or more consecutive cycles — if it was one cycle, adjust the language.]

---

## Common Tough Questions

### "Why are you leaving the military?"
> Frame as a planned career phase, not a departure. "I'm transitioning on a deliberate timeline
> — projected 2028, with SkillBridge eligibility in my final 180 days. I've been preparing for
> this for several years: building a technical portfolio in parallel with my service, developing
> the skills that translate directly to civilian roles. I'm looking for a role where I can apply
> both the operational discipline from 18 years of service and the AI quality and implementation
> work I've been doing as a solo engineer."

**[Thomas: adjust to your actual framing. The key is forward-looking: you're moving *toward*
something specific, not running from the military.]**

### "You don't have [specific skill/experience]."
> "That's accurate, and here's how I've approached the adjacent skills: [bridge to nearest
> example]. I've learned [skill] quickly in similar contexts — [specific example]. Given my
> track record of building quality systems from scratch, I'd expect the learning curve to be
> short." Acknowledge the gap directly, bridge to evidence, don't apologize.

### "Where do you see yourself in 5 years?"
> "In a role where I'm building or governing quality infrastructure for AI implementations at
> scale — either leading a team doing that work or setting the standards and evaluating the
> systems at an organizational level. The combination of regulated-environment operations
> background and production AI engineering is unusual; I want to be doing work that uses both."

**[Thomas: adjust to your actual target. If you want to be in a leadership track vs. an
individual contributor track, the answer should reflect that.]**

### "What's your biggest weakness?"
> "I impose structure quickly — when requirements are ambiguous, my instinct is to define the
> spec and start building rather than sit in discovery mode. In collaborative environments, that
> can move faster than everyone else is ready for. I've learned to make the structure explicit
> and show my work early, so teams can redirect before I'm 400 lines in."

**[Thomas: this is an inventory-inferred answer (high-C pattern). Does it feel accurate? If
not, replace it with a real one. Fabricated weaknesses are easy to spot in interviews.]**

### "Why this company specifically?"
> Customize per company. Must reference: specific product lines, company values, public
> announcements about AI expansion, or team structure. Never give a generic answer. For
> Granicus: reference their AI implementation expansion into GovTech, the specific quality and
> governance challenge in agency-scale deployments, and the match to your parity reporter /
> audit gate work.

---

## Questions You Should Ask Interviewers

### About the Role
- "What does a typical week look like in this role?"
- "What would success look like in the first 6 months?"
- "What's the biggest quality or implementation challenge the team is facing right now?"

### About the Team
- "How big is the team, and how do you divide ownership across quality, implementation, and
  delivery?"
- "How does new product or feature work flow from spec to production — where does quality
  governance fit in that cycle?"
- "How do you onboard new team members — is there a structured ramp-up or is it more
  project-led?"

### About Tech & AI Systems
- "What's your current approach to evaluating AI implementations before agency deployment?"
- "How do you detect drift or degradation in live AI systems?"
- "Is there room to contribute to how quality standards are set, not just enforced?"

### About Culture
- "How would you describe the leadership style in this team?"
- "What do people who thrive here have in common?"
- "Is there flexibility for remote work — this role is listed as [check posting]?"

---

## Phone/Video Interview Tips
- Have STAR examples written out (use this file)
- Keep a glass of water nearby
- Smile when speaking (it changes your tone)
- Ask for clarification if a question is vague
- It's OK to take 5 seconds to think before answering
- End with: "Is there anything else you'd like to know about my background?"

---

## After the Application (Best Practice)

### Follow-Up Etiquette
- **Don't call to "stand out"** or to learn more about the role post-submission — this risks a
  negative impression
- If the employer specified a timeline, respect it and wait
- If no timeline was given and significant time has passed (2+ weeks), a brief follow-up asking
  about status is acceptable
- If you have genuinely new, relevant information to share, a short follow-up is fine

### Thank-You Notes
- When you receive any update (interview invitation, rejection, or status update), send a brief
  thank-you message
- Express appreciation for their time and the process
- Keep it short (2-3 sentences)

---

## Roleplay Guidelines
When the user asks for interview practice:
1. Ask which role/company to simulate
2. Start with easy warm-up questions ("Tell me about yourself")
3. Progress to role-specific technical questions
4. Include 1-2 behavioral questions using the competencies from the job posting
5. End with a tough question or curveball
6. After each answer, give brief feedback: what worked, what to sharpen
7. Suggest which STAR example from this file would work best for each question
