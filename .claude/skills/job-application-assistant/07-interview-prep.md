# Interview Preparation Guide

## STAR Format

Structure answers as: **Situation** (context), **Task** (your responsibility), **Action** (what you did), **Result** (outcome).

Keep answers to 1-2 minutes. Be specific. End with what you learned or would do differently.

## Story Bank Source

A polished story bank is maintained in `~/Projects/openai_interview_prep/`. That folder contains fully-developed narrative versions of most of the STAR examples below. **When prepping for a specific interview, mine that folder first** for the most current phrasing. The stubs below are the canonical index into that material plus a few additional candidates from the broader CV.

## Ready-Made STAR Examples (Indexed Against `openai_interview_prep/`)

### 1. DailyPay Lifecycle / Welcome Sequence (Always-on growth motion, lifecycle ownership)
**S:** DailyPay was scaling fast but lifecycle messaging was fragmented across channels with no stable baseline.
**T:** Build a welcome sequence and an always-on lifecycle motion that could compound rather than rely on point campaigns.
**A:** Rebuilt user communications stack (Iterable + Segment + Amplitude). Designed the DollarTree welcome sequence as the highest-leverage cold-email asset. Established a stable baseline metric to demystify what "good" looked like before optimizing.
**R:** 5.7x revenue expansion ($14M → $80M) in under 12 months; doubled active users in Q4 alone; sustainable gains on every metric.
**Use for:** "Always-on growth motion", "lifecycle ownership", "engineering-deep growth project"
**Source:** `openai_interview_prep/1_Hiring_Manager_Terri-1_Always_On_Growth_Motion-DollarTree_Welcome.md`, `2_Engineering_Joseph-1_Eng_Involvement_-DailyPay_Stack_Build.md`

### 2. Beacons AI Email Marketing (0-to-1, AI personalization at scale)
**S:** Creator-economy SaaS with no AI-native email product. Competitor ESPs were not AI-first.
**T:** Launch 0-to-1 AI Email Marketing for creators with a defensible velocity advantage.
**A:** Started narrow (a single high-leverage use case), learned the problem structure, expanded sophistication in stages. Co-designed with engineering rather than handing off specs.
**R:** Fastest ESP in market to reach 50M cumulative email volume. ~9% weekly user growth and ~25% weekly paid subscriber growth on the surface.
**Use for:** "AI-powered workflows / personalization at scale", "0-to-1 product launch", "AI personalization risks"
**Source:** `openai_interview_prep/1_Hiring_Manager_Terri-2_AI_Workflows-AI_Personalization.md`

### 3. Beacons Longer Onboarding (Realized I was wrong; conviction flip)
**S:** Default stance was shorter onboarding = better conversion at Beacons.
**T:** Evaluate proposal for a longer onboarding flow that violated my default.
**A:** Ran the test against my own conviction. Saw the result, rethought the default, and updated the broader product approach.
**R:** Conviction was wrong; explanation changed the product. Net outcome positive on activation and retention.
**Use for:** "Time you realized you were wrong", "counterintuitive insight"
**Source:** `openai_interview_prep/1_Hiring_Manager_Terri-3_Realized_Wrong-Beacons_Longer_Onboarding.md`

### 4. Black Friday Revenue Model / Area Code Imputation (Decision under incomplete data)
**S:** Needed to build a Black Friday revenue forecast and a timezone signal without complete user data.
**T:** Make a high-stakes call with missing inputs.
**A:** Built imputation logic (area code → timezone as a proxy). Defended the principle of "can we impute?" as the decision frame.
**R:** Decisions held up; forecast and timezone signal proved usable in production.
**Use for:** "Decision with incomplete data", "self-serve analytical tooling"
**Source:** `openai_interview_prep/1B_Hiring_Manager_Terri-4_Decision_Incomplete_Data-BlackFriday_AreaCode.md`

### 5. DailyPay Stack Build (Growth project requiring deep engineering involvement)
**S:** DailyPay had no growth stack. The lifecycle, instrumentation, and experimentation layers all needed to be built.
**T:** Architect and build the growth stack end-to-end as PM/engineer hybrid.
**A:** Built it alongside engineering, not handed off. Iterable + Segment + Amplitude integrated as a single growth surface.
**R:** Supported 5.7x revenue expansion. Stack still in use post-tenure.
**Use for:** "Growth project requiring deep engineering involvement", "defining requirements", "shipping velocity"
**Source:** `openai_interview_prep/2_Engineering_Joseph-1_Eng_Involvement_-DailyPay_Stack_Build.md`

