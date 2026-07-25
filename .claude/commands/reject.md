# /reject - Professionally Decline an Offer or Withdraw an Application

You are drafting a professional withdrawal or decline message. Done well, this preserves the relationship — the recruiter or hiring manager may work with the user again, refer them, or become a valuable connection.

Follow these steps **in order**.

---

## Step 0: Parse Input

`$ARGUMENTS` may contain a company name and optionally the reason type:
- `/reject acme` — decline an offer or withdraw an application at Acme
- `/reject acme offer` — specifically declining an offer
- `/reject acme application` — withdrawing before an offer (after applying or during interview process)
- `/reject acme reason="accepted another offer"` — provide the reason inline

Ask for the company name if not provided. Ask for the stage (offer vs. in-process) if ambiguous.

---

## Step 1: Load Context

1. Match company against `job_search_tracker.csv`. Read the tracker row for:
   - Current status (applied / interviewing / offer / etc.)
   - Role title
   - Notes on the process so far
2. Read `CLAUDE.md` for the candidate's name and contact info.
3. Check `documents/applications/<company>_<role>/` for any communication history if available.

---

## Step 2: Identify the Situation

Determine which scenario applies:

**A — Declining a received offer**
Most consequential — the company has invested most. Warmth and specificity matter most here.

**B — Withdrawing after interviews (pre-offer)**
The company has invested time. A prompt, clear withdrawal prevents them from holding the slot.

**C — Withdrawing after applying (pre-interview)**
Low stakes — a brief, courteous note is sufficient. Some companies appreciate it; some don't respond. Either is fine.

**D — Declining a recruiter's initial outreach**
Briefest possible — one paragraph, no explanation required.

Identify which scenario applies from the tracker status or user input.

---

## Step 3: Establish the Reason

Ask the user (or infer from context) which reason applies. Use only honest reasons:

- Accepted another offer (most common — and fully sufficient)
- Role/scope not the right fit after learning more
- Compensation not aligned with needs
- Location or remote policy doesn't work
- Personal circumstances (relocation, family, timing)
- Company direction or culture not the right match

**What not to say:**
- Don't fabricate or over-explain reasons
- Don't criticize the company, process, or team in the message
- Don't say "the role isn't challenging enough" or anything that sounds like a slight
- Don't over-apologize — one genuine "I'm sorry for any inconvenience" is enough

If the reason is sensitive (compensation, culture concerns, better offer from a competitor), suggest a neutral framing: "I've decided to pursue a different opportunity that's a closer fit for where I'm heading right now."

---

## Step 4: Draft the Message

Write a decline/withdrawal message tailored to the scenario.

**For scenarios A and B — email:**
- Subject line: specific and clear (e.g., "Re: Offer for Senior Data Engineer — [Name]")
- Open: one genuine sentence of thanks for the time and process
- The decision: clear and direct in the first paragraph — don't bury it
- Brief reason: one sentence, honest but diplomatic
- Warm close: express genuine goodwill, leave the door open if appropriate
- Length: 100–150 words max. No long explanations needed.

**For scenario C — email or platform message:**
- 3–4 sentences
- Thank → decline → brief reason → wish them luck
- No subject line needed if replying to an existing thread

**For scenario D — LinkedIn DM or reply to recruiter email:**
- 2–3 sentences
- Polite, firm, no explanation required unless the user wants to provide one

**Tone across all scenarios:** warm but decisive. The goal is to close this door cleanly while keeping the relationship intact.

---

## Step 5: Update the Tracker

After drafting, remind the user to log the outcome:
- Run `/outcome <company>` to update the tracker with status `rejected_by_candidate` and notes on why.

This keeps the pipeline accurate and provides useful data for future retrospectives.

---

## Output Format

1. **Situation assessment** — which scenario, what stage
2. **Recommended reason framing** (if the user hasn't specified one)
3. **Decline/withdrawal message** — ready to send
4. Reminder to run `/outcome` to update the tracker
