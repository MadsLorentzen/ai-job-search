# Ticket 8 — Application Intelligence: Design

Status: **Approved for implementation planning.** Not yet implemented. This document
reflects the design after five review rounds; see "Design history" at the end for
what each round corrected.

## Baseline

- Ticket 7 (Semantic Job Fit Analyzer v0) is merged to `master` at `d30c2f0` (PR #9).
  Full suite green: 580 passed, 1 skipped.
- Ticket 8 is the next and only ticket approved for design work. Tickets 9 (Web
  Interface) and 10 (Workflow Automation) remain frozen scope, not started.

## Purpose

Turn a validated `Job Fit Result v1` (Ticket 7's output) into an evidence-traceable
application strategy: a recommendation, a positioning narrative, and structured/prose
content for CV and cover-letter emphasis.

## Boundary

Ticket 8 **consumes** Ticket 7's result. It does not re-derive job fit, does not
override Ticket 7's matches/gaps/dimension assessments/`blocked`/`status`/`verdict`,
and does not read candidate source files directly — all candidate facts come through
the Profile Snapshot embedded in the consumed Ticket 7 result.

## Architecture

Two-phase, mirroring Ticket 7's own provider/adjudication split:

1. **`product/application_intelligence.py`** — deterministic core. Validates a
   provider proposal (or runs with none, producing structured plans only), computes
   the recommendation, validates every proposed content atom against evidence, and
   is the *only* code that renders final text.
2. **`product/application_intelligence_providers.py`** — `Protocol`-based provider
   boundary (mirrors `job_understanding_providers.py`): `ApplicationIntelligenceProvider`
   + `ProviderResponse`/`ProviderCallAudit` + a `DeterministicFakeProvider` for
   offline tests.
3. **`product/openai_application_intelligence_provider.py`** — one concrete hosted
   provider, shipped in this same ticket (not deferred), mirroring
   `openai_job_understanding_provider.py`: OpenAI Responses API, bounded structured-
   outputs schema, `OPENAI_API_KEY` env var, retry/timeout bounds, own model
   constants (versioned independently from the job-understanding provider). Receives
   only the consumed Ticket 7 result plus cited Profile Snapshot claim text and
   referenced extension mapping text — never raw candidate source files.
4. **`product/application_intelligence_policy.v0.json`** — machine-readable
   recommendation policy (see below), same pattern as `semantic_fit_policy.v0.json`.

## Core invariant

> **No provider-authored candidate claim may enter accepted application content
> unless local runtime logic can establish that it is supported by Profile Snapshot
> evidence — and deterministic rendering must be evidence-preserving, not merely
> deterministic.**

Two failure modes are both in scope and both closed by this design:

- A provider could smuggle an unsupported claim inside otherwise-valid-looking
  prose (closed by: providers submit structure, never prose — see "Content model").
- **Local code itself could manufacture a stronger claim than the evidence
  supports**, via a template that upgrades a bare fact into a stronger one (closed
  by: evidence-preserving rendering — see "Evidence-preserving rendering").
  Determinism alone does not make a template safe.

## Data contract — `Application Intelligence Result v0`

```
schema_version, request_id
job_fit_result_ref { schema_version, request_id, content_id }   # pins the exact Ticket 7 result consumed
profile_snapshot { schema_version, content_id }                  # staleness pin, same pattern as Ticket 7

recommendation: "proceed" | "proceed_with_review" | "do_not_proceed"
recommendation_reason: string   # derived from application_intelligence_policy.v0.json, never provider-authored

positioning: {
  direct_strengths: [{ content_unit_id }],
  functional_strengths: [{ content_unit_id }],
  transferable_strengths: [{ content_unit_id, limitations, conditions, status }],
  material_gaps: [{ text, gap_ids }],          # text drawn verbatim from Ticket 7 gap.notes, not re-rendered
  open_questions: [{ text, question_ids }],    # text drawn verbatim from Ticket 7 question.question
}

cv_emphasis_plan: [{ item_id, profile_evidence_ids, job_requirement_ids, guidance, priority }]
cv_content: [content_unit, ...]
cover_letter_plan: [{ theme_id, profile_evidence_ids, job_requirement_ids, guidance }]
cover_letter_content: [content_unit, ...]

unsupported_claims: [{ claim_id, reason, rejected_atom_ids, attempted_profile_evidence_ids, attempted_extension_refs }]
status: READY | NEEDS_REVIEW | UNAVAILABLE
notes: [string]
```

All content is plain text — no LaTeX, no template markup, no coupling to
`moderncv`/`cover.cls`/`cv/*.tex`/`cover_letters/*.tex`. Ticket 8 owns evidence-backed
content intelligence; the existing LaTeX/job-application-assistant workflow remains
the presentation/rendering layer and is untouched by this ticket.

## Content model

A `content_unit` is never provider-authored prose with citations attached. It is
assembled entirely by local code from:

```
content_unit {
  unit_id
  unit_type: "cv_bullet" | "cv_summary_line" | "cover_letter_paragraph" | "positioning_statement"
  atoms: [atom_id, ...]              # provider-selected, ordered
  connectives: [{ after_atom_index: int, text: str }]   # provider-selected, guarded
  text: string                       # LOCAL OUTPUT ONLY — reconstructed from validated
                                      # atoms + fixed templates + guarded connectives.
                                      # Byte-for-byte reproducible from that data.
  status: READY | NEEDS_REVIEW
  profile_evidence_ids, job_evidence_ids, job_fit_match_ids, extension_refs  # aggregated from constituent atoms
}
```

The provider's structured-output schema has **no free-text field for candidate-
bearing content**. It selects:

- which atoms to use and in what order (positioning/emphasis strategy),
- a bounded `rendering_variant` per atom (from a fixed enum — a framing/tone choice,
  not free text),
- guarded connectives between atoms.

### Atom types

```
candidate_fact_atom {
  atom_id
  assertion_type: enum   # "skill" | "employment" | "responsibility" | "certification" |
                          # "education" | "publication" | "award" | ...
                          # — closed, drawn from profile_snapshot.py's existing
                          # claim category/field vocabulary, not provider-invented
  profile_evidence_ids: [str]   # required, non-empty; each must resolve to a
                                 # non-placeholder, non-conflicted claim whose
                                 # category/field matches assertion_type
  rendering_variant: enum       # bounded per-assertion_type template choice
}

job_reference_atom {
  atom_id
  job_evidence_ids: [str]       # required, resolved_job_evidence ids
  rendering_variant: enum       # e.g. AS_REQUIREMENT | AS_MOTIVATION | AS_CONTEXT
}

transferability_atom {
  atom_id
  job_fit_match_id: str          # required; must be a transferable_matches record
                                  # from the consumed Ticket 7 result
  rendering_variant: enum        # e.g. WITH_CONDITIONS_INLINE | WITH_CONDITIONS_FOOTNOTED
                                  # — conditions/limitations always appear somewhere
                                  # in the unit's structured fields, never omitted
}
```

### Atom validation (per-atom, not per-unit)

- `candidate_fact_atom`: evidence ids must resolve to non-placeholder,
  non-conflicted claims whose `category`/`field` matches `assertion_type`.
- `job_reference_atom`: evidence ids must resolve in the consumed
  `resolved_job_evidence` bundle.
- `transferability_atom`: `job_fit_match_id` must reference a `transferable_matches`
  record in the consumed Ticket 7 result. The atom's `status`/`limitations`/
  `conditions` are inherited verbatim from that match — never provider-supplied. A
  unit built on a `NEEDS_REVIEW` transferable match is itself forced to
  `NEEDS_REVIEW`, regardless of rendering_variant.
- A failed atom is rejected individually into `unsupported_claims`; it never reaches
  rendering. A unit is `READY` only if every one of its constituent atoms
  independently validated `READY`.

### Connective guard

Connectives pass through a lexical allowlist: closed-class transition/rhetorical
words only (e.g. "additionally," "in this role," "as a result," conjunctions,
punctuation) — no nouns/verbs describing capability, no numbers, no named entities.
A connective that fails the check is rejected and the containing unit becomes
`NEEDS_REVIEW`. This is a small, fully unit-testable allowlist, not a heuristic NLP
filter.

## Evidence-preserving rendering

This is the mechanism that prevents local templates from manufacturing stronger
claims than the evidence supports — the second failure mode named above.

```
render_template {
  template_id
  assertion_type: enum
  rendering_variant: enum
  required_evidence_semantics: {
    category: str            # must equal the cited claim's category
    field: str                # must equal the cited claim's field
    strength_level: "STATED" | "EXPLICIT_PROFICIENCY" |
                     "EXPLICIT_DURATION" | "EXPLICIT_HANDS_ON" |
                     "EXPLICIT_LEADERSHIP"
  }
  format_string: str          # e.g. "{value}" or "Experience with {value}"
}
```

`strength_level` is computed **structurally** from Profile Snapshot field
vocabulary already established in Tickets 1–7 — never inferred from claim text by
a classifier, which would just relocate the hallucination risk:

- A **bare `technical_skill` claim** (no linked employment/responsibility record)
  supports only `STATED` — neutral rendering such as the skill name itself (e.g.
  `"Python"`, `"Experience with Python"`). It must **not** automatically render as
  "experience with X" implying hands-on use unless evidence structure actually
  establishes experience, and must never reach `EXPLICIT_HANDS_ON`-tier phrasing
  such as "strong hands-on experience."
- **`field="proficiency"`** claims (e.g. language proficiency, already part of the
  existing schema via `_add_language_claim`) satisfy `EXPLICIT_PROFICIENCY`.
  Proficiency wording is illegal without this.
- **`EXPLICIT_HANDS_ON`** requires a `responsibility_or_achievement` claim
  structurally linked (same `record_id`, i.e. same employment episode) to an
  `employment` category claim for that specific skill/responsibility — not inferred
  from adjectives in nearby text.
- **`EXPLICIT_DURATION`** for an employment episode's `date_range` proves duration
  of *that employment episode only* — not duration of every skill associated with
  it. Skill-duration language (e.g. "5 years of Python") requires the skill/
  responsibility to be structurally linked within the same record as that duration
  evidence, not merely co-occurring in the same profile.
- **`EXPLICIT_LEADERSHIP`** is never inferred merely from a seniority-bearing job
  title or from having multiple responsibility entries. It requires explicit,
  structurally represented leadership/supervision/management responsibility
  evidence (a claim whose text/field structurally encodes a leadership
  responsibility, not a title string or entry count used as a proxy).

**Template selection rule:** given a `candidate_fact_atom`'s cited evidence ids,
local code computes the maximum `strength_level` those specific claims structurally
support, then only templates at or below that level are eligible. If the provider's
requested `rendering_variant` maps to a template requiring semantics the evidence
doesn't support, the atom is rejected into `unsupported_claims` — same failure path
as any other invalid atom.

**Templates may restate or conservatively frame evidence; they may never strengthen
it.**

### Renderer input boundary

Legal fill-in sources for rendering are limited to:

- accepted Profile Snapshot claim `value` fields,
- accepted job evidence `text` fields,
- Ticket 7's **structured** fields only: `classification`, evidence id lists,
  `limitations`, `conditions`.

**Ticket 7's `rationale` field is explicitly excluded from rendering input.** It was
validated as "a reason a match holds," not as "safe-to-quote candidate-facing
prose," and must not become application content merely because Ticket 7 stored it.
`rationale` may be retained in the Application Intelligence result only as
non-rendered audit metadata (excluded from `cv_content`/`cover_letter_content`),
mirroring how Ticket 7 already excludes raw posting text and Ticket 6 suggestions
from evidence while retaining them for audit.

## Recommendation policy

New `product/application_intelligence_policy.v0.json`:

```json
{
  "schema_version": "application-intelligence-policy.v0",
  "id": "default_application_intelligence_policy",
  "recommendation_rules": [
    { "when_blocked": true, "recommendation": "do_not_proceed",
      "reason": "Ticket 7 fit result is blocked by a failing gate." },
    { "when_status": "UNAVAILABLE", "recommendation": "do_not_proceed",
      "reason": "Ticket 7 fit result is unavailable." },
    { "when_status": "NEEDS_REVIEW", "recommendation": "proceed_with_review",
      "reason": "Ticket 7 fit result has unresolved dimensions, unsupported claims, or open questions." },
    { "when_status": "READY", "when_verdict_in": ["poor_fit", "weak_fit"],
      "recommendation": "do_not_proceed",
      "reason": "Ticket 7 verdict indicates insufficient fit." },
    { "when_status": "READY", "when_verdict_in": ["moderate_fit"],
      "recommendation": "proceed_with_review",
      "reason": "Ticket 7 verdict indicates moderate fit; human judgment recommended." },
    { "when_status": "READY", "when_verdict_in": ["good_fit", "strong_fit"],
      "recommendation": "proceed",
      "reason": "Ticket 7 verdict indicates good or strong fit." }
  ]
}
```

Rules evaluated top-to-bottom, first match wins (same precedence style as
`classification_precedence` in `semantic_fit_policy.v0.json`). `verdict` values are
exactly the five ids from `evaluation-policy.v0.json`'s `verdict_thresholds`
(`poor_fit`/`weak_fit`/`moderate_fit`/`good_fit`/`strong_fit`) — no thresholds
re-implemented in Ticket 8. The recommendation function is pure and provider-blind:
it reads only `blocked`/`status`/`verdict` off the consumed Ticket 7 result and this
policy file. **`recommendation` is never provider-authored.**

## Files expected to change

New files only — no changes to Ticket 1–7 files:

- `product/application_intelligence.py`
- `product/application_intelligence_providers.py`
- `product/openai_application_intelligence_provider.py`
- `product/application_intelligence_policy.v0.json`
- `product/schemas/application-intelligence-contract.v0.schema.json`
- `tests/test_application_intelligence.py`
- `tests/test_application_intelligence_providers.py`

## Acceptance criteria

- Direct evidence can be emphasized.
- Functionally equivalent evidence can be explained.
- Approved transferable evidence preserves mapping limitations/conditions/status
  verbatim.
- Unresolved transferability (`NEEDS_REVIEW`) can never present as definitive
  prose — the containing content unit is forced to `NEEDS_REVIEW`.
- Unsupported candidate claims are rejected per-atom into `unsupported_claims`.
- Missing evidence never creates a negative candidate fact (Ticket 7's gap
  semantics are preserved, not reinterpreted).
- CV/cover-letter content uses only Profile Snapshot candidate facts.
- Extension-only employment/certification/experience claims fail (no
  `job_fit_match_id` + evidence combination can substitute an extension for a
  Profile Snapshot claim on a `candidate_fact_atom`).
- Generated content cannot introduce a candidate fact absent from evidence — closed
  structurally (provider has no free-text channel) not just by testing.
- **A bare, unlinked skill claim can never select a strength/duration/hands-on/
  leadership-tier template** — named regression test for the specific
  `"Python"` → `"Strong hands-on experience with Python"` failure mode.
- **`rationale` text is never present in rendered `cv_content`/
  `cover_letter_content`** — named regression test.
- Every accepted application claim is traceable to evidence (byte-for-byte
  reproducible `text` from atom data + template table + connectives).
- Recommendation matches the policy table for every `blocked`/`status`/`verdict`
  combination — exhaustive table-driven test.
- Ticket 7 `blocked`/unresolved states propagate correctly into `recommendation`
  and unit `status`.
- Existing Tickets 1–7 remain green (full suite, currently 580 passed/1 skipped).

## Non-goals

- No LaTeX generation or template placement (`cv/*.tex`, `cover_letters/*.tex`,
  `moderncv`, `cover.cls` are untouched).
- No persistence/storage of Application Intelligence results.
- No UI (Ticket 9's concern).
- No Ticket 8a/8b split — all seven output sections (recommendation, positioning,
  emphasis plan, CV plan, cover letter plan, generated content, unsupported-claim
  quarantine) ship in this one ticket, including the real hosted provider.
- No second LLM used as a validation authority — the local deterministic layer is
  the only validator.

## Known limitation (accepted tradeoff)

Evidence-preserving rendering trades prose variety for provable safety: CV bullets
and cover-letter paragraphs will read as competent-but-templated rather than
bespoke, since a fixed, semantics-gated template table cannot match a skilled
writer's range. This is the accepted cost of the core invariant. A human (via the
existing `job-application-assistant` skill) remains free to hand-polish accepted
output afterward — Ticket 8's job is to guarantee the *safety* of generated
content, not its literary quality. Template coverage (how many rendering variants
per `assertion_type` are enough to avoid repetitive-sounding output) is an
implementation-planning question, not resolved by this design.

## Design history

This design went through five review rounds before approval. Each round closed a
specific trust-boundary gap:

1. **Initial design** — approved architecture (two-phase provider/adjudication,
   mirrors Ticket 7), scope (all seven sections in one ticket), and output format
   (format-agnostic, no LaTeX). Flagged as open risk: validating free-form provider
   prose against cited evidence ids is inherently softer than Ticket 7's structured-
   match adjudication.
2. **Round 1** — closed the "citing an id proves nothing about the sentence built
   around it" gap by requiring structured content units with typed assertions
   instead of prose-plus-citations. Also corrected two other requested changes:
   shipped a real OpenAI provider in Ticket 8 instead of deferring it, and made the
   recommendation policy an exact table instead of "verdict above threshold."
3. **Round 2** — closed the "assertions are checked but `text` is still an
   unconstrained provider-authored field" gap: introduced atoms + local rendering,
   so accepted `text` is composed by local code from validated atom fragments plus
   a guarded connective allowlist, never assigned directly from provider output.
4. **Round 3** — closed the "`atom.rendered_text` is still provider-authored prose"
   gap: atoms became pure data (assertion type, evidence ids, bounded
   `rendering_variant` enum) with no free-text field at all; local code owns 100%
   of word generation via a fixed template table.
5. **Round 4 (final)** — closed the "deterministic local templates can still
   manufacture stronger claims than the evidence supports" gap: added
   evidence-preserving rendering, where each template declares required evidence
   semantics (`strength_level`) computed structurally from Profile Snapshot field
   vocabulary, and excluded Ticket 7's `rationale` field from renderable input
   entirely. Tightened `EXPLICIT_HANDS_ON`/`EXPLICIT_DURATION`/`EXPLICIT_LEADERSHIP`
   definitions to require structural linkage within the same record, not inference
   from titles, entry counts, or nearby text.

The recurring theme across all five rounds: **evidence-id references alone are not
proof of support.** Each round found a remaining channel — free prose, provider-
authored atom text, or local template semantics — where content could exceed what
its cited evidence actually establishes, and closed it by moving more of the
"what does this claim mean" decision from free text into small, closed, testable
enumerations.
