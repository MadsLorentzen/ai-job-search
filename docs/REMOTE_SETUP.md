# Remote Brazil / USD edition

This fork uses the upstream Claude Code workflow, with Brazil/LATAM remote eligibility,
USD 4,500/month base screening and AI/DS/DE role-specific tailoring. Industry preference:
automotive, mobility, batteries and industrial data; other relevant industries remain in scope.

## Windows desktop setup

From a clone of juniortlr/ai-job-search, with Python 3.10+, run:

```powershell
python tools/create_private_workspace.py
cd ..\ai-job-search-private
claude
```

The helper copies tracked framework files into a new sibling folder, without `.git`,
adds an ignore-all rule and records the source commit. It refuses to overwrite an
existing folder or create the workspace inside another Git repository. Your public
checkout remains an updateable framework; personal work happens in the separate copy.
It is not encryption or an automatic backup. Do not initialize Git or force-add its
personal files to a public repository. Keep a private local backup yourself.

In the private workspace, add your complete resumes to documents/cv/, LinkedIn PDF
export to documents/linkedin/, letters to documents/references/ and transcripts to
documents/diplomas/. Record GitHub/portfolio URLs and project ownership during /setup.
No actual candidate bio has been published by this adaptation. Verify dates, titles,
metrics and unfinished research status before using them in applications.

Inside Claude Code:

```text
/setup
/expand
/scrape
/rank
/apply <job URL or full posting text>
/interview
```

/setup keeps the remote-market defaults. /expand proposes evidence-backed additions;
review inferred skills. /apply tailors CVs/cover letters and portal answers, reviews and
compiles PDFs. It does not submit forms or automatically apply while you sleep.

Bun is needed for the existing Freehire CLI; Python sources use the standard library.
LaTeX and PDF tooling are still needed for document generation: follow upstream SETUP.md.
Cloud model processing is not offline: supplied career text can go to your model provider.

## Search coverage

Freehire is enabled; Danish and LinkedIn scraping CLIs are disabled. Added read-only
Python discovery for WWR, Greenhouse and Lever. For the latter two, put known company
board slugs in config/company-boards.json in your private workspace. Wellfound and
Ashby are public search/manual posting inputs, not implemented submission adapters.
Live source availability can change; source errors are reported separately.

Unknown salary/currency/Brazil eligibility belongs in a separate clarification list.
Sourced estimates are labeled; USD display is not proof of payment currency. Annual
base is compared over 12 months; hourly estimates require supplied paid hours/month.

## Updating

Pull upstream updates in the public framework checkout and review conflicts with this
fork's policy files. Create a fresh private workspace with an explicit new destination,
then migrate your private profile/documents locally after reviewing changes. This
release does not automatically merge updates into personalized workspace copies.

## Validation

```powershell
python -m unittest tests.test_remote_market -v
python tools/lint_skills.py
python tools/security_guards.py
```

The private workspace helper and eligibility gate are tested without network access.
No live applications are sent by tests. Existing upstream license and attribution remain.
