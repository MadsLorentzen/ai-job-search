# Ticket 9 — Web Product + Workflow Integration

**Status:** Approved (design frozen). Not yet committed — commit/push remains gated until after implementation and PM review/approval, per project governance.

Validated against `master` at `1636185` (Ticket 8 merge). `product/` contains: `profile_snapshot.py`, `extensions.py`, `evaluation_policy.py`, `job_fit.py`, `job_ingestion.py`, `job_posting.py`, `job_understanding.py`, `job_understanding_cli.py`, `job_understanding_providers.py`, `openai_job_understanding_provider.py`, `semantic_job_fit.py`, `application_intelligence.py`, `application_intelligence_providers.py`, `openai_application_intelligence_provider.py`. No web framework, API layer, or persistence layer exists yet. Only declared runtime dependency is `openai==3.1.0`.

---

## 1. Purpose

Ticket 9 turns Tickets 1–8 into a usable end-to-end product without creating a second implementation of their logic.

The product flow is:

**Profile → Job → Job Understanding → Job Fit → Application Intelligence → Human Review → Application Pack → Application Status**

Central architectural rule:

> **The web application coordinates, persists and presents product results. It does not decide what those results mean.**

* Profile facts come only from Ticket 1.
* Extension packages provide professional/domain context without creating candidate facts.
* Ticket 6 owns accepted job evidence.
* Ticket 7 owns semantic classification, gates, dimensions, scoring, verdict and fit status.
* Ticket 8 owns application recommendation, evidence-safe content adjudication and unsupported-claim rejection.
* Ticket 9 owns **workflow orchestration, persistence, staleness, review state, presentation and application status**.

Ticket 7 already explicitly rejects the idea that semantic proposals themselves are authoritative: proposed relationships are locally adjudicated against profile evidence, job evidence, extensions and policy.

---

## 2. Architecture

```text
Browser
   │
   ▼
Ticket 9 Web Application
   │
   ├── HTTP/API boundary
   ├── Workflow/orchestration service
   ├── Persistence + stale-result service
   ├── Review-state service
   └── Provider adapters
          │
          ▼
   Existing product/ modules
          │
          ├── profile_snapshot.py
          ├── job_ingestion.py
          ├── job_understanding.py
          ├── semantic_job_fit.py
          └── application_intelligence.py
```

Hard dependency direction: `web layer → integration layer → product/`. Never `product/ → web layer`, never `browser → scoring/recommendation logic`.

### Web stack

* FastAPI
* Uvicorn
* Server-rendered HTML with Jinja2
* Minimal vanilla JavaScript for interaction
* SQLite via Python `sqlite3`
* Existing OpenAI SDK for hosted proposer calls

No React application. This product is a human-reviewed workflow over a strong Python domain core; a separate frontend app, Node build pipeline, duplicated models and client-side state would add a second system without improving the evidence boundary. The browser receives view models, not raw business logic to recompute.

---

## 3. The one missing Ticket 9 integration boundary

Ticket 6 and Ticket 8 already have provider abstractions and hosted providers. Ticket 8's provider is explicitly an untrusted proposer; local product code alone decides what enters accepted application output.

Ticket 7 is different: `analyze_semantic_job_fit()` is deliberately provider-blind. It receives `semantic_proposals`, adjudicates them, then independently determines matches, gates, dimensions, scores, verdict, blockers and final status. There is currently no hosted semantic-proposal adapter for Ticket 7. Without one, the web app cannot execute Job Fit end-to-end except with hand-authored semantic proposals.

### Decision

Ticket 9 includes one minimal untrusted **Semantic Proposal Adapter** in the integration layer. Not Ticket 7 logic; does not modify Ticket 7.

May propose only:
* job-evidence ↔ profile-evidence relationships
* a proposed classification
* proposed gate relationships
* functional-equivalence basis where applicable
* extension mapping references for proposed transferability
* bounded rationale/audit context required by Ticket 7's request

Must never provide: scores, overall fit, verdict, recommendation, gate adjudication authority, invented candidate evidence, application prose.

Output goes directly into Ticket 7's existing request validation and then `analyze_semantic_job_fit()`.

```text
OpenAI semantic proposer
        │
        ▼
UNTRUSTED semantic_proposals
        │
        ▼
Ticket 7 validation + adjudication
        │
        ▼
AUTHORITATIVE Job Fit Result v1
```

The hosted adapter receives only the minimum validated evidence required for proposing relationships: profile evidence IDs and bounded claim data, resolved job evidence, active extension mapping references and allowed enums. No raw CV files or candidate source documents are sent.

