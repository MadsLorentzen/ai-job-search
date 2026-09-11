# Local Setup Guide

## 1. Install prerequisites

Install:

- Python 3.10+
- Ollama for Windows
- Bun for the independent portal CLIs
- MiKTeX, TeX Live, or another LaTeX distribution providing `lualatex` and `xelatex`
- Poppler tools providing `pdfinfo` and `pdftotext`

No Anthropic account, paid API, Claude runtime, or MCP server is required.

## 2. Verify Ollama

Start Ollama and inspect the existing local models:

```powershell
ollama --version
ollama list
py -c "from app.llm.ollama import OllamaProvider; provider=OllamaProvider(); print(provider.health_check()); print(provider.list_models())"
```

Do not download or delete a model automatically. Configure the local provider to use an installed model appropriate for the task.

## 3. Install portal CLI dependencies

```powershell
$tools = @("jobbank-search", "jobdanmark-search", "jobindex-search", "jobnet-search", "linkedin-search", "freehire-search")
foreach ($tool in $tools) {
  Push-Location ".agents/skills/$tool/cli"
  bun install
  Pop-Location
}
```

LinkedIn and FreeHire have no runtime dependencies; installation is useful for their TypeScript checks.

## 4. Add candidate documents

Use the layout documented in [documents/README.md](documents/README.md):

- `documents/cv/` for the master CV
- `documents/linkedin/` for a LinkedIn export
- `documents/diplomas/` for degree evidence
- `documents/references/` for references
- `documents/applications/` for archived applications

The master CV is the source of truth for historical facts. `CLAUDE.md` stores application preferences such as target roles, compensation, remote constraints, and career goals.

## 5. Run the local workflow

The local Python modules provide the migration core:

- Profile import and numbered approval: `app.profile`
- Job normalization and filtering: `app.jobs`
- Ranking: `app.ranking`
- Application evaluation, drafting, and review: `app.applications`
- Persisted workflow: `app.orchestrator`
- Interview preparation: `app.interview`
- Upskill analysis: `app.upskill`
- Offline report: `app.reporting`
- PDF and ATS checks: `app.documents`

Gmail and Notion integrations are intentionally disabled. They have no credentials, OAuth flow, or legacy data-mapping behavior.

## 6. Validate the installation

```powershell
py -m unittest discover -s tests -t . -v
```

Example document smoke checks:

```powershell
Set-Location cv
lualatex -interaction=nonstopmode -halt-on-error main_example.tex
Set-Location ..
Set-Location cover_letters
xelatex -interaction=nonstopmode -halt-on-error cover_example.tex
Set-Location ..
```
