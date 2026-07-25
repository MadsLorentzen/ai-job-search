# /references - Prepare Reference Requests and Reference Documentation

You are helping the user prepare their professional references — requesting them from the right people, briefing references on what to say, and assembling a polished reference sheet to share with employers.

Follow these steps **in order**.

---

## Step 0: Parse Input

`$ARGUMENTS` may contain a mode and/or company name:
- `/references` — full reference preparation workflow
- `/references request [name]` — draft a reference request email to a specific person
- `/references brief [name] [company]` — brief an existing reference for a specific application
- `/references sheet` — produce a formatted reference sheet document

Run the full workflow if no mode is specified.

---

## Step 1: Load Context

Read `CLAUDE.md` and extract:
- Full name and contact info
- Work history (companies, roles, durations, key projects)
- Key achievements and skills most relevant to current target roles
- Any references already listed in the profile

Check `documents/references/` for any existing reference documents.

---

## Step 2: Reference Strategy

### Who makes a good reference?

Rank reference types in order of employer value:
1. **Direct manager** — highest credibility, speaks to day-to-day performance
2. **Senior colleague or skip-level** — validates leadership and technical depth
3. **Cross-functional peer** — demonstrates collaboration and soft skills
4. **Client or external stakeholder** — especially valuable for customer-facing roles
5. **Mentor or professor** — acceptable for early-career; weaker for senior roles

Ideal reference set: 3 people covering at least two different types above.

### Who to avoid:
- Anyone who left the company on bad terms with the user
- Anyone who hasn't worked closely with the user in the past 3–5 years (unless the user has few options — flag this honestly)
- Family members or close personal friends (unless also genuine professional colleagues)

If the user has `CLAUDE.md` content listing past roles and managers, suggest 2–3 specific reference candidates by name/role if available. Otherwise, describe the ideal reference profile for the user's target roles.

---

## Step 3: Reference Request Email

For each reference the user wants to ask, draft a request email that:

- Is warm and personal — not a form letter
- Reminds them of the specific work you did together (one concrete project or achievement)
- Explains the type of role being targeted and why this person is the right reference for it
- Asks explicitly for permission — "Would you be comfortable serving as a reference?" — not "Can you be my reference?"
- Tells them what to expect (who may contact them, roughly when, by what method — phone vs. email)
- Offers to brief them with talking points

Length: 150–250 words. Tone: warm, direct, grateful.

---

## Step 4: Reference Briefing Document

For each confirmed reference, produce a one-page briefing note they can refer to before a reference call or email:

**Briefing Note: [Reference Name] for [Candidate Name]**

**The role I'm applying for:**
[Company, title, brief description]

**What they're likely to ask about:**
[3–4 themes based on the job posting — derive from the application archive if available]

**Key things I'd love you to highlight:**
[3 bullet points — specific, concrete, quantified where possible. Tied to what this employer cares about.]

**Our work together — a quick reminder:**
[2–3 sentences recapping the project/period/context, so the reference can reconstruct the timeline easily]

**Anything to avoid or handle carefully:**
[Only include if relevant — e.g., "If asked about the gap in 2022, I left to care for a family member"]

**My contact details if you have questions before the call:**
[Name, email, phone]

---

## Step 5: Reference Sheet

Produce a clean, formatted reference sheet the user can attach to applications or share on request:

```
PROFESSIONAL REFERENCES
[Candidate Full Name]

[Reference 1 Name]
[Title], [Company]
Relationship: [e.g., Direct manager at Acme, 2021–2023]
Email: [email]
Phone: [phone]
[One sentence on what they can speak to]

[Reference 2 Name]
...

[Reference 3 Name]
...

References available upon request — please notify me before contacting so I can brief them.
```

If reference details aren't in the profile, output the structure with `[VARIABLE]` placeholders.

---

## Output Format

1. **Reference strategy** — who to ask and why (Step 2)
2. **Request emails** — one per reference (Step 3)
3. **Briefing notes** — one per reference (Step 4)
4. **Reference sheet** — ready to attach (Step 5)