This belongs in Ticket 9 because it wires an existing domain contract into an executable UI workflow — it is not a new domain ticket.

---

## 4. End-to-end execution model

### Stage A — Candidate Profile

Web app builds the current Profile Snapshot via Ticket 1 (read-only compatibility adapter; exposes claims, provenance, placeholders, corroborations, conflicts). Ticket 9 does not create its own editable candidate database.

Profile screen shows: snapshot identity/content ID, source-backed claims, source location, placeholders, corroborated facts, conflicts, active extensions. A **Refresh profile** action rebuilds the snapshot. Ticket 9 does not silently resolve conflicts — the candidate evidence source remains authoritative; a new snapshot must be built after a source fact changes.

### Stage B — Job Input

User creates a job from: (1) pasted/manual job info, (2) a saved Job Source Record, (3) a saved supported import (e.g. Freehire detail JSON). Ticket 5 already performs deterministic normalization and does not infer meaning from prose — Ticket 9 does not build a competing parser. No arbitrary live webpage scraper in v0. A URL may be retained as source metadata only.

### Stage C — Job Understanding

Calls the existing Ticket 6 provider boundary (provider proposes evidence; only locally resolved exact quotations become accepted evidence). UI presents: explicit structured job evidence, accepted extracted evidence, suggestions, ambiguous statements, warnings, coverage, Ticket 6 status.

Suggestions/ambiguous statements do not become fit evidence via a UI "accept" click. Promotion into evidence must go through a valid upstream job source with the relevant contract rerun — Ticket 9 does not invent an evidence-promotion mechanism.

### Stage D — Job Fit

Ticket 9: (1) builds the Resolved Job Evidence Bundle via Ticket 7's existing function; (2) gathers the current Profile Snapshot; (3) loads selected active Extension Packages; (4) obtains untrusted semantic proposals via the narrow adapter; (5) builds Ticket 7's request; (6) invokes `analyze_semantic_job_fit()`; (7) stores the exact request/result pair.

Ticket 7 remains solely responsible for: direct match, functionally equivalent match, transferable match, adjacent/unsupported treatment, eligibility gate, language gate, location/logistics gate, gaps, human-judgment questions, dimensions, scores, blocked state, verdict, final status.

### Stage E — Application Intelligence

Ticket 9 constructs the exact Ticket 8 request from current authoritative artifacts.

```text
Ticket 8 provider proposes content atoms
                ↓
Ticket 8 deterministic adjudicator
                ↓
validated Application Intelligence Result
```

Ticket 9 never runs a second generative pass to "improve" Ticket 8 output — that would reopen the hallucination boundary Ticket 8 was built to close.

---

## 5. Persistence design

### Storage

Local SQLite: `.jobsearch/jobsearch.sqlite3`. The entire `.jobsearch/` directory is gitignored. Single-user local product in v0.

### Core persisted concepts

**Workspace** — one durable job evaluation/application journey. Exists before the user decides to apply. Has: durable workspace ID, company/title display metadata, timestamps, optional workflow status. Current analytical phase is computed, not stored as another status vocabulary.

**Immutable artifact** — every material domain input/output persisted as immutable JSON: Profile Snapshot; Job Posting Snapshot; Job Understanding request/result; Resolved Job Evidence Bundle; Job Fit request/result; Application Intelligence request/result; final reviewed Application Pack. An internal canonical hash may be used for storage/dedup but has no domain meaning and does not replace Tickets 1–8's content IDs.

**Current artifact references** — a workspace points to the currently selected artifact per stage. Previous versions remain available for audit but cease to be current.

**Review decisions** — workspace; review item type; exact source artifact reference; underlying domain item ID where available; disposition; optional note; timestamp. Tied to the exact result version reviewed — if the result changes, the old decision does not silently transfer.

**Workflow events** — append-only: previous status, new status, date, optional note.

---

## 6. Application workflow status

One vocabulary, reused exactly from the legacy workflow's canonical spellings and open/final semantics:

```text
drafted, applied, interview, offer, hired, rejected, no_response, offer_declined, withdrawn
```

**Open:** `drafted`, `applied`, `interview`, `offer`
**Final:** `hired`, `rejected`, `no_response`, `offer_declined`, `withdrawn`

Before `drafted`, a workspace's `workflow_status` is **null** — a job being analysed is not yet a "drafted application." UI may show computed pipeline phases (Understanding / Fit analysis / Application intelligence / Review) but these are not application statuses. Only when the user completes final application-material review does Ticket 9 set `workflow_status = drafted`. No extra `analysing`/`reviewing`/`ready`/`pending` status is invented.

