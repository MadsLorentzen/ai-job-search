# Using this fork with Free Claude Code (FCC)

This fork can run the existing Claude Code workflow (`/setup`, `/scrape`, `/rank`, `/apply`, …) through [Free Claude Code](https://github.com/Alishahryar1/free-claude-code), a local proxy that speaks Anthropic’s API format.

```
Claude Code  →  FCC on this machine  →  free / cheap / local models
```

Slash commands, skills, and files stay the same. The expensive part of `/rank` (many parallel scoring agents) no longer has to hit paid Claude tokens.

This is a **fork-only** setup. Do not open a PR for it against [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search); upstream stays Claude-Code-native and does not take alternative-harness work.

## What you need

1. [Claude Code](https://claude.com/claude-code) installed (FCC does not replace it).
2. Free Claude Code installed and running.
3. At least one provider key in the FCC Admin UI. [NVIDIA NIM](https://build.nvidia.com/settings/api-keys) is the easiest free starting point.

## 1. Install FCC (one-time, Windows)

Open PowerShell and run:

```powershell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/install.ps1")))
```

When it asks which coding agents to install, say **Yes** at least for Claude Code.

Re-run the same command later to update FCC.

## 2. Start FCC and add a free model

1. Open **Free Claude Code** from the Start menu (or run `fcc-server` and keep that terminal open).
2. The Admin UI should open in your browser (default proxy: `http://localhost:8082`).
3. Create an NVIDIA NIM key at [build.nvidia.com/settings/api-keys](https://build.nvidia.com/settings/api-keys).
4. In the Admin UI, paste it into `NVIDIA_NIM_API_KEY`.
5. Leave `MODEL` on the default, or pick another:
   - `nvidia_nim/nvidia/nemotron-3-super-120b-a12b`
6. Click **Validate**, then **Apply**.

Other common free/cheap options (configure in the same Admin UI):

| Provider | Admin setting | Example model |
|----------|---------------|---------------|
| [NVIDIA NIM](https://build.nvidia.com/settings/api-keys) | `NVIDIA_NIM_API_KEY` | `nvidia_nim/nvidia/nemotron-3-super-120b-a12b` |
| [Groq](https://console.groq.com/keys) | `GROQ_API_KEY` | `groq/llama-3.3-70b-versatile` |
| [Google AI Studio](https://aistudio.google.com/apikey) | `GEMINI_API_KEY` | `gemini/models/gemini-3.1-flash-lite` |
| [OpenRouter](https://openrouter.ai/keys) | `OPENROUTER_API_KEY` | `open_router/openrouter/free` |
| Local [Ollama](https://ollama.com/) | `OLLAMA_BASE_URL` | `ollama/<model-tag>` |

Prefer models that support tool calling. Ranking and `/apply` both depend on it.

Optional: under **Model Config**, add an ordered **Fallback Models** list so a failed provider retries the next one.

## 3. Launch this repo through FCC

From the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-with-fcc.ps1
```

That script:

- Checks that FCC is reachable on `http://localhost:8082`
- Writes `.claude/settings.local.json` from the example if it is missing
- Sets the Claude Code env vars to the FCC proxy
- Starts `fcc-claude` if it is on PATH, otherwise `claude`

### Manual launch (if you prefer)

```powershell
$env:ANTHROPIC_AUTH_TOKEN = "freecc"
$env:ANTHROPIC_BASE_URL   = "http://localhost:8082"
$env:CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = "1"
claude
```

Or, after FCC is running:

```powershell
fcc-claude
```

Then use the normal commands:

```
/setup
/scrape
/rank
/apply <url>
```

All token-heavy parallel work now goes through the models configured in FCC.

## 4. Project settings (automatic for this repo)

`.claude/settings.local.json` tells Claude Code to use the FCC proxy whenever you open **this** project. It is gitignored (machine-local). The committed template is `.claude/settings.local.json.example`.

`start-with-fcc.ps1` copies the example into place if the local file does not exist.

If you later enable **Proxy Authentication** in the FCC Admin UI, change `ANTHROPIC_AUTH_TOKEN` in `.claude/settings.local.json` (and/or set `$env:FCC_AUTH_TOKEN` before running the launcher) to match the token FCC shows.

## Daily workflow

1. Start **Free Claude Code** (Start menu or `fcc-server`).
2. Open PowerShell in this folder.
3. Run `powershell -ExecutionPolicy Bypass -File .\start-with-fcc.ps1`
4. Use `/setup`, `/scrape`, `/rank`, `/apply` as usual.
5. Keep reviewing drafts yourself before you send anything. FCC only changes which model does the thinking.

## VS Code Claude Code extension

If you use the Claude Code VS Code extension against this repo, add this to your **user** `settings.json` (match port and token to the FCC Admin UI):

```json
"claudeCode.disableLoginPrompt": true,
"claudeCode.environmentVariables": [
  { "name": "ANTHROPIC_BASE_URL", "value": "http://localhost:8082" },
  { "name": "ANTHROPIC_AUTH_TOKEN", "value": "freecc" },
  { "name": "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY", "value": "1" },
  { "name": "CLAUDE_CODE_AUTO_COMPACT_WINDOW", "value": "190000" },
  { "name": "DISABLE_AUTOUPDATER", "value": "1" },
  { "name": "DISABLE_FEEDBACK_COMMAND", "value": "1" },
  { "name": "DISABLE_ERROR_REPORTING", "value": "1" }
]
```

Reload the extension after saving.

## Troubleshooting

**FCC does not seem to be running on port 8082**  
Start the desktop app or `fcc-server` first. Confirm the Admin UI is open. If you changed the port, set `$env:FCC_BASE_URL` before running the launcher.

**Claude Code still asks you to log in**  
Open `%USERPROFILE%\.claude.json` and merge `"hasCompletedOnboarding": true` into the existing JSON without deleting other fields. Restart Claude Code.

**`fcc-claude` / `claude` not found**  
Install Claude Code, then re-run the FCC installer and choose Claude Code so `fcc-claude` is on PATH. Close and reopen PowerShell so PATH updates apply.

**PowerShell blocks `start-with-fcc.ps1`**  
Use `powershell -ExecutionPolicy Bypass -File .\start-with-fcc.ps1` as shown above. Do not need to change your user execution policy.

**Fit scoring or cover letters look weaker**  
Free models vary on long context and instruction following. Try a stronger free model in the FCC Admin UI (NVIDIA NIM default is a good first test). You can still keep a paid Claude key as an FCC fallback for `/apply` later; this Option A setup routes everything through FCC.

**Do not delete `.claude/settings.local.json` if you are using FCC**  
Older clones of upstream used that filename for broad Bash permissions. This fork uses it only for FCC env vars. Keep the FCC version; the example file is the source of truth.

## Security and privacy

- Personal data still stays on your machine. FCC is a local proxy.
- Job postings remain untrusted input. Cheaper models do not make prompt-injection safer.
- Never commit API keys. Put them in the FCC Admin UI, not in this repo.
- Human review of CV, cover letter, and tracker updates is still required.

## Later: cheaper ranking, stronger drafting

This is **Option A**: the whole workflow goes through FCC.

A later Option B can split models (cheap for `/rank`, stronger for `/apply` drafter + reviewer) using FCC’s model-tier routing (`MODEL_OPUS` / `MODEL_SONNET` / `MODEL_HAIKU`) or a small `models.yaml` in this fork.
