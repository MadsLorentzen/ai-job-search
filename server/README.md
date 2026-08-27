# Job Search web app

A local web UI over the job-search framework: search portals, evaluate a
posting against your profile, generate a tailored CV and cover letter, and
track applications.

It runs on your machine and stores everything locally. Nothing is uploaded
anywhere except the AI provider you configure.

## Requirements

- **Node 22.5 or newer.** Storage uses the built-in `node:sqlite`, which avoids
  a native module and the install lifecycle scripts this repo's security guards
  forbid.
- **A TeX engine** (`lualatex` and `xelatex`) for publication-quality PDFs.
  Without one the app still works, renders a plain preview PDF instead, and
  says so rather than pretending otherwise.
- **bun**, only if you want the Danish portals or the full-description fetch.
  The portal CLIs under `.agents/skills/` are Bun/TypeScript.

## Setup

```bash
cd server
npm install
cp .env.example .env
npm run set-password        # prompts, writes a scrypt hash into .env
npm start
```

Then open http://localhost:3000. A first-run wizard walks you through
importing a CV and setting what you are looking for.

There is **no default password**. Until one is configured the server refuses
every login and says so at startup.

### Configuring an AI provider

Evaluation, drafting and interview prep need a model. Set one of the blocks in
`.env` (Claude, Kimi, Qwen, or any OpenAI-compatible endpoint including a local
Ollama). With none configured the app still runs, and every affected feature
reports itself unavailable instead of inventing content.

`AI_PROVIDER=none` disables every provider explicitly, including the Claude CLI
bridge, if you want to run the app deliberately offline.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Run the server |
| `npm run dev` | Run with file watching |
| `npm test` | Unit and API tests (`node --test`) |
| `npm run test:e2e` | Browser tests (Playwright) |
| `npm run typecheck` | Type-check the JavaScript via `checkJs` |
| `npm run set-password` | Write a scrypt password hash into `.env` |

## Layout

```
src/
  app.js              Express app (exported, so tests can mount it)
  index.js            Server entry point
  config/             Environment resolution, logger
  db/                 SQLite connection, schema, migrations
  middleware/         Auth, request validation
  routes/             HTTP endpoints
  services/           Storage, scraping, LaTeX, AI providers
  validation/         Zod schemas, one per endpoint
public/js/            Frontend ES modules
test/                 Unit and API tests
e2e/                  Playwright browser tests
```

## Notes on the design

**Single user.** There is one profile and one application store. An earlier
revision advertised multi-user config that the data model could not honour, so
two people logging in shared one CV and could edit each other's tracker. That
config is gone; if multi-user is ever wanted it needs a user id on every row.

**Honest output.** Anything the app cannot verify, it says it cannot verify.
The ATS check reports what it measured or reports that nothing measured it;
AI responses carry a `source` field distinguishing a real model from the
offline fallback; the offline fallback emits visibly empty scaffolding with
`TODO` markers rather than plausible-looking invented achievements. This
matters more here than in most applications, because the output goes to
employers under your name.

**In-memory state.** The login throttle and the AI provider probe are
per-process. That is correct for a single-process app, but it means running
this under a cluster manager with multiple workers would multiply the
effective rate limit by the worker count. Session tokens are signed with a
secret persisted to `data/.session-secret`, so they do survive a restart.

**Untrusted input.** Scraped job descriptions and uploaded CVs are fenced
before they reach a model, and labelled as data that must not be followed.
Treat portal output as hostile: it is third-party HTML.

## Data

Everything lives in `server/data/`, which is gitignored:

- `jobsearch.db` — profile, applications, document versions, seen jobs
- `.session-secret` — signing key for session tokens
- `builds/` — LaTeX build directories, pruned automatically

Upgrading from the pre-SQLite version imports `profile.json` and
`applications.json` automatically on first start and renames them
`.migrated`.
