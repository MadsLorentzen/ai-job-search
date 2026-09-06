# /audit - Diagnostic and Health Verification for the Workspace

You are running a comprehensive, read-only diagnostic on the entire AI Job Search workspace.
The purpose of `/audit` is to verify that the local environment, configuration, profile state,
and tracker data are fully coherent and ready for `/scrape`, `/rank`, and `/apply` without runtime surprises.

`/audit` never modifies files; it inspects, evaluates, and presents an actionable diagnostic checklist.

---

## Execution Steps

### Step 0: Environment & Binary Availability

Run non-intrusive version checks to verify required and optional runtimes:

1. **Python runtime**:
   ```bash
   python --version || python3 --version
   ```
   - Must be Python 3.10+. If missing or older, report FAIL.
2. **Bun runtime (for portal search CLIs)**:
   ```bash
   bun --version
   ```
   - If present, report PASS. If absent, report WARN (portal CLIs will degrade to WebSearch fallback per `/scrape` Step 1c).
3. **LaTeX compilers (for CV and cover letter tailoring)**:
   ```bash
   lualatex --version
   xelatex --version
   ```
   - `lualatex`: required for compiling CVs (`cv/main_*.tex`).
   - `xelatex`: required for compiling cover letters (`cover_letters/cover_*.tex`).
   - If missing, report WARN with link to [SETUP.md](SETUP.md#minimal-tex-install-tinytexbasictex).
4. **PDF text extractor**:
   ```bash
   python -c "import pypdf; print(pypdf.__name__)"
   ```
   - Used by `tools/verify_pdf.py` for ATS text layer parsing. If missing, check `pdftotext -v`.

---

### Step 1: Candidate Profile & Onboarding Completeness

Check whether `/setup` has been completed or if template placeholders remain:

1. **Check `CLAUDE.md` and `.claude/skills/job-application-assistant/01-candidate-profile.md`**:
   - Inspect for unresolved sentinel tokens: `[YOUR_NAME]`, `[YOUR_CITY]`, `[YOUR_EMAIL]`, `[YOUR_PRIMARY_SKILLS]`.
   - If present: Status is **Unconfigured (Template Mode)**. Advise running `/setup`.
   - If resolved: Status is **Configured**.
2. **Language Gate Integrity**:
   - Verify that the candidate profile declares at least one working language in the Languages table with a proficiency level.
3. **Template Contact Blocks**:
   - Check if `05-cv-templates.md` or `06-cover-letter-templates.md` contain unpopulated placeholders (`[YOUR_NAME]`, `[YOUR_EMAIL]`, `[YOUR_PHONE]`).

---

### Step 2: Portal Search Skills Status

Scan `.agents/skills/*/SKILL.md`:
1. Discover all installed portals.
2. For each portal:
   - Identify `enabled` status (`true`, `false`, or default enabled).
   - Check if the CLI entry point (`cli/src/cli.ts` or documented command) exists.
   - List enabled portals (active for `/scrape`) and disabled portals (opted out).

---

### Step 3: Application Tracker & Archives Integrity

Inspect `job_search_tracker.csv` (if it exists):
1. **Header validation**:
   - Ensure the 14-column canonical header matches:
     `date,company,role,status,source,fit,salary,contact_person,application_deadline,interview_date,notes,cv_file,cover_letter_file,archive_folder`
2. **Vocabulary check**:
   - Verify each row's `status` uses the canonical vocabulary from `/outcome`:
     `drafted`, `applied`, `interview`, `offer`, `hired`, `rejected`, `ghosted`, `withdrawn`, `offer_declined`.
3. **Artifact existence**:
   - For rows with `cv_file` or `cover_letter_file`, check if the referenced `.tex` (or `.pdf`) exists on disk.
   - If an `archive_folder` is declared, check if the folder exists under `documents/applications/`.

---

### Step 4: Upstream Updates & Security Guards

1. **Framework Version Check**:
   - Run:
     ```bash
     python tools/check_framework_version.py
     ```
   - Checks if methodology files under `.claude/skills/` have matching framework version markers.
2. **Security & Permissions**:
   - Run:
     ```bash
     python tools/security_guards.py
     python tools/lint_skills.py
     ```
   - Validates `.claude/settings.json` permissions allowlist and frontmatter schemas.

---

### Step 5: Diagnostic Report & Actionable Next Steps

Present the audit summary as a clean, structured diagnostic report:

```markdown
## Workspace Audit Report — YYYY-MM-DD

### Environment & Toolchain
- Python: [PASS: version / FAIL]
- Bun: [PASS: version / WARN: missing, WebSearch fallback active]
- LaTeX: [PASS: lualatex & xelatex ready / WARN: missing]
- PDF Text Extractor: [PASS: pypdf / WARN: missing]

### Profile & Configuration
- Profile Setup: [Configured / Unconfigured (run /setup)]
- Languages Gate: [PASS: N languages declared / WARN: none declared]
- Contact Blocks: [PASS: populated / WARN: placeholders remain]

### Portal Skills
- Active (Enabled): [list of enabled portals]
- Opted-Out (Disabled): [list of disabled portals]

### Tracker & Data Integrity
- Tracker Rows: [N total: X active, Y completed]
- Header & Vocabulary: [PASS / WARN: unexpected status values]
- Document Archives: [PASS / WARN: N missing referenced files]

### Framework & Security Guards
- Framework Integrity: [PASS / WARN]
- Security Guards & Linter: [PASS / FAIL]

### Actionable Next Steps
1. [Prioritized recommendation based on findings, e.g., run /setup, install lualatex, or run /scrape]
```
