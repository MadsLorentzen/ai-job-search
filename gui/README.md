# Job search desk

A localhost desk that talks to Claude Code in this repo. Native Chat, a Claude-only Terminal tab, and Files/Artifacts share one workspace and one conversation. Works on **macOS, Windows, and Linux**.

## Install the app

Download **Job Search Desk** from [Releases](https://github.com/iLevyTate/ai-job-search/releases):

| OS | Installer |
| --- | --- |
| Windows | `JobSearchDesk-*-win-x64.exe` (one-click NSIS) or the portable `.exe` |
| macOS Apple Silicon | `JobSearchDesk-*-mac-arm64.dmg` |
| macOS Intel | `JobSearchDesk-*-mac-x64.dmg` |
| Linux | `JobSearchDesk-*-linux-x64.AppImage` |

Then:

1. Run the installer. On Windows it adds Start Menu and Desktop shortcuts and launches the app when setup finishes. macOS: open the `.dmg` and drag the app to Applications. Linux: mark the AppImage executable and run it.
2. Open an existing job-search folder, or create a new copy of the public repo (downloads it; Git is optional).
3. The desk opens the conversation if you are already signed in. It only asks you to sign in when Claude Code reports you are signed out. If Claude Code is missing, it offers Anthropic's official installer, then the **claude.ai** login: the same Claude Pro / Max / Team / Enterprise account you use in Chrome.
4. Optional: install [Claude in Chrome](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn) if you want the browser extension connected later.

A second click of the shortcut focuses the window that is already running. It does not start a second desk.

macOS Gatekeeper: the release is unsigned. In Finder, right-click the app → **Open**.

The app does not replace `/setup`. After you are signed in, run **Setup** once so the repo has your profile.

## Start from a clone

From the repo root:

```bash
node gui/server.mjs
```

Same folder, terminal instead of the page:

```bash
node gui/server.mjs --cli
```

Or `bun gui/server.mjs`. Wrappers: `./gui/start.sh` (macOS / Linux) or `.\gui\start.ps1` (Windows). Add `--cli` to those too. From `gui/`: `npm start` or `npm run cli`.

Desk and Claude Code share one workspace pointer (`%APPDATA%\ai-job-search\workspace.json` on Windows, `~/Library/Application Support/ai-job-search/workspace.json` on macOS, `~/.config/ai-job-search/workspace.json` on Linux). Scrapes, CVs, applications, and tracker files stay in that repo. Launch either entry point and they keep using the same folder.

If `claude` lives somewhere unusual:

```bash
CLAUDE_BIN=/path/to/claude node gui/server.mjs
```

The desk listens on `http://127.0.0.1:8765/`. The installable app uses the same page inside its own window. Native Chat is the default surface. Terminal resumes the same Claude session after a transactional handoff. Files/Artifacts previews generated PDFs and text. Ctrl+K opens the command palette.

Claude in Chrome is optional and off unless you set `JOB_SEARCH_CLAUDE_CHROME=1`. Without that opt-in, Claude is launched with `--no-chrome` so a missing extension cannot block a turn.

## How to use it

1. Sign in only if the desk reports you are signed out. Install Claude Code only if it is missing.
2. **Setup** if this clone has no profile yet.
3. **Scrape**, then talk: "which of these are real Staff AI roles?"
4. **Rank** when the table is too long.
5. **Apply** with a URL or a pasted posting.
6. **Autofill** on the employer ATS link. Review the filled form, then click Submit yourself. Desk shows Continue and Cancel only.
7. Keep typing the way you would in Claude Code. Enter sends. Shift+Enter is a new line. Stop cancels the current turn. New chat asks before clearing the conversation.

**Safe** mode asks before tools run and fails closed. **Autonomous** may bypass permissions for the selected trusted workspace. Safe is a Desk permission mode; it is not Claude CLI `--safe-mode`.

Open CLI still launches Claude Code in the same folder if you want the external terminal. Close the app or Ctrl+C to stop.

## Build a release locally

```bash
cd gui
npm ci
npm run build:renderer
npm test
npm run rebuild:native
npm run dist:dir
npm run test:packaged
```

Release CI builds Windows x64, macOS x64, macOS arm64, and Linux x64. Each job rebuilds native modules, validates the unpacked app, then builds the installer. See `.github/workflows/desk-release.yml`.