### 6. Beacons Experiment Groups (Co-designed feature that increased experimentation velocity)
**S:** Beacons experimentation velocity was bottlenecked on how tests were grouped and assigned.
**T:** Unblock experimentation velocity without rebuilding the experimentation platform.
**A:** Co-designed "Experiment Groups" with engineering as a primitive on top of the existing platform.
**R:** Meaningful experimentation velocity lift with minimal infra cost. Pattern reusable.
**Use for:** "Co-designed feature that increased experimentation velocity"
**Source:** `openai_interview_prep/2_Engineering_Joseph-2_Codesign_Engineer_Velocity-Beacons_Experiment_Groups.md`

### 7. Beacons Pricing Redesign (Partnered with Product/Eng/Design to ship growth feature)
**S:** Beacons pricing was leaving revenue on the table. First pricing experiment failed.
**T:** Run a real pricing redesign with conviction, rigor, and statistical guardrails.
**A:** Campaigned for the redesign, ran the experiment, held for statistical significance, partnered with PED throughout. Re-designed after the first iteration's failure rather than abandoning.
**R:** 120% revenue lift. ARPU and LTV both up. Conversion not cannibalized.
**Use for:** "Partnered with PED to ship growth feature", "pricing experiment", "tradeoffs"
**Source:** `openai_interview_prep/3_PM_Antonia-1_Partnered_PED_Ship_Feature-Pricing_Redesign.md`

### 8. Checkmate "Conscious Choice" Interstitial (Success metrics + guardrails)
**S:** Checkmate growth motion needed a new interstitial. Risk of optimizing for conversion at the cost of user trust.
**T:** Define success metrics and guardrails that prevented an extractive growth pattern.
**A:** Set the guardrail before the experiment, not after. "Conscious choice" as an explicit principle.
**R:** Growth gained without erosion of trust signals. Pattern used across other surfaces.
**Use for:** "Success metrics and experimentation guardrails", "responsible growth"
**Source:** `openai_interview_prep/3_PM_Antonia-2_Success_Metrics_Guardrails-Checkmate_Conscious_Choice.md`

### 9. DailyPay Hyper-Users (Cohort analysis; counterintuitive insight)
**S:** DailyPay's most engaged user cohort looked like a strong signal.
**T:** Validate whether engagement = health.
**A:** Cohort analysis and segmentation. Found that the most engaged were not the healthiest from a financial wellness perspective.
**R:** Reframed product strategy around healthier cohorts, not just engaged ones.
**Use for:** "Counterintuitive insight from cohort analysis", "rapid testing vs. long-term UX balance"
**Source:** `openai_interview_prep/3_PM_Antonia-3_Rapid_Testing_Quality-Hyper_Users.md`

### 10. Checkmate Nudge Experiment (End-to-end experiment with DS partnership)
**S:** Checkmate needed a high-confidence growth experiment with statistical rigor.
**T:** Design end-to-end, partner with Data Science on validity.
**A:** Hypothesis, instrumentation, ITT framing, guardrails, sufficient power, statistical sign-off.
**R:** Experiment held under scrutiny. Decision was made on the result, not on optics.
**Use for:** "End-to-end experiment design", "DS collaboration / statistical validity"
**Source:** `openai_interview_prep/4_Data_Science_Dan-1_End_To_End_Exp-Nudge_Experiment.md`

### 11. Checkmate Default Browser (Counterintuitive segmentation insight)
**S:** Checkmate had a segmentation signal that didn't match prior assumptions.
**T:** Pull the thread.
**A:** Counterintuitive: default browser predicted behavior in a way the team had not expected.
**R:** Strategy update based on the signal.
**Use for:** "Counterintuitive insight from segmentation"
**Source:** `openai_interview_prep/4_Data_Science_Dan-2_Counterintuitive_Insights-Default_Browser.md`

### 12. Checkmate Revenue Intelligence (Self-serve data ownership)
**S:** No self-serve revenue intelligence at Checkmate.
**T:** Build it without waiting for a data team.
**A:** SQL, instrumentation, dashboards. Stack ownership.
**R:** Self-serve revenue intelligence shipped. Reduced data team bottleneck.
**Use for:** "Self-serve data / SQL", "revenue intelligence"
**Source:** `openai_interview_prep/4_Data_Science_Dan-2_Self_Serve_Data-Revenue_Intelligence.md`

## STAR Candidates (Complete Manually)

These are real achievements from the broader CV that don't yet have full STAR narratives. Add S/T/A/R details when needed for a specific interview.

### PitchTop - Cross-device checkout outperforming Shopify by 17%
**Source:** CV, PitchTop role
**What happened:** Engineered embedded checkout that converted 17% better than Shopify.
**Why it matters:** Technical leadership, conversion engineering, founder-built product depth.
**S/T/A/R stub:**
- Situation:
- Task:
- Action:
- Result:

