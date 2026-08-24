# Job search desk

A localhost page that talks to Claude Code in this repo. Same conversation, slash commands, and files as the CLI. Works on **macOS, Windows, and Linux**.

## Install the app

Download **Job Search Desk** from [Releases](https://github.com/iLevyTate/ai-job-search/releases):

| OS | Installer |
| --- | --- |
| Windows | `JobSearchDesk-*-win-x64.exe` (one-click NSIS) or the portable `.exe` |
| macOS | `JobSearchDesk-*-mac-universal.dmg` |
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

Or `bun gui/server.mjs`. Wrappers: `./gui/start.sh` (macOS / Linux) or `.\gui\start.ps1` (Windows). From `gui/`: `npm start`.

If `claude` lives somewhere unusual:

```bash
CLAUDE_BIN=/path/to/claude node gui/server.mjs
```

The desk prefers Google Chrome, then the system default browser. It listens on `http://127.0.0.1:8765/`. The installable app uses the same page inside its own window.

Claude in Chrome stays in **one tab group** named Job Search Desk. The desk turns Chrome integration on, names the Claude session, and resumes that session across turns and relaunches so new browser tabs join the same group instead of stacking orphans. New chat clears the page only. Set `JOB_SEARCH_CLAUDE_CHROME=0` to turn this off.

## How to use it

1. Sign in only if the desk reports you are signed out. Install Claude Code only if it is missing.
2. **Setup** if this clone has no profile yet.
3. **Scrape**, then talk: "which of these are real Staff AI roles?"
4. **Rank** when the table is too long.
5. **Apply** with a URL or a pasted posting.
6. **Autofill** on the employer ATS link. You still click Submit.
7. Keep typing the way you would in the terminal. Enter sends. Shift+Enter is a new line. Stop cancels the current turn. New chat clears the page and starts a fresh session.

The server launches Claude with `--dangerously-skip-permissions` so `/scrape` and `/apply` are not blocked by a permission prompt on every tool. Close the app or the terminal (Ctrl+C) to stop.

## Build a release locally

```bash
cd gui
npm ci
npm test
npx electron-builder --publish never
```

CI builds Windows, macOS, and Linux when you push a `desk-v*` tag. See `.github/workflows/desk-release.yml`.
