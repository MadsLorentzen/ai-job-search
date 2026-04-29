# Documents Folder

This folder holds your actual career documents. The `/setup` command reads everything here and uses it to populate the candidate skill files under `.claude/skills/job-application-assistant/`. It is safe to re-run `/setup` as you add new documents — it merges intelligently and will never overwrite existing content without asking you first.

---

## Folder Structure

```
documents/
├── cv/                          # Your CV files (PDF or LaTeX)
├── linkedin/                    # LinkedIn profile export (PDF)
├── diplomas/                    # Degree certificates and transcripts
├── references/                  # Reference letters
├── applications/                # Past job applications
│   └── <company>_<role>/
│       ├── job_posting.md       # The original job posting (paste as text)
│       ├── cover_letter.tex     # The cover letter you submitted
│       ├── cv_draft.tex         # The CV variant you submitted
│       └── outcome.md           # Result + notes (fill in after hearing back)
└── README.md                    # This file
```

---

## cv/

Your master CV — the most complete, unedited version of your professional record.

**Supported formats:** `.pdf`, `.tex`

**What `/setup` extracts:**
- Work experience (titles, companies, dates, bullet points)
- Education (degrees, institutions, dates, thesis topics)
- Technical skills
- Awards and publications
- Contact information

**Naming:** Any filename works. If multiple files are present, `/setup` reads all of them and cross-references for consistency.

**Tip:** Keep your most comprehensive CV here (not a tailored variant). The skill files are the canonical source — tailored CVs are generated per application by `/apply`.

---

## linkedin/

Your LinkedIn profile exported as a PDF.

**How to export:** On LinkedIn, go to your profile → More → Save to PDF. This exports a structured summary of your profile.

**Supported formats:** `.pdf`

**What `/setup` extracts:**
- Work experience and dates (cross-referenced against your CV)
- Skills and endorsements
- Education
- Certifications and licenses
- Volunteer work
- Publications
- About/summary section (used to infer behavioral profile additions)
- Recommendations received (may enrich reference context)

**Naming:** Any filename works. Only one LinkedIn export is expected; if multiple are present, `/setup` uses the most recently modified one.

---

## diplomas/

Degree certificates, transcripts, and any official qualifications.

**Supported formats:** `.pdf`

**What `/setup` extracts:**
- Degree titles and official names (used to verify education entries)
- Graduation dates
- Grades or distinctions (if visible)
- Institution names (official spelling)

**Naming:** Use descriptive names, e.g. `msc_physics_ucph_2025.pdf`, `bsc_physics_ucph_2016.pdf`. Naming does not affect parsing.

---

## references/

Reference letters from former managers, supervisors, or collaborators.

**Supported formats:** `.pdf`, `.txt`, `.md`

**What `/setup` extracts:**
- Referee name, title, and organization
- Specific quotes and assessments (added to the references section of `01-candidate-profile.md`)
- Competency language used by referees (adds behavioral signal to `02-behavioral-profile.md`)

**Naming:** Use the referee's name, e.g. `reference_ole_frandsen.pdf`.

---

## applications/

A record of past job applications. Each subfolder is one application.

**Subfolder naming:** `<company>_<role>` — lowercase, underscores for spaces.

Examples:
```
applications/
├── acme_ml_engineer/
├── bigcorp_software_engineer/
└── consultco_ai_consultant/
```

### Files within each application folder

**`job_posting.md`** — Paste the full job posting text here. Used by `/setup` to infer which skills and role types you have targeted, and to calibrate `04-job-evaluation.md`.

**`cover_letter.tex`** — The cover letter you actually submitted. Used to extract writing style patterns and structure for `06-cover-letter-templates.md`.

**`cv_draft.tex`** — The CV variant you submitted. Used to extract profile statement styles for `05-cv-templates.md`.

**`outcome.md`** — Fill this in after the application resolves. Format:

```markdown
# Outcome: <Company> — <Role>

**Status:** hired | offer_declined | rejected | no_response | interview_only

**Date resolved:** YYYY-MM-DD

## Interview stages reached
- [ ] Phone screen
- [ ] Technical interview
- [ ] Case interview
- [ ] Final round
- [ ] Offer received

## Notes
What happened? What feedback did you receive (if any)?
What would you do differently?
Any signal about what they valued or didn't?
```

**What `/setup` learns from outcome.md:**
- Which role types and companies have led to interviews (signals strong fit areas)
- Which applications did not progress (informs the experience match calibration in `04-job-evaluation.md`)
- Interview feedback, if you recorded it, can surface new STAR candidates

---

## File Format Notes

| Format | Readable by `/setup` | Notes |
|--------|--------------------------|-------|
| `.pdf` | Yes | Parsed directly with the Read tool |
| `.tex` | Yes | LaTeX source — structure and content both readable |
| `.md` | Yes | Plain text |
| `.txt` | Yes | Plain text |
| `.docx` | No | Convert to PDF before placing here |
| `.png` / `.jpg` | No | Scanned documents won't be parsed — use text PDFs |

---

## Re-running `/setup`

The command is designed to be re-run as your document collection grows. Each run:

1. Reads the current state of all skill files
2. Compares extracted document content against what's already there
3. Only proposes changes for content that is genuinely new or conflicting
4. Never silently overwrites — conflicts are shown explicitly for your decision

**When to re-run:**
- After adding a new LinkedIn export
- After adding reference letters
- After recording outcomes for completed applications
- After updating your master CV