### FanBridge - YouTube Marketing partnership → Stensul spin-off (8-figure valuation)
**Source:** CV, FanBridge role
**What happened:** Closed YouTube Marketing partnership that spun out as Stensul.
**Why it matters:** Strategic partnership, enterprise deal-making, sees ceiling well above current scale.
**S/T/A/R stub:**
- Situation:
- Task:
- Action:
- Result:

### Checkmate B2B2C Growth Loop (30,000 opt-ins/week)
**Source:** CV, Checkmate role
**What happened:** Built B2B2C growth loop driving additional 30,000 high-intent consumer opt-ins per week.
**Why it matters:** Growth-loop architecture, B2B2C model design, compounding acquisition.
**S/T/A/R stub:**
- Situation:
- Task:
- Action:
- Result:

### Checkmate Enrichment Product Line (15% of total revenue in 3 months)
**Source:** CV, Checkmate role
**What happened:** Introduced new Enrichment product line that grew to 15% of total revenue in first 3 months.
**Why it matters:** 0-to-1 product strategy at scale, revenue diversification, speed of execution.
**S/T/A/R stub:**
- Situation:
- Task:
- Action:
- Result:

### DailyPay WorkLife (0-to-1 product at $3M projected ARR at inception)
**Source:** CV, DailyPay role
**What happened:** Designed and launched WorkLife, a financial wellness product.
**Why it matters:** 0-to-1 inside a larger company, product strategy, monetization design.
**S/T/A/R stub:**
- Situation:
- Task:
- Action:
- Result:

### RockYou - First engineering hire, 100M+ MAU consumer apps
**Source:** CV, RockYou role
**What happened:** Built consumer apps that reached 100M+ monthly active users.
**Why it matters:** Scale credentials. Useful as an opening drop in interviews where scale matters (per OpenAI prep playbook).
**S/T/A/R stub:**
- Situation:
- Task:
- Action:
- Result:

## Common Tough Questions

### "Why did you leave Checkmate?"
> Honest framing: company stage transition. Forward-looking. No negativity about prior employer.

### "You don't have prior experience at an AI lab / 1000+ person org."
> Acknowledge the gap. Bridge to: built AI personalization 0-to-1 at Beacons (50M emails), AI-native default in current independent work (Warmode, Matic), reached final round of OpenAI Growth process. Pivot from leadership to IC is deliberate.

### "Where do you see yourself in 5 years?"
> Frame around the compounding skills of deep work inside a frontier AI mission, not a title trajectory. Stay specific.

### "What's your biggest weakness?"
> Genuine weakness with a concrete mitigation. Avoid the "weakness that's a strength" trap.

### "Why this company specifically?"
> Customize per company. Must reference: specific products, mission, leadership, or org structure. Never give a generic answer. Lifecycle/personalization-rich missions are the easy hook for AI labs.

## Questions to Ask Interviewers

### About the Role
- "What does a typical week look like in this role?"
- "What would success look like in the first 6 months?"
- "What's the biggest challenge the team is facing right now?"
- "How does this team interact with research / product / safety?" *(for AI labs)*

### About the Team
- "How big is the team, and how do you divide work?"
- "What does the experimentation lifecycle look like from idea to ship?"
- "How do you onboard new growth hires?"

### About Tech & Growth
- "What's the current experimentation infrastructure?"
- "How AI-native is the growth stack today?"
- "Where does growth own the surface vs. partner with product/eng?"

### About Culture
- "How would you describe the team culture?"
- "What's the balance between experimentation and long-term product quality?"
- "How would you describe the leadership style in this team?"
- "What do people who thrive here have in common?"

## Phone/Video Interview Tips
- Have STAR examples written out (this file + the openai_interview_prep folder)
- Keep a glass of water nearby
- Smile when speaking (it changes your tone)
- Ask for clarification if a question is vague
- It's OK to take 5 seconds to think before answering
- End with: "Is there anything else you'd like to know about my background?"

## After the Application

### Follow-Up Etiquette
- Don't call to "stand out" or to learn more about the role post-submission
- If the employer specified a timeline, respect it
- If 2+ weeks pass with no timeline given, a brief status check is acceptable
- If you have genuinely new, relevant information to share, a short follow-up is fine

### Thank-You Notes
- When you receive any update, send a brief thank-you (2-3 sentences)
- Keep it specific to something from the conversation
- No template language

## Roleplay Guidelines
When the user asks for interview practice:
1. Ask which role/company to simulate
2. Start with easy warm-up questions ("Tell me about yourself")
3. Progress to role-specific technical questions
4. Include 1-2 behavioral questions using the competencies from the job posting
5. End with a tough question or curveball
6. After each answer, give brief feedback: what worked, what to sharpen
7. Suggest which STAR example (numbered above) would work best for each question