---

## 7. Stale-result model

Ticket 8 already pins the exact Ticket 7 result it consumed via `job_fit_result_ref` (explicitly for downstream staleness detection) and independently rejects mismatched Profile Snapshots and Resolved Job Evidence Bundles. Ticket 9 builds on these rather than inventing a looser timestamp-based check.

### Dependency graph

```text
Profile Snapshot ───────────────┐
                                ▼
Job Snapshot → Understanding → Resolved Evidence → Job Fit → App Intelligence
           │                                      ▲
           │                                      │
           └──────────────────────────────────────┤
                                                  │
Extensions / fit policy / proposals ──────────────┘
```

### Invalidation rules

* New **Profile Snapshot** invalidates: current Job Fit, current Application Intelligence, current unsubmitted Application Pack. Does NOT invalidate Job Understanding (candidate data was not an input).
* New **Job Snapshot** invalidates: Job Understanding, Resolved Job Evidence, Job Fit, Application Intelligence, current unsubmitted pack.
* Changed **Job Understanding result** invalidates: Resolved Job Evidence, Job Fit, Application Intelligence, current unsubmitted pack.
* Changed **extension selection**, semantic proposals, or relevant fit policy invalidates: Job Fit, Application Intelligence, current unsubmitted pack.
* Changed **Job Fit Result** invalidates: Application Intelligence, current unsubmitted pack.

### Behaviour

Ticket 9 never deletes an old result merely because it is stale. It displays **"Stale — generated from an older upstream result"** and disables downstream readiness until that stage is rerun. Never auto-reruns a hosted provider on staleness — the user explicitly initiates rerun.

### Submitted applications

Once the user confirms an application was submitted, its Application Pack becomes an immutable historical record. A future profile change does not rewrite history or invalidate the submitted pack. Staleness only controls whether a result may be used to create a **new** current application pack.

---

## 8. Minimal HTTP/API boundary

Exists for the Ticket 9 UI; not a public external API product.

**Profile**
```text
GET  /api/profile
POST /api/profile/refresh
```

**Workspaces / jobs**
```text
GET  /api/workspaces
POST /api/workspaces          (validated manual/import data → Ticket 5)
GET  /api/workspaces/{id}
```

**Processing** — each runs exactly one pipeline stage against current upstream artifacts
```text
POST /api/workspaces/{id}/understand
POST /api/workspaces/{id}/fit
POST /api/workspaces/{id}/application-intelligence
```

**Review**
```text
GET  /api/workspaces/{id}/review
POST /api/workspaces/{id}/review-decisions
POST /api/workspaces/{id}/application-pack
```
`application-pack` is the final user-controlled transition from analysed material to reviewed application material.

**Workflow**
```text
PATCH /api/workspaces/{id}/status
```

No `/apply`, `/submit`, `/send`, or `/email` endpoint exists.

---

## 9. UI design

### A. Applications dashboard
Landing screen: every workspace with company, role, current processing stage, Job Fit verdict where available, Ticket 8 recommendation where available, stale warning, review-item count, workflow status if application material exists, last updated date. Filters: active, drafted, applied, interview, offer, final. No new status semantics.

### B. Candidate Profile
Verified claims, source provenance, placeholders, conflicts, corroborations, available/active extensions. Purpose: trust inspection, not CV editing.

### C. New Job
Paste job text/details; manual company/title/location/source; paste/import supported JSON. User sees the normalized Job Posting Snapshot before continuing — makes the actual Ticket 5 input explicit.

### D. Workspace detail (primary screen)
Stepper: `Job → Understanding → Job Fit → Application Intelligence → Review → Status`. Each stage expands in the same workspace rather than pushing through disconnected pages. Stepper states: complete, current, needs review, stale, unavailable — these describe pipeline condition, not tracker status.

---

## 10. Evidence presentation vocabulary

Six explicit evidence categories:

1. **Verified evidence** — source-backed candidate/job evidence and direct matches. Inspectable: candidate claim, candidate source, job requirement, exact source/job quotation where applicable, evidence IDs.

2. **Accepted inference — functionally equivalent** — Ticket 7's locally adjudicated functionally-equivalent relationship. Never displayed as "verified fact." Shows both sides of the relationship. Provider rationale never dressed up as evidence.

3. **Transferable evidence** — only when Ticket 7 has a validated transferable match backed by an active Extension Package mapping. Always shows: candidate evidence, target requirement, extension mapping, limitations, conditions, READY/NEEDS_REVIEW state. Limitations never hidden in a default-collapsed footnote.

