# Contributing

Thanks for considering a contribution! This repo has a deliberate, narrow philosophy, and most declined PRs are well-executed work that simply didn't know about it. Read this first; it will save you effort and tell you where your work will land best.

## The one rule everything follows from

**This repo is a universal template.** People fork it and adapt it to their own market, language, and profile. Upstream stays market-agnostic, person-agnostic, and Claude Code-native. The corollary: a contribution is judged by fit to this rule first, execution quality second. Well-built but off-policy still gets declined (kindly, with reasons).

## What gets merged

- **Universal customization features**: anything that makes the fork-and-adapt path better for everyone. Precedent: `/add-template` ([#30]), `/add-portal` ([#37]).
- **Robustness and correctness fixes** with the failing case demonstrated. Precedent: NaN flag validation ([#35]), HTML entity decoding ([#55], [#56]), salary column detection ([#64]).
- **Docs that close real gaps**: platform-specific setup ([#41], [#60]), stale references ([#36], [#68]).
- **Infrastructure that reduces review burden** and is argued from evidence, not speculation. Precedent: CI ([#59]), which caught a latent bug while being built.

## What gets declined

- **Market- or country-specific skills and content.** One country's portal opens the door to every country's portal; there is no principled stopping point. Precedent: [#31] (India), [#39] (France, despite an honest and excellent PR), [#67] (China). The in-tree portal skills are either country-agnostic (`linkedin-search`) or the maintainer's own demonstration instance (the Danish portals).
- **Personal profile data.** The template ships placeholders; your populated profile lives in your fork. CI enforces this (`placeholder-integrity`). Precedent: [#17], [#72].
- **Alternative-harness ports and duplicate workflow sources.** The markdown specs ARE the implementation; a second copy (another agent CLI, an orchestration layer, a wrapper command) drifts from the first the moment either changes. Precedent: [#44], [#49], [#66].
- **Speculative infrastructure.** Complexity must be argued from a problem that exists, not one that might. Precedent: [#63].
- **Kitchen-sink PRs.** One concern per PR. Bundles get asked to split ([#73]) - and splits get reviewed fast ([#75], [#76] arrived within the hour and were handled same-day).

## The bar for new commands

The core lifecycle is **feature-complete**: `/setup` → `/scrape` → `/rank` → `/apply` → `/interview` → `/outcome` → calibration back into `/setup`, with `/expand`, `/upskill`, `/add-template`, `/add-portal`, and `/reset` around it. Every stage of a real job hunt has an owner.

A new command therefore faces a high bar. The test that admitted the existing ones: **does it operationalize something error-prone that already exists in the framework** (documented machinery nothing executes, data something writes but nothing reads)? "Useful" and "possible" are not sufficient; the strongest proposals connect two things that already exist without modifying either ([#43], [#54]).

## Claims get verified

Reviews here are empirical. Bug reports are reproduced on master before the fix is considered; "all tests green" is checked against whether the tests can distinguish master from the fix. PRs whose premise doesn't reproduce get declined even when the code is fine - it has happened ([#35]'s converter fix, [#52]'s first version). You can make this fast:

- State the failing case and how to reproduce it.
- Put CLI tests in `.agents/skills/<name>/cli/tests/` (bun test, network-free where possible); Python tool tests in `tests/`.
- Run what CI runs: `python3 tools/lint_skills.py` (or `python tools/lint_skills.py` if that is your Python 3 executable), `bun run typecheck` in touched CLIs, and the relevant test suites.

**Credit norm:** a change that incorporates your actual code gets a `Co-authored-by` trailer; a change written independently from your observation or report gets a named mention in the commit message and PR. Both happen unprompted.

## Building for your own market? Do this instead

1. Fork the repo and run `/add-portal` with your local job board - it scaffolds a portal skill matching the shipped contract, and `/scrape` picks it up automatically.
2. Announce your fork in the pinned [Community forks & adaptations](https://github.com/MadsLorentzen/ai-job-search/discussions/78) discussion so others can find it.

Market-specific skills are genuinely valuable - they just live in forks, where their maintainers can test them and their users can find them.

## Practical notes

- **Portal-skill contract**: `search`/`detail` commands, `--format json|table|plain`, stderr JSON errors with exit 1, backoff on 429/5xx, zero runtime dependencies by default. See `/add-portal`'s spec and `linkedin-search` as the reference implementation.
- **Personal-use boundaries**: portal skills that touch ToS-restricted sources carry a prominent personal-use-only warning, and CI deliberately makes no live portal requests. Don't "fix" that.
- **LaTeX changes**: both templates must compile (`lualatex` for the CV, `xelatex` for the cover letter) and hold their exact page counts. CI smoke-checks this.

Questions and proposals are welcome in [Discussions](https://github.com/MadsLorentzen/ai-job-search/discussions) - an Idea thread costs nothing and can save you building the wrong thing :-)

[#17]: https://github.com/MadsLorentzen/ai-job-search/issues/17
[#30]: https://github.com/MadsLorentzen/ai-job-search/issues/30
[#31]: https://github.com/MadsLorentzen/ai-job-search/issues/31
[#35]: https://github.com/MadsLorentzen/ai-job-search/issues/35
[#36]: https://github.com/MadsLorentzen/ai-job-search/issues/36
[#37]: https://github.com/MadsLorentzen/ai-job-search/issues/37
[#39]: https://github.com/MadsLorentzen/ai-job-search/issues/39
[#41]: https://github.com/MadsLorentzen/ai-job-search/issues/41
[#43]: https://github.com/MadsLorentzen/ai-job-search/issues/43
[#44]: https://github.com/MadsLorentzen/ai-job-search/issues/44
[#49]: https://github.com/MadsLorentzen/ai-job-search/issues/49
[#52]: https://github.com/MadsLorentzen/ai-job-search/issues/52
[#54]: https://github.com/MadsLorentzen/ai-job-search/issues/54
[#55]: https://github.com/MadsLorentzen/ai-job-search/issues/55
[#56]: https://github.com/MadsLorentzen/ai-job-search/issues/56
[#59]: https://github.com/MadsLorentzen/ai-job-search/issues/59
[#60]: https://github.com/MadsLorentzen/ai-job-search/issues/60
[#63]: https://github.com/MadsLorentzen/ai-job-search/issues/63
[#64]: https://github.com/MadsLorentzen/ai-job-search/issues/64
[#66]: https://github.com/MadsLorentzen/ai-job-search/issues/66
[#67]: https://github.com/MadsLorentzen/ai-job-search/issues/67
[#68]: https://github.com/MadsLorentzen/ai-job-search/issues/68
[#72]: https://github.com/MadsLorentzen/ai-job-search/issues/72
[#73]: https://github.com/MadsLorentzen/ai-job-search/issues/73
[#75]: https://github.com/MadsLorentzen/ai-job-search/issues/75
[#76]: https://github.com/MadsLorentzen/ai-job-search/issues/76
