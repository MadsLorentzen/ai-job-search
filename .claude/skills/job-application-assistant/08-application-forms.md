---
framework_version: 1.0.0
---

# Application Form Fields

`/apply` produces two artifacts: a CV and a cover letter. Many applications need a **third** — free-text fields typed directly into an application portal. Graduate programs, large-employer ATS systems and startup forms routinely ask for things neither document covers, under a character or word limit, in a box with no formatting.

This file governs that third artifact. It is not a document you compile; it is text the candidate pastes.

## When this applies

Trigger it whenever a posting or portal asks for any of:

- A self-introduction / personal statement / "tell us about yourself" paragraph
- Structured project entries (project name, role, start and end date, description)
- A short pitch under a hard character limit ("stand out in 140 characters", "why you, in one sentence")
- Motivation questions ("why this company", "why this program")
- Competency questions with a word cap ("describe a time you…", 200 words)

## The rule that governs everything here

**Every claim in a form field must already be defensible from the same sources the CV and cover letter are grounded against** — the union of `01-candidate-profile.md`, the master CV (`cv/main_example.tex`), and `CLAUDE.md`'s Candidate Profile section, with a claim grounded if ANY of the three supports it. The interviewer reads the form alongside the CV. A form field is not a place to introduce new claims, inflate scope, or fill space — it is a place to *select* from what is already true and arrange it for the question asked.

All accuracy rules from `05-cv-templates.md` and `03-writing-style.md` apply unchanged.

## Field type: self-introduction paragraph

Usually 100–200 words, one paragraph, no formatting.

**Structure that works:**
1. Current status — what they are doing or completing now
2. The single strongest piece of evidence, with its number and scale
3. One line of trajectory: how they got here, if a pivot or specialisation is genuinely interesting
4. What they want next, connected to this employer's actual work

**Rules:**
- **Lead with the strongest evidence, not chronology.** A career history told in order buries the best material when the strongest work is recent.
- **Write one version per role type, not one for all applications.** The same history framed for a backend role and a data role are different paragraphs. Produce both, label them, and say which goes where.
- **Tie it to this employer in the final sentence.** Generic self-introductions are the default and read as such.
- **Count the words and state the count.** Portals truncate silently. Supply a trimmed variant and name which sentence to cut first.

## Field type: structured project entries

Typically **project name, role, start date, end date, description.**

**Project name.** Give the project a descriptive name, not the employer's name — "Warehouse Inventory Forecasting Platform" is a project, "Acme Corp" is an employer. Where a client is more recognisable than the employer, name the client only if the relationship is truthful (placed on-site with, delivered to).

**Role.** The candidate's role *on that project*, which may be narrower than their job title. Do not upgrade it.

**Dates.** The dates they worked on **that project**, which are not automatically the employment dates. If a role spanned two years but the named project occupied the later part, saying so is both more accurate and avoids the low-output reading described in `05-cv-templates.md` ("Check tenure against visible output"). Only narrow the dates when the candidate can say when the project actually started — never invent a boundary to improve the ratio.

**Description.** 100–150 words: what the system did and who used it, then the hardest technical problem and how it was solved, then the outcome with its number. Supply a **~60-word short version** as well; portals vary and the candidate should not have to improvise a cut.

**Scope discipline is stricter here than on a CV.** A CV bullet can be terse enough to be ambiguous about ownership. A project entry with the candidate's name and role attached reads as ownership of the whole thing. Where they contributed rather than owned, say so inside the description.

## Field type: hard character limits

These reward **a specific situation over an adjective**. Most applicants submit adjectives — "passionate", "fast learner", "team player" — so a concrete situation stands out by contrast.

**Method:**
1. Pick the single most distinctive true thing: usually a number, an unusual combination of backgrounds, or a problem shape that maps onto the employer's own work.
2. Draft 4–6 candidates at different angles.
3. **Count characters programmatically. Do not estimate.** Over-limit text is truncated mid-word.
4. Present all candidates with counts, recommend one, and say why.

Prefer the version that **maps the candidate's problem onto the employer's problem**, where a truthful mapping exists. That is what "stand out" is actually asking for.

## Output format

Save to a plain `.txt` file the candidate can copy from, alongside their other application material for that employer. One file per employer, containing every field that employer asked for.

Include:
- A header naming the employer and the roles it covers
- Each field, labelled, with word or character counts stated
- Short variants where limits may be tighter than expected
- **`NOTE TO SELF` blocks** for scope reminders and prepared answers to questions the content invites — clearly marked as *not for pasting into the form*
- A dates quick-reference, so date fields stay consistent without re-deriving them

## Verification before handing it over

- [ ] Every factual claim traces to the union of `01-candidate-profile.md`, the master CV (`cv/main_example.tex`), and `CLAUDE.md`'s Candidate Profile section
- [ ] No claim contradicts the CV or cover letter submitted for the same role
- [ ] Ownership scoped correctly on contributory work
- [ ] Word and character counts measured, not estimated
- [ ] In-progress qualifications described as in progress
- [ ] `NOTE TO SELF` blocks clearly marked as internal