4. **Missing evidence** — Ticket 7 gaps, unresolved required dimensions, unverified gates, job requirements without sufficient profile support. Means "the system does not currently possess accepted evidence establishing it" — never "the candidate definitely does not have this."

5. **NEEDS_REVIEW** — literal state stays visible; never relabeled as "probably fine" or "partial match." Human questions shown directly beside the item they concern.

6. **Unsupported — excluded from application material** — Ticket 7 unsupported claims and Ticket 8 rejected atoms/claims. Visible for audit but never inserted into the Application Pack.

Colour may reinforce these states, but text/iconography must convey the distinction without relying on colour alone.

---

## 11. Human review gates

Major rule: **Ticket 9 review never mutates an upstream domain result from NEEDS_REVIEW to READY.** Human review and domain status are separate concepts. If Ticket 7 says `status = NEEDS_REVIEW`, the user may record "I have reviewed this limitation and am comfortable proceeding" — but Ticket 9 does not rewrite Ticket 7's status to READY. The Job Fit Result remains exactly what Ticket 7 produced.

**Gate 1 — Evidence integrity.** Surfaces profile conflicts, placeholders, missing candidate evidence, relevant Job Understanding ambiguities. A checkbox cannot create evidence; resolution requires a valid upstream change and rerun.

**Gate 2 — Job Fit judgment.** Surfaces gate flags/unverified gates, human-judgment questions, functionally equivalent relationships, transferable matches, gaps, conditions/limitations. Permitted dispositions (Ticket 9-local only): acknowledged and proceed; omit from application positioning; requires upstream evidence change; resolved by rerun.

**Gate 3 — Application Intelligence.** Every generated unit shows rendered text, evidence references, status, source classification. Unsupported units cannot be selected into final material. NEEDS_REVIEW units require an explicit disposition.

**Gate 4 — Final material.** User sees one consolidated Application Pack and explicitly confirms "I have reviewed the application material." Only then can the pack become `drafted`. Strongest human-control boundary in Ticket 9.

---

## 12. Application-ready output

Ticket 9 does not reopen document-generation scope from earlier tickets. Ticket 8 intentionally outputs plain evidence-backed content (not LaTeX), including CV and cover-letter content, validated against exact Job Fit and Profile Snapshot identities.

Ticket 9 creates a reviewed **Application Pack** containing:
* **Job** — company, role, source, captured posting text/evidence as available
* **Fit summary** — recommendation, fit verdict, dimensions, direct/functional/transferable strengths, material gaps
* **CV material** — only reviewed Ticket 8 CV units
* **Cover-letter material** — only reviewed Ticket 8 cover-letter units
* **Review record** — outstanding/accepted review items, exclusions, unsupported items, evidence references

User can copy individual content, copy CV/cover-letter material, or export the reviewed pack as plain text/Markdown. No PDF/Word/LaTeX rendering in v0.

---

## 13. Legacy workflow/archive integration

Reuses two legacy concepts: the tracker status vocabulary and the per-application archive. The old workflow also explicitly says follow-ups are drafts only and must never be sent automatically — Ticket 9 preserves that.

**Tracker:** final pack approval sets `status = drafted` using exact canonical spellings. Only becomes `applied` when the user says the application was actually submitted — never automatically on generation completion.

**Archive:** on final review, the reviewed output can be persisted under the existing archive convention, e.g. `documents/applications/<company>_<role>/application_pack.md`. When exact posting text is available, the existing `job_posting.md` convention is respected rather than reconstructed. Ticket 9 does not create fake `cv_draft.tex`/`cover_letter.tex` files merely to satisfy the old directory shape — those filenames historically represent actual submitted material.

**Important boundary:** the SQLite workspace is the authoritative Ticket 9 processing/audit state. Tracker/archive integration is a compatibility projection, not a second source of fit/evidence truth. No Gmail, Notion, or automated follow-up integration is added.

---

## 14. Status updates remain explicitly human-triggered

Available transitions: `Mark as applied`, `Interview`, `Offer received`, `Rejected`, `No response`, `Offer declined`, `Withdraw`, `Hired` — only user-triggered, capturing effective date and optional note. The system records an event and updates current status.

It does not infer an interview from email, does not infer rejection from elapsed time, does not automatically declare `no_response`, and does not automatically submit an application.

---

## 15. Security and privacy boundary

