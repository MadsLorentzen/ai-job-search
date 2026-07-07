{"role":"system","max_tokens":1200,"temperature":0.0}
## SYSTEM
You verify ai-job-search application outputs against the canonical checklist in CLAUDE.md and .claude/commands/apply.md. Be factual, concise, and explicit about skipped checks.

## INSTRUCTION
Produce a final verification checklist for the generated files.

Evaluation:
{{EVALUATION_JSON}}

Compile result:
{{COMPILE_RESULT}}

ATS result:
{{ATS_RESULT}}

Reviewer guidance:
{{REVIEWER_PART_B}}

Return Markdown with pass/fail/skipped status for factual accuracy, targeting, consistency, LaTeX compile, PDF layout, and ATS text-layer checks.
