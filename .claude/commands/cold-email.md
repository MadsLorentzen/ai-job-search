# /cold-email - Write a Cold Outreach Email to a Hiring Manager or Recruiter

You are drafting a targeted cold outreach email to a specific person at a company the user wants to work at. This is proactive networking — not a response to a posted job.

Follow these steps **in order**.

---

## Step 0: Parse Input

`$ARGUMENTS` may contain a company name, person name, or both, e.g.:
- `/cold-email acme` — outreach to someone at Acme (user will specify person or you'll draft for a generic hiring manager)
- `/cold-email sarah.jones@acme.com` — outreach to a specific person
- `/cold-email acme data-engineer` — target someone with that title at Acme

Ask for any missing detail before proceeding: at minimum you need the company and a target role or person.

---

## Step 1: Load Candidate Profile

Read `CLAUDE.md` and extract:
- Full name and contact info
- Top 3–5 strongest, most relevant skills for this outreach target
- Most impressive recent achievement or project (quantified if possible)
- Career goal that connects to this company
- Any existing connection to this company (former colleague, met at event, mutual contact, etc.)

---

## Step 2: Research the Target

Use web search to find:

**About the company:**
- What they do, recent news (funding, product launch, expansion, hiring push)
- Tech stack or domain relevant to the target role
- Culture signals (mission statement, Glassdoor notes, recent LinkedIn posts)

**About the person (if named):**
- LinkedIn profile: title, tenure, recent posts or articles, shared connections
- Any public writing, talks, or projects
- How long they've been at the company

Search queries to use:
- `"[person name]" "[company]" site:linkedin.com`
- `"[company]" "[role/team]" hiring OR "we're growing" OR "join our team"`
- `"[company]" news [current year]`

Note: if no named person was provided, identify the most likely target (engineering manager, head of data, recruiter) based on the role and company size. State the assumption.

---

## Step 3: Identify the Angle

Pick **one** specific hook that makes this outreach relevant and non-generic. In order of preference:

1. **Shared connection** — "We both know [name]" / "[Name] suggested I reach out"
2. **Their work** — A specific post, talk, project, or decision they made publicly
3. **Company news** — Recent funding, product launch, or announced expansion they're likely involved in
4. **Shared problem/interest** — A technical challenge or domain they work on that the candidate has experience with
5. **Role signal** — A job posting or LinkedIn activity suggesting they're hiring for this type of role

Never use a generic hook ("I admire your company" or "I've always been interested in your work"). If no good hook exists, say so honestly and suggest a better-timed approach.

---

## Step 4: Draft the Email

Write a cold outreach email with these constraints:

- **Subject line:** specific, not salesy — reference the hook or role directly. Under 8 words.
- **Length:** 150–200 words maximum. Busy people do not read long cold emails.
- **Structure:**
  - Line 1: the hook — why you're reaching out *to them specifically* right now
  - Lines 2–3: one sentence on who you are + one concrete, relevant achievement
  - Lines 4–5: what you're looking for and why this company specifically (connect to something real from Step 2)
  - Closing: a low-friction ask — not "Can I have a job?" but "Would you be open to a 20-minute call?" or "Happy to share my CV if relevant"
- **Tone:** peer-to-peer, confident but not pushy. No flattery. No "I hope this email finds you well."
- **Attachments:** do not attach a CV unless the user confirms they want to — attaching a CV to a cold email often triggers spam filters and feels presumptuous.

Produce the final email ready to copy-paste, with `[VARIABLE]` placeholders clearly marked for anything the user needs to fill in.

---

## Step 5: LinkedIn DM Variant (optional)

If the user might prefer LinkedIn over email, produce a shorter DM variant:
- Max 5 sentences
- Same hook, same ask
- No subject line needed

---

## Step 6: Follow-up Template

Produce a brief follow-up template for if there's no reply after 5–7 business days:
- Reference the original email
- Add one new piece of value (new project, relevant news, etc.)
- Renew the ask, once only
- Under 80 words

---

## Output Format

1. **Target summary** — who you're writing to and why (from Step 2–3)
2. **Hook chosen** and rationale
3. **Cold email** (ready to send)
4. **LinkedIn DM variant**
5. **Follow-up template**
6. Any honest caveats (e.g., "No recent news found — consider waiting for a better trigger")
