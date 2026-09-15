# Codex setup

Use Codex with this folder as the project root. Its `AGENTS.md` points to the job-search skill, which selects the original workflow files in `.claude/`. Those filenames preserve compatibility with upstream; they do not require a Claude installation.

## Local tools

Use Python 3.10+ and Bun. Create a Python environment from the repository root.

Windows PowerShell:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install pyyaml pypdf
Get-ChildItem .agents/skills/*/cli/package.json | ForEach-Object {
    Push-Location $_.DirectoryName
    try {
        bun install --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed" }
    } finally { Pop-Location }
}
.venv/Scripts/python.exe tools/codex_setup.py
```

macOS or Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install pyyaml pypdf
for manifest in .agents/skills/*/cli/package.json; do
    (cd "$(dirname "$manifest")" && bun install --ignore-scripts) || exit 1
done
.venv/bin/python tools/codex_setup.py
```

Use this environment's Python for repository commands. `pyyaml` validates skills; `pypdf` checks the text in generated PDFs. No model API key is needed by the adapter. Configure access through Codex itself.

## Document tools

Install a LaTeX distribution that provides `lualatex` and `xelatex`. The stock CV uses LuaLaTeX; the cover letter uses XeLaTeX. [SETUP.md](SETUP.md#minimal-tex-install-tinytexbasictex) lists packages for minimal TeX installations.

For PDF rendering and layout checks, install Poppler (`pdftoppm` and `pdftotext`). On macOS, `brew install poppler`; on Debian/Ubuntu, `sudo apt install poppler-utils`. Windows users can install Poppler through their package manager and add its binary folder to PATH.

On Windows, MiKTeX normally installs binaries under `%LOCALAPPDATA%/Programs/MiKTeX/miktex/bin/x64`. Restart the terminal after installation, or add that folder to PATH for the current session. Then run:

```sh
python tools/codex_setup.py --documents
```

This confirms that executables are discoverable, not that LaTeX packages or fonts compile correctly. Compile the stock examples before preparing a real application:

```sh
cd cv
lualatex -interaction=nonstopmode -halt-on-error main_example.tex
cd ../cover_letters
xelatex -interaction=nonstopmode -halt-on-error cover_example.tex
cd ..
python tools/verify_pdf.py cv/main_example.pdf --pages 2 --min-chars 100
python tools/verify_pdf.py cover_letters/cover_example.pdf --pages 1 --min-chars 100
```

Run each command only if the preceding command succeeds. Review rendered pages before treating any generated document as ready to send.

## Start a job search

Open a separate personal working copy in Codex and enter `$job-search-assistant setup`. Supply your own documents or answer the onboarding questions. The public template must keep placeholder data; setup modifies tracked files, including `CLAUDE.md` and the example CV.

After onboarding, use `$job-search-assistant scrape`, then `rank`, then `apply <posting>`. These are skill prompts inside Codex, not terminal commands. Natural-language requests work through the same routing table. The original `/setup` and `/apply` syntax refers to Claude Code commands.

## Runtime differences

| Upstream convention | Codex behavior |
| --- | --- |
| `.claude/commands` and workflow skills | Read the selected file as instructions; keep its state locations |
| Claude file, shell, and browser tools | Use available Codex equivalents and host-appropriate shell syntax |
| Reviewer agents | Use subagents when available and authorized; disclose self-review otherwise |
| `.claude/settings.json` and `allowed-tools` | Do not grant Codex permissions; the active runtime controls access |
| Gmail / Notion sync | Require connected tools; unavailable connectors cannot be simulated |

The adapter uses the model selected in Codex. It does not claim that plain ChatGPT browser conversations can execute the local tools. Candidate documents name only tools the candidate actually used.

## Verification

`python tools/codex_setup.py` checks dependencies and all workflow targets. `python tools/codex_setup.py --portals` returns portal paths as JSON without making network requests. Broken portal installations fail explicitly; newly added CLI-backed portals are discovered automatically.

Run the Codex regression tests with:

```sh
python -m unittest tests.test_codex_support -v
```

The [Codex compatibility workflow](.github/workflows/codex-support.yml) runs the checker and regression tests on Windows and Linux. [CI](.github/workflows/ci.yml) also runs upstream's Python tests, skill validation, and portal CLI tests, and compiles the stock templates. Live portal searches and authenticated Codex sessions are not CI tests. A green build is not evidence of live job availability or application success.

## Keeping the fork current

In a contribution checkout, `origin` should be your fork and `upstream` the original repository. Inspect upstream changes with the existing checker or `git fetch upstream` and `git log HEAD..upstream/master`. Review updates before merging and rerun validation afterward.

The Codex-specific workflow lives in one skill. The only changes to canonical task files are portal discovery in `scrape` and `add-portal`. Candidate profiles and application methodology remain upstream sources, so updates do not require maintaining duplicate workflows.

## References

[Official skill documentation](https://learn.chatgpt.com/docs/build-skills) explains repository skill discovery. [Official AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md) explains how Codex loads project instructions.
