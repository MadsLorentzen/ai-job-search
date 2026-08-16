# /sync-upstream - Sync This Fork With Upstream

You are syncing this fork with its upstream template. This repo is a **divergent fork**: it replaced the upstream Danish demonstration portals (`jobindex`, `jobbank`, `jobdanmark`, `jobnet`) with Spanish ones (`infojobs`, `tecnoempleo`, `getmanfred`), and it localizes market assumptions throughout. Upstream keeps improving the shared framework, and this command brings those improvements in without losing the fork's identity.

The hard part is **not** the merge conflicts. Git shows you those. The hard part is the changes that merge **cleanly and are still wrong** — because the fork deleted the thing they refer to, or because they harden code the fork replaced with its own implementation. Those fail silently. Most of this command is about catching them.

---

## Step 0: Establish the ground truth

```bash
git remote -v                      # confirm an `upstream` remote exists
git status                         # must be clean; stop if not
git fetch upstream
git log --oneline master..upstream/master | wc -l   # how far behind
git log --oneline upstream/master..master           # your fork's own commits
```

Report the counts to the user before touching anything. If the working tree is dirty, stop and ask — never stash silently.

**Create a backup ref.** This is cheap and has saved a rebase before:

```bash
git branch backup-pre-sync-$(date +%Y%m%d)
```

## Step 1: Rebase or merge

Default to **rebase** — it keeps the fork's commits as a clean set on top of upstream, which makes the fork's identity legible in the log. Use it unless the user says otherwise.

Trade-off worth stating once if the user is deciding: rebase replays the fork's commits every sync, so a conflict resolved today can reappear next sync. Merge records the resolution permanently but produces a messier history. If syncs start feeling repetitive, that is the signal to switch to merge.

```bash
git rebase upstream/master
```

Note that `master` will diverge from `origin/master` after a rebase, so the push at the end needs `--force-with-lease`.

## Step 2: Resolve conflicts by class

**The inversion trap.** During a rebase, `--ours` is **upstream** and `--theirs` is **your fork** — the opposite of what the names suggest, because git replays your commits onto upstream's HEAD. Getting this backwards silently installs upstream's version of a file you meant to keep. When in doubt, do not use `--ours`/`--theirs` at all: read both sides and write the resolution explicitly, or recover the fork's version from its commit (`git show <fork-commit>:<path>`).

Conflicts fall into predictable classes here:

- **`UD` — upstream modified a file the fork deleted.** These are the removed Danish portals. Keep them deleted: `git rm --force <path>`.
- **`AU` — upstream added a new file that rename detection misfiled into a fork directory.** Git sees `jobbank-search/ → getmanfred-search/` as a rename and drops upstream's new Danish tests into the Spanish dirs. **Check the imports before keeping any of them.** If a test imports symbols the fork's helpers do not export (`fetchWithUA`, `apiFetch`, `parseJobPostingFromHtml`), it is testing deleted code — remove it, and note the lost coverage as follow-up work rather than pretending it ported.
- **`AA` — both sides added the same path.** Usually a test the fork rewrote. Compare the *contracts*, not the prose: upstream's Danish CLIs report `error.kind: "validation"`, the Spanish CLIs report `code: "BAD_ARG"`. Keep whichever matches this fork's actual CLI behaviour.
- **`UU` in `package.json`.** Keep the fork's dependency posture (the Spanish CLIs are deliberately zero-dependency — verify with `grep -rhoE 'from "[^."][^"]*"' <cli>/src/`), but **do** take upstream's version pins in `devDependencies`.
- **`UU` in docs.** Keep the fork's Spanish portal lists; take upstream's structural or wording improvements around them. Read both sides and merge by hand.

## Step 3: Hunt the clean merges that are wrong

Do this **every sync**, after conflicts are resolved and before continuing the rebase. Nothing in git flags any of it.

**3a. Orphaned files.** Upstream added files into a directory this fork deleted. There was nothing to conflict with, so they arrive silently and reference sources that no longer exist:

```bash
ls -d .agents/skills/job{index,bank,danmark,net}-search 2>/dev/null   # should print nothing
# a test dir whose src/ was deleted is an orphan - its tests cannot even import
for d in .agents/skills/*/cli; do [ -d "$d/src" ] || echo "ORPHAN: $d"; done
```

Both should print nothing.

**3b. Config and docs naming things the fork removed.**

```bash
git grep -niE "jobbank|jobdanmark|jobindex|jobnet|danish|dansk|DKK|\.dk\b" -- .claude .github .agents README.md SETUP.md
```

Expect zero hits. Real cases this has caught: the `.github/workflows/ci.yml` `cli-checks` matrix still listing the four Danish portals (every CI run fails on missing directories), and `/add-portal` telling users to copy helpers from a deleted path.

**3c. Locale defaults reintroduced into skill prose.** Upstream writes its skills against the Danish market. When it rewrites a skill file wholesale, its defaults come back in. The dangerous ones are *functional*, not cosmetic — `apply.md` specifying posting-language detection as "Danish or English" makes `/apply` write a Danish cover letter for a Spanish posting. Check anything under `.claude/commands/` and `.claude/skills/job-application-assistant/` that the sync touched.

**3d. Upstream hardening that cannot reach the fork's own code.** The subtlest class, and the one worth the most attention. When upstream fixes a *shared* file, the fix merges. When upstream fixes something in **its** portal CLIs, the fork's independent implementations never receive it — the commit merges cleanly and changes nothing that matters.

So read upstream's log for fixes to *its* CLIs and ask whether the same bug exists here:

```bash
git log --oneline <previous-master>..upstream/master -- .agents/skills/
```

A real case: upstream added a 15s `AbortSignal.timeout` to every board fetch. The Spanish CLIs had no timeout at all and could hang forever. The sync reported "no conflicts" and the bug stayed. Check the fork's fetch wrappers directly:

```bash
grep -rn "AbortSignal\|maxRetries\|429" .agents/skills/*/cli/src/helpers.ts
```

When you port a fix, port it to the fork's actual contract — do not copy upstream's code, which assumes upstream's helper signatures and error shapes.

## Step 4: Verify before pushing

Run all of it. Report results honestly, including anything that fails.

```bash
for t in getmanfred-search infojobs-search joppy-search tecnoempleo-search linkedin-search freehire-search; do
  (cd .agents/skills/$t/cli && bun install --silent && bun run typecheck && bun test)
done
python tools/security_guards.py
python -m unittest discover -s tests -t .
```

Then a **live sentinel probe** per portal — the offline suite cannot tell you a portal's markup changed:

```bash
(cd .agents/skills/<portal>-search/cli && bun run src/cli.ts search -q "React" --limit 3 --format json)
```

Healthy means: populated `company`, decoded titles (no `&amp;`), URLs pointing at the right domain. This doubles as the `/scrape health` contract, so a portal that fails here needs its parser fixed before the sync is done.

## Step 5: Push

```bash
git push --force-with-lease origin master
```

`--force-with-lease` (never bare `--force`) so the push aborts if `origin/master` moved. If it is rejected, re-fetch and investigate rather than escalating to `--force`.

## Step 6: Report

Give the user:

- commits ingested, and the fork's commits replayed on top;
- conflicts resolved, grouped by class, with the reasoning for each judgement call;
- **clean merges that were wrong** and what you fixed — this is the part they cannot see in the git log;
- verification results, including failures;
- follow-up work that did not fit the sync (upstream coverage that could not be ported, upstream features not yet adapted to the Spanish market).

Do not report the sync as complete while any check is failing or any portal probe is degraded.
