# AI Job Search for Codex

<img src="assets/mascot/pip_flight_loop.gif" alt="Pip, the upstream project mascot" width="120">

[![CI](https://github.com/Havocx01/ai-job-search-codex/actions/workflows/ci.yml/badge.svg)](https://github.com/Havocx01/ai-job-search-codex/actions/workflows/ci.yml)
[![Codex compatibility](https://github.com/Havocx01/ai-job-search-codex/actions/workflows/codex-support.yml/badge.svg)](https://github.com/Havocx01/ai-job-search-codex/actions/workflows/codex-support.yml)

Use OpenAI Codex to search for jobs, evaluate fit, and prepare application documents. This fork adapts [Mads Lorentzen's AI Job Search](https://github.com/MadsLorentzen/ai-job-search) for Codex while retaining its workflow specifications and portal tools.

Open the repository in Codex and ask for the task you need. Claude Code is not required. This is a community fork; the original project and OpenAI do not maintain this adaptation.

## What changed

- Added a Codex workflow skill that routes requests to **14 existing workflows**, so setup and application tasks use the same source instructions.
- Fixed portal discovery to identify CLI-backed skills, keeping the workflow adapter out of job-board searches. Added local prerequisite checks and compatibility tests for this behavior.

The original framework, document templates, and **6 portal CLIs** come from upstream. The Codex layer contains no separate model API client and does not select a model for you.

## Quick start

### 1. Fork and clone

For a personal job search, create a local working copy:

```sh
git clone --origin upstream https://github.com/Havocx01/ai-job-search-codex.git my-job-search
cd my-job-search
```

For contributing changes, create your own fork instead:

```sh
gh repo fork Havocx01/ai-job-search-codex --clone
cd ai-job-search-codex
```

**Forks are public.** Setup writes personal data into tracked profile and template files. Use a local-only copy or a private repository for your own applications; `.gitignore` cannot hide changes to tracked files. See [SETUP.md section 8](SETUP.md#8-pulling-upstream-updates-into-your-fork) for the private-repository approach, using this fork as the upstream source. Keep the public contribution checkout on placeholders.

### 2. Install and check tools

Install Python 3.10+ and [Bun](https://bun.sh). Use [CODEX_SETUP.md](CODEX_SETUP.md) for environment setup and document tools on Windows, macOS, or Linux.

```sh
python -m pip install pyyaml pypdf
python tools/codex_setup.py
```

The check reports missing prerequisites and verifies workflow paths. It does not run job searches or change your files.

### 3. Open the folder in Codex

Use a configured Codex installation and choose your usual model. In the conversation, enter:

```text
$job-search-assistant setup
```

You can also say: `Set up my job-search profile using this repository.` Codex loads the repository skill automatically when the request matches it. If the skill does not appear, restart the session from this folder.

## Example workflow

```text
$job-search-assistant scrape
$job-search-assistant rank
$job-search-assistant apply <job URL or pasted posting>
$job-search-assistant interview <tracked application>
```

Setup uses your supplied experience and preferences. Scrape collects postings through the installed portals; rank scores them against your profile. Apply evaluates a posting and prepares document drafts. Sending an application requires your instruction.

Additional workflows cover outcomes and follow-ups, profile expansion, upskilling, and a local pipeline report. The [workflow map](.agents/skills/job-search-assistant/SKILL.md) includes template and portal customization. Gmail and Notion sync need corresponding connected tools.

## Verification and limits

The compatibility workflow runs on Windows and Linux. The inherited CI checks the framework and portal CLIs, including example LaTeX builds. These checks validate files and tools; they do not prove that every Codex session or live job board will succeed. See [verification details](CODEX_SETUP.md#verification).

The stock CV is two pages and the cover letter is one page. Use `add-template` if you need another format. Real documents still need a factual review and visual PDF check.

## Contributing and credit

Keep Codex changes in this fork and follow [CONTRIBUTING.md](CONTRIBUTING.md). General framework fixes can go upstream. Its maintainer asks that runtime adaptations remain in [community forks](https://github.com/MadsLorentzen/ai-job-search/discussions/78).

Original project by [Mads Lorentzen and contributors](https://github.com/MadsLorentzen/ai-job-search). Codex adaptation maintained by [Adam Qablawi](https://github.com/Havocx01). Distributed under the original [MIT license](LICENSE).
