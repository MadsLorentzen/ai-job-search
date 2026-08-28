# Security Policy

## Reporting a vulnerability

Please report security findings privately via GitHub private vulnerability reporting rather than a public issue. You will get a response within a few days, credit in the fix unless you prefer otherwise, and public disclosure coordinated with the patch.

- **Desk app (`gui/`) and any fork-only code:** report to this fork - **[iLevyTate/ai-job-search advisories](https://github.com/iLevyTate/ai-job-search/security/advisories/new)**. The Electron Desk app (which spawns `claude` and binds a local HTTP server) is this fork's code; upstream does not own it.
- **Shared framework (commands, skills, portal CLIs inherited from upstream):** report upstream at **[MadsLorentzen/ai-job-search advisories](https://github.com/MadsLorentzen/ai-job-search/security/advisories/new)**.

If the private form is unavailable, open a public issue that describes the *class* of problem without a working recipe, and note that you have details to share privately.

## Threat model, honestly stated

This is an agentic workflow: an LLM with file access reads untrusted web content (job postings) alongside your personal data (CV, profile, application history). That combination is the main risk surface, and it cannot be fully eliminated - only narrowed. What the framework does about it:

- **Untrusted-input rules**: `/apply` and `/rank` treat posting text as data, never instructions - agents are told not to follow directions embedded in postings and not to fetch URLs found inside posting text (the user-supplied posting URL is the one exception). Reviewer research starts from the company identity the user confirmed, never from links in the posting body.
- **Permission allowlist**: `.claude/settings.json` pre-approves only the specific commands the workflow needs; the `security-guards` CI job fails any PR that widens it, adds package-manifest lifecycle scripts, or weakens the personal-data gitignore rules. Note the allowlist governs Bash commands - the model's native WebFetch/WebSearch tools are outside its reach, which is exactly why the instruction-level rules above exist.
- **Personal data boundaries**: your populated profile, tracker, salary data, and application archive are gitignored; documents never leave the machine by design (`/notion-sync` syncs filenames only; nothing uploads document content anywhere).

Instruction-level defenses raise the bar; they are not a sandbox. If you run this workflow against job boards you do not trust at all, review what the agent fetched and wrote before sending anything out.

## Job Search Desk

The Desk binds only `127.0.0.1`, rejects cross-origin browser POSTs, and matches `Host` exactly. Artifact paths must stay inside the selected workspace: absolute paths, `..`, other drives, UNC, NUL, and symlink/junction escapes are rejected. HTML previews render in a sandboxed iframe with a restrictive CSP and are never injected into the Desk document.

Native Chat permissions use the Claude Agent SDK `canUseTool` callback. **Safe** is manual/default approval and fails closed. It is unrelated to Claude CLI `--safe-mode`. **Autonomous** may enable bypass permissions only for the selected trusted workspace. Allow-for-workspace persists only through documented SDK destinations (`session`, `localSettings`, `projectSettings`).

The embedded Terminal launches only the resolved `claude` executable in the selected workspace. The renderer can send opaque IDs, bounded strings, and bounded resize values. It cannot supply an executable, arguments, environment, or cwd. Opaque Windows `.cmd` shims are not spawned through the PTY.

Autofill review tokens are ephemeral and inherited by the local CLI. The bridge accepts one Continue or Cancel decision. There is no submit endpoint. A Desk restart cancels an orphaned review.

## Scope notes

- Portal CLI skills make live requests only when you run them; CI never does.
- Community fork skills listed in the [forks index](https://github.com/MadsLorentzen/ai-job-search/discussions/78) are **not** covered by this policy - review the code you copy, as the index itself says.
