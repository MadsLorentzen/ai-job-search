# /linkedin - Weekly LinkedIn Check-in and Post Queue

You are running the user's weekly LinkedIn routine: a short check-in about what they did last week, then **two** posts drafted from their profile and that check-in, approved by the user, and queued for automatic publishing through LinkedIn's official API.

The aim is steady visibility to Dublin data and QA hiring managers: real work, shown concretely, twice a week. A post that says nothing true and specific is worse than no post.

`$ARGUMENTS` may be empty (the weekly routine), `status`, `setup`, or `edit <id>`.

**Hard rules - these override everything below:**
1. **Nothing is published without the user's explicit approval of that exact text.** Drafts are written as `status: draft`; only the user's "approve" turns one into `status: approved`. `tools/linkedin_post.py` refuses to send anything else.
2. **Every claim comes from the sources:** `.claude/skills/job-application-assistant/01-candidate-profile.md`, `CLAUDE.md`'s Candidate Profile, and this week's check-in answers (written to `01` first - see Step 1). No invented metrics, projects, certifications, employers' internal details or opinions the user didn't express.
3. **Never post anything confidential:** no Accenture client names, internal systems, colleagues' names, Holland & Barrett store figures beyond what the profile already states, or anything about specific job applications in progress (no company names from `job_search_tracker.csv`).
4. Any mention of AI or agentic coding tools names **Claude Code** explicitly.

---

## `/linkedin setup` - one-time

Check each step, run what is runnable, and tell the user exactly what is left:

1. **LinkedIn developer app** (user does this in the browser):
   - Go to https://www.linkedin.com/developers/apps and **Create app**. LinkedIn requires the app to be associated with a LinkedIn **Company Page**; if the user has none, they can create a small page for themselves first.
   - On the **Products** tab add **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect** (both self-serve).
   - On the **Auth** tab add the redirect URL `http://localhost:8765/callback`, then copy the **Client ID** and **Client Secret**.
2. **Store the credentials outside the repo** - the user runs this in their own terminal, never in chat:
   `echo 'export LINKEDIN_CLIENT_ID="..."' >> ~/.zshenv && echo 'export LINKEDIN_CLIENT_SECRET="..."' >> ~/.zshenv`
3. **Log in:** `python3 tools/linkedin_post.py auth` (the user runs it with `! ` so the browser opens on their machine). It stores a token at `~/.config/ai-job-search/linkedin_token.json` (mode 600). LinkedIn tokens last about **60 days**; `whoami` warns in the last week, and this command checks it every run.
4. **Install the schedule:** `bash tools/install_linkedin_schedule.sh` - two macOS launchd jobs: one runs `publish-due` every 30 minutes from a copy of the publisher in `~/.local/share/ai-job-search/bin/` (re-run the installer after editing `tools/linkedin_post.py`) (posts only approved items whose time has come), one shows a Monday 09:00 reminder to run `/linkedin`. Ask before running it; it writes to `~/Library/LaunchAgents/`.

---

## `/linkedin` - the weekly routine

### Step 0: Health check
Run `python3 tools/linkedin_post.py whoami` and `python3 tools/linkedin_post.py status`.
- Missing or expired token → point to `/linkedin setup` step 3 and keep going (drafting still works; nothing can publish until fixed).
- Any `failed` item → show its error; offer to fix and re-approve it, or mark it `skipped`.
- Approved items still waiting from last week → list them; the new plan must not double up on the same days.

### Step 1: Check-in (ask, don't assume)
Ask the user in one message, short answers fine:
1. **Projects:** did you build, fix or learn anything on a project last week (new or existing)? What, and any result or number?
2. **Certifications:** progress on DP-700, dbt Fundamentals, Databricks Lakehouse, Google Data Analytics (or a new one)? Modules done, exam booked or passed?
3. **Data quality lesson:** anything you noticed or learned about data quality, testing or reconciliation - at work, in a course, or in a project?
4. Anything you **don't** want posted this week?

"Nothing this week" is a valid answer to any question. **Write every new confirmed fact into `01-candidate-profile.md` in the same turn** (a passed certification moves from "In progress" to Certifications with its date; a new project result goes under Independent Projects), following `/apply`'s standing rule. If a fact corrects `CLAUDE.md`, fix it there too.