* **Server binding:** default `127.0.0.1`, not a public interface.
* **OpenAI credentials:** `OPENAI_API_KEY` server-side only; never supplied to JavaScript or stored in SQLite.
* **Candidate information:** raw candidate source files stay where Ticket 1 already expects them. Database stores validated snapshots/results, not a newly invented candidate master profile.
* **Job postings:** treated as untrusted text; UI escapes rather than renders arbitrary supplied HTML.
* **Logging:** avoid dumping full profile snapshots, CV text, job posting contents, generated application materials, or API credentials. Provider audit metadata retained separately from substantive domain result JSON, matching the Ticket 8 pattern.

---

## 16. Failure handling

Provider failures must not corrupt an existing successful stage.

* **Ticket 6 provider fails:** "Job Understanding unavailable." Previous successful result, if any, remains visible.
* **Ticket 7 proposer fails:** "Semantic proposal unavailable." No Job Fit result is fabricated.
* **Ticket 7 rejects proposals:** authoritative Ticket 7 result controls what is shown.
* **Ticket 8 provider fails:** "Application Intelligence generation failed." No fallback free-text generation.
* **SQLite/write failure:** workflow action fails visibly; UI must not show a status transition that was not durably saved.

No "best effort" fabricated analysis is permitted.

---

## 17. Testing strategy

**Domain regression** — every existing Ticket 1–8 test remains green; Ticket 9 must not modify expected behaviour in those tests. Baseline to preserve: 631 passed, 1 skipped (reported at the Ticket 8 merge).

**Integration service tests** (deterministic fake providers) — Profile → Job → Understanding → Fit → Intelligence happy path; invalid provider proposals; extension transferability; blocked gates; unresolved dimensions; unsupported Ticket 8 atom; Ticket 8 NEEDS_REVIEW; provider failure; stale Profile Snapshot; stale Job Snapshot; stale Fit Result; review decision invalidated by a new result; final pack cannot include unsupported content.

**Persistence tests** — immutable artifact storage; current artifact pointers; old result preservation; stale dependencies; durable review decisions; exact tracker status enum; open/final semantics; workflow event history; submitted pack immutability.

**API/UI acceptance tests** — the critical journey:
```text
Open profile → create job → run understanding → inspect evidence → run fit
→ inspect direct/inferred/transferable/gaps → run application intelligence
→ review material → exclude/resolve review items → confirm final review
→ application becomes drafted → explicitly mark applied → later update to interview
```
Must also prove: no application can become `applied` through generation; stale material cannot become the current application pack; unsupported content cannot enter the pack; a NEEDS_REVIEW item cannot disappear merely because the UI moved to the next tab; a provider cannot inject a score/verdict/recommendation that overrides Tickets 7 or 8.

Because the UI is server-led and JavaScript-light, most behaviour is testable via FastAPI integration tests, with a small browser smoke suite for the actual journey.

---

## 18. Explicit non-goals

Ticket 10/11 or any separate workflow-automation ticket; autonomous job applications; employer submission; automatic email sending; LinkedIn messaging; autonomous follow-ups; Gmail monitoring; Notion sync; job-alert automation; live ATS scraping; a crawler; a new candidate profile database; a profile editor that bypasses Ticket 1; an Extension Package editor or marketplace; another scoring engine; another fit classifier; another recommendation engine; another unsupported-claim validator; overriding Ticket 7 NEEDS_REVIEW; overriding Ticket 8 NEEDS_REVIEW; generating candidate claims from extensions; generating a new "better" cover letter after Ticket 8; Word generation; PDF generation; LaTeX generation; public SaaS hosting; authentication/multi-tenancy; mobile applications; background workers; schedulers; analytics; employer CRM; interview-preparation features.

These require future explicit scope approval, not implicit extension of Ticket 9.

---

## 19. Ticket 9 acceptance definition

Complete only when one real user workflow can go from current candidate evidence + job posting + active extensions, through Job Understanding → authoritative Job Fit → evidence-safe Application Intelligence → transparent human review → reviewed application pack → drafted → user-confirmed applied/interview/offer/outcome status, while preserving these invariants:

1. No candidate fact originates in Ticket 9.
2. No Extension Package becomes candidate evidence.
3. Ticket 9 cannot change Ticket 7's fit conclusion.
4. Ticket 9 cannot change Ticket 8's evidence adjudication.
5. Provider output remains untrusted until product code validates it.
6. Stale downstream results are never silently reused.
7. Human review does not masquerade as domain validation.
8. Unsupported claims never enter the application-ready pack.
9. `applied` always means the user says the application was actually submitted.
10. There is no autonomous submission path anywhere in Ticket 9.

---

## Governance note

This design is approved and frozen. Per project governance, this document is saved but **not committed**. Next step: write the Ticket 9 **implementation plan only** and stop for approval. No feature branch, no product code changes, and no commit/push happen until after implementation and PM review/approval.
