# Application Answers

The canonical source for the screening questions that show up on almost every
application form — identity, work authorization, availability, compensation,
years-of-experience dropdowns, and the handful of short answers that get asked
over and over. `/submit` reads this file before filling any form and appends
newly-answered questions back to it, so the same question never has to be
answered twice.

Copy this file to `application_answers.md` (gitignored — it holds personal
data) and fill in your own answers. Delete any section that does not apply to
you; `/submit` skips sections that are missing rather than guessing.

---

## Identity & Contact

- **Full legal name:** [YOUR_LEGAL_NAME]
- **Preferred name (if different):** [PREFERRED_NAME]
- **Email:** [YOUR_EMAIL]
- **Phone (with country code):** [YOUR_PHONE]
- **Current location (city, country):** [YOUR_LOCATION]
- **LinkedIn URL:** [YOUR_LINKEDIN_URL]
- **GitHub / portfolio URL:** [YOUR_PORTFOLIO_URL]
- **Other profile URL (Behance, Dribbble, personal site, etc.):** [OTHER_URL]

## Work Authorization & Location

- **Authorized to work in [PRIMARY_COUNTRY] without sponsorship?** [YES/NO]
- **Will you now or in the future require visa sponsorship?** [YES/NO]
- **Willing to relocate?** [YES/NO — and to which regions, if conditional]
- **Open to remote / hybrid / onsite?** [YOUR_PREFERENCE]
- **Commute radius (if onsite/hybrid matters):** [YOUR_RADIUS]

## Availability

- **Notice period:** [E.G. "2 weeks" / "1 month" / "immediately available"]
- **Earliest possible start date:** [YOUR_EARLIEST_START_DATE, or "negotiable"]

## Compensation

State a floor and a target per market you apply in — forms usually ask for one
number, and having the range decided in advance stops you from answering under
pressure mid-form.

- **[MARKET_1] (e.g. local monthly, in local currency):** floor [FLOOR_1], target [TARGET_1]
- **[MARKET_2] (e.g. remote USD, monthly or annual):** floor [FLOOR_2], target [TARGET_2]
- **Absolute floor (never go below, any market):** [YOUR_FLOOR]
- **Notes on flexibility:** [E.G. "negotiable for strong learning opportunities" / "firm"]

## Years of Experience (for dropdown fields)

List enough primary skills/tools that most dropdown questions are answered
without asking. Use whole numbers or the nearest bucket the posting offers
(e.g. "0-1", "1-3", "3-5", "5+").

| Skill / Tool | Years |
|---|---|
| [SKILL_1] | [N] |
| [SKILL_2] | [N] |
| [SKILL_3] | [N] |

## Short-Answer Library

Keep these as skeletons, not finished prose — `/submit` fills in the
company-specific detail from the posting each time, never pastes these
verbatim into a form.

**Why this company? (skeleton)**
[A 2-3 sentence shape you reuse: what you look for in an employer + a slot for
the company-specific reason, filled in per application.]

**Why are you leaving / why are you looking?**
[YOUR_HONEST_ANSWER — keep this factual and forward-looking, not a complaint
about the current/previous employer.]

**Biggest achievement (≤200 words):**
[YOUR_ANSWER — a concrete, metric-backed story you're comfortable retelling in
an interview if asked to expand on it.]

**How did you hear about us?**
[YOUR_DEFAULT_ANSWER — e.g. "job board" / "referral" / "company research";
override per application when the actual channel is known (LinkedIn outreach,
a referral, a specific job board).]

**EEO / diversity questions (optional, jurisdiction-dependent):**
[YOUR_DEFAULT — many forms let you select "decline to answer"; state your
default choice here so `/submit` doesn't have to ask every time.]

## Screening Yes/No Defaults

Common yes/no questions and your standing answer. Add rows as new ones show up
across applications.

| Question | Default Answer |
|---|---|
| Do you have a criminal record? | [YOUR_ANSWER] |
| Are you currently employed? | [YOUR_ANSWER] |
| Can you pass a background check? | [YOUR_ANSWER] |
| Are you 18 years or older? | [YOUR_ANSWER] |
| Do you have reliable internet/equipment for remote work? | [YOUR_ANSWER] |

## Default CV Attachment

Which compiled CV PDF to attach when a form is filled for a job that has no
tailored `cv/main_<company>_<role>.pdf` yet (e.g. a quick apply from a
listing page before running `/apply`).

- **Default CV file:** [PATH_TO_YOUR_DEFAULT_CV_PDF, e.g. "cv/main_example.pdf"]

---

## Self-Improving Rule

When `/submit` hits a question this file doesn't answer, it stops and asks you
directly — it never invents an answer. Once you answer, `/submit` appends the
question and your answer to the relevant section above (asking first if it's
unclear which section fits), so the next form that asks the same thing is
answered automatically.
