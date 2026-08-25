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

**Every claim in a form field must already be defensible from the same sources the CV and cover letter are grounded against** — the union of `01-candidate-profile.md`, the master CV (`cv/main_example.tex`), and `AGENTS.md`'s Candidate Profile section, with a claim grounded if ANY of the three supports it. The interviewer reads the form alongside the CV. A form field is not a place to introduce new claims, inflate scope, or fill space — it is a place to *select* from what is already true and arrange it for the question asked.

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

## Field type: structured project entry

Usually: *Project name*, *Role*, *Start / End*, *Description* (100–300 words).

**Structure for the description:**
- Line 1: What the system does, who uses it, and at what scale
- Line 2: The specific engineering / modelling choices made and why (tools, algorithms, constraints)
- Line 3: The measured outcome (runtime improvement, latency, revenue, publication, user count)
- Line 4: Your individual contribution, especially if the project was collaborative

**Rules:**
- **Answer the question the reviewer actually has:** "Did this person do the hard parts or watch someone else do them?" Make the individual verbs unambiguous.
- **Use the project's real public name or an honest descriptive title.** No internal-only codenames unless explained in one clause.

## Field type: short pitch (character-capped)

Usually 140–280 characters.

**Pattern:** `[Role / specialty] with [strongest concrete achievement with number], focused on [what you will build for them next].`

**Rules:**
- Count characters, not words. Provide the exact character count with each option so the candidate does not have to verify it in the form.
- Provide two options: one leading with technical depth, one leading with business outcome.

## Field type: motivation ("why this company / program")

Usually 150–250 words.

**Structure:**
1. The specific product, technical challenge, or paper from this employer that caught your attention — named explicitly, not generic praise
2. Why that problem matches what you have already been working on (the bridge to your experience)
3. What you bring to that specific challenge that accelerates their progress

**Rules:**
- Must pass the **substitution test**: if you could replace the company's name with a competitor's and the paragraph still makes sense, delete it and start over.
- Grounded in verified research per `09-web-research.md`. No unverified claims about the company.
