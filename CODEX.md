# Using AI Job Search with Codex in VS Code

Open `ai-job-search-codex.code-workspace` in VS Code, install the recommended OpenAI Codex extension, and sign in. Start a local Codex chat from the repository root so Codex loads `AGENTS.md` and discovers `.agents/skills/`.

Start with `$setup`. Then use `$scrape`, optionally `$rank`, and `$apply <job URL or pasted posting>`. Type `$` in the Codex composer to select any installed project skill. Skills can also activate implicitly from a plain-language request.

The original workflow specifications remain under `.claude/` for upstream compatibility. The files in `.agents/skills/` are the Codex-native entry points and deliberately point to those canonical specs instead of duplicating them.

Local prerequisites are Python 3.10+, Bun, and a LaTeX distribution providing `lualatex` and `xelatex`. Poppler's `pdftotext` is optional. Install each portal CLI's dependencies as documented in `SETUP.md`.

Generated profiles, trackers, documents, and reports can contain personal data; do not push them to a public repository.
