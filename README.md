# AI Job Search

![Pip, the courier bird](assets/mascot/pip_flight_loop.gif)

A local job-search and application workflow powered by Ollama. The Python application combines deterministic job collection, filtering, ranking, profile approvals, application drafting, independent review, LaTeX compilation, PDF validation, ATS extraction, and tracker persistence.

## Architecture

- `app/` - local orchestrator, provider-neutral LLM layer, profile workflow, ranking, application drafting/review, PDF/ATS validation, reporting, and disabled connector contracts.
- `.agents/skills/` - independent Bun/TypeScript job-portal CLIs.
- `cv/` and `cover_letters/` - LaTeX templates and bundled fonts.
- `documents/` - candidate source material and application archives.
- `app/policies/` - provider-neutral profile, evaluation, writing, and document rules.
- `tools/` - deterministic salary, robots, security, and PDF utilities.

The local application never sends applications or external messages automatically. Candidate facts and final documents require human approval.

## Prerequisites

- Python 3.10+
- Ollama running at `http://localhost:11434`
- Bun for portal CLIs
- `lualatex` and `xelatex`
- `pdfinfo` and `pdftotext` for PDF/ATS checks

The application uses the installed local Ollama model selected by the provider configuration. It does not download models or require paid APIs.

## Quick start

Start Ollama, then verify the local service:

```powershell
ollama list
py -c "from app.llm.ollama import OllamaProvider; print(OllamaProvider().health_check())"
```

Install portal CLI dependencies if needed:

```powershell
$tools = @("jobbank-search", "jobdanmark-search", "jobindex-search", "jobnet-search", "linkedin-search", "freehire-search")
foreach ($tool in $tools) {
  Push-Location ".agents/skills/$tool/cli"
  bun install
  Pop-Location
}
```

Place source documents in `documents/`, then use the profile workflow from Python. The master CV remains authoritative for historical facts; `CLAUDE.md` remains the preference source. Every proposed change is displayed as a numbered approval item.

## Deterministic document pipeline

CVs compile with `lualatex`; cover letters compile with `xelatex`. The local pipeline checks exact page counts, extracts text with `pdftotext -layout`, validates required text and glyph quality, and keeps generated files under explicit repository boundaries.

## Security

Job postings are untrusted data. They are never executed as instructions or shell commands. LLM output is schema-validated and cannot select unrestricted paths or perform external writes. Gmail and Notion connectors are disabled by default and contain no credentials or OAuth logic.

See [SECURITY.md](SECURITY.md), [documents/README.md](documents/README.md), and the policy files under `app/policies/` for details.