### Step 2: Plan the two posts
Pick two **different** types from: `project`, `certification`, `data-quality-lesson`, `open-to-work`.

- **Open to work every other week:** read the queue (`~/.local/share/ai-job-search/linkedin/queue/`) - if no `open-to-work` item was posted or approved in the last 13 days, one of this week's two posts is `open-to-work`.
- Prefer this week's check-in material. With nothing new, draw on the profile (projects, Accenture and Holland & Barrett lessons), but **don't repeat an angle already posted** - check the queue's posted items and pick a different project, metric or lesson.
- Schedule: **Tuesday 08:30** and **Thursday 08:30** Europe/Dublin of the coming week (or the next free slots if those passed). Morning weekday slots suit a professional audience.

Tell the user the plan in two lines (type + one-line angle each) before drafting.

### Step 3: Draft
Read `.claude/skills/job-application-assistant/03-writing-style.md` once; its rules apply (no em-dashes, no cliches, no hedging). For each post:

- **Length:** 120-220 words. LinkedIn shows about the first 210 characters before "see more", so the **first line is the hook**: a concrete result, a surprising problem, or a plain statement of what changed. No "Excited to share", no "I'm thrilled", no questions-as-hooks like "Ever wondered...".
- **Shape:** short paragraphs (1-3 sentences), white space between them. One concrete number or detail the reader can picture. End with a takeaway or a genuine question to other practitioners, not a plea for likes.
- **Per type:**
  - `project` - problem → what you built (tools named) → one thing that went wrong or surprised you → result. A GitHub link (`github.com/Mohit9674`) is fine at the end.
  - `certification` - what you studied, one idea that changed how you'd work, how it connects to your experience. Passing an exam: say so plainly, once.
  - `data-quality-lesson` - one specific check or failure, why it matters, what you'd do. Generalise anything from work; no client or system names.
  - `open-to-work` - what roles (data engineering, data quality, QA, data analyst), where (Dublin, hybrid/on-site), what you bring in 2-3 concrete points, work authorisation stated factually (Stamp 1G; eligible for a Critical Skills Employment Permit), and an invitation to message. Confident, never desperate.
- **Hashtags:** 3-5 at the very end, relevant (`#DataQuality #DataEngineering #dbt #Dublin`...). Write them as plain `#Tag`; the tool converts them for the API.
- **No @mentions** (the tool escapes them as plain text) and no emojis unless the user asks.

Write each to `~/.local/share/ai-job-search/linkedin/queue/YYYY-MM-DD_<type>_<slug>.md` (outside the repo: macOS blocks the background publisher from reading `~/Desktop`; personal drafts also stay out of git) (date = scheduled day):

```markdown
---
id: 2026-10-20_project_dublin-bus
type: project
status: draft
scheduled_at: 2026-10-20T08:30
---
<post text exactly as it should appear>
```

### Step 4: Approve
Show both drafts in full with their character count and scheduled time, then ask the user to **approve, edit, reschedule or drop** each. Apply edits and show the changed text again. Only on an explicit approval of a specific post set its `status: approved` (edit the frontmatter line). Dropped drafts become `status: skipped`. Never approve on the user's behalf, and never treat approval of one post as approval of the other.

### Step 5: Report
```
## LinkedIn - week of YYYY-MM-DD
| Post | Type | Scheduled | Status |
|------|------|-----------|--------|
| <id> | project | Tue 20 Oct 08:30 | approved |
```
Close with: "Approved posts publish automatically at their time (your Mac needs to be on or wake up; a missed slot publishes at the next wake). You'll get a macOS notification when each goes live."

---

## `/linkedin status`
Run `tools/linkedin_post.py status` and `whoami`; summarise what is queued, posted (with dates) and failed.

## `/linkedin edit <id>`
Show the queued post, apply the user's change, and set it back to `status: draft` until they approve the new text. A `posted` item cannot be edited here; tell the user to edit it on LinkedIn.

---

## Design principles
- **Approval is the gate, the schedule is the convenience.** The publisher only sends what the user approved, once, and marks failures instead of retrying.
- **Grounded, specific, sparing.** Two real posts a week beat daily filler; repeating a metric every week reads as padding.
- **The check-in feeds the profile.** New facts land in `01-candidate-profile.md`, so CVs and cover letters pick them up too.
