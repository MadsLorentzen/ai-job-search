# Application Pack v1 Contract Enrichment — Design Specification

**Status:** Proposed for review; implementation is explicitly out of scope for this branch
**Accepted baseline:** `a7faadd`
**Date:** 2026-08-24

## 1. Goal

Introduce a new immutable Application Pack payload that contains all candidate
presentation data needed to render a conventional, structured CV without reading
the live Evidence Profile—or any other current upstream state—after confirmation.

The invariant is:

```text
exact Profile Snapshot X
  + exact Job Fit result
  + exact Application Intelligence result
  + exact review decisions
  -> confirmed immutable Application Pack v1
  -> deterministic rendered documents
```

The forbidden flow is:

```text
confirmed pack -> current/live Evidence Profile -> rendered document
```

## 2. Verified current state

The following are facts from the repository at `a7faadd`, not assumptions:

- Current packs identify themselves with `schema_version: "application-pack.v0"`.
- A v0 pack embeds `job`, `fit_summary`, `recommendation`, reviewed
  `cv_content`, reviewed `cover_letter_content`, and a full `review_record`.
- `source_artifacts` already contains exact artifact IDs, artifact types, and
  content IDs for the Profile Snapshot, Job Posting, Job Fit result, and
  Application Intelligence result.
- Review decisions are not artifacts. They are immutable `review_decisions`
  rows. Each consulted decision embedded in `review_record.decisions_consulted`
  carries its own decision `id` and exact `source_artifact_id`.
- `artifacts.payload_json` stores arbitrary JSON. The artifact store does not
  constrain pack payload fields and therefore needs no migration for v1.
- The current DOCX renderer receives one exact pack payload and source pack
  artifact ID. It does not query the database itself.
- The HTTP render service may resolve either the current pack or an explicitly
  requested historical pack, then passes only that exact payload to the renderer.

## 3. Contract versions

The canonical JSON schema-version values are:

- Legacy: `application-pack.v0`
- Enriched: `application-pack.v1`

The hyphenated spelling is retained because it is the established
`schema_version` series in the repository. “application_pack.v1” may be used as
the prose name of this ticket, but must not become a second runtime identifier.

New confirmations produce v1 only. Existing v0 artifacts are never rewritten,
backfilled, re-saved, or silently reinterpreted as v1.

An absent or unknown `schema_version` is an error at the version-aware renderer
boundary. The renderer must never guess a version from payload shape.

## 4. Application Pack v1 schema

V1 retains every v0 top-level field unchanged and adds one closed
`candidate_snapshot` object. No existing provenance or review field is removed.

```json
{
  "schema_version": "application-pack.v1",
  "source_artifacts": {
    "profile_snapshot": {
      "artifact_id": "art_...",
      "artifact_type": "profile_snapshot",
      "content_id": "..."
    },
    "job_posting_snapshot": { "artifact_id": "art_...", "artifact_type": "job_posting_snapshot", "content_id": "..." },
    "job_fit_result": { "artifact_id": "art_...", "artifact_type": "job_fit_result", "content_id": "..." },
    "application_intelligence_result": { "artifact_id": "art_...", "artifact_type": "application_intelligence_result", "content_id": "..." }
  },
  "candidate_snapshot": {
    "profile_schema_version": "candidate-profile-evidence-snapshot.v0",
    "identity": {
      "name": { "value": "Ada Lovelace", "profile_evidence_ids": ["clm_..."] }
    },
    "contact": {
      "email": { "value": "ada@example.com", "profile_evidence_ids": ["clm_..."] },
      "phone": null,
      "linkedin": null,
      "github": null,
      "location": { "value": "London, UK", "profile_evidence_ids": ["clm_..."] }
    },
    "employment": [],
    "education": [],
    "certifications": [],
    "skills": [],
    "languages": [],
    "projects": [],
    "publications": [],
    "awards": []
  },
  "job": {},
  "fit_summary": {},
  "recommendation": "...",
  "recommendation_reason": "...",
  "cv_content": [],
  "cover_letter_content": [],
  "review_record": {
    "decisions_consulted": [],
    "exclusions": [],
    "informational_items": {}
  },
  "completion_contract_version": "...",
  "completion_status": "READY",
  "completion_issues": [],
  "completion_metrics": {}
}
```

### 4.1 Provenanced value

Every rendered candidate value uses this closed shape:

```json
{
  "value": "exact value copied from the Profile Snapshot claim",
  "profile_evidence_ids": ["clm_..."]
}
```

`profile_evidence_ids` is non-empty, sorted, and contains every safe,
same-valued claim collapsed into that presentation value. These IDs must exist
in the exact Profile Snapshot referenced by
`source_artifacts.profile_snapshot.artifact_id`.

The renderer uses only `value`. Evidence IDs remain audit metadata and never
appear in rendered documents.

### 4.2 Identity and contact

- `identity.name` is required and non-null.
- `contact.email`, `phone`, `linkedin`, `github`, and `location` are nullable.
- Location comes from Profile Snapshot category/field `location/location`, not
  from the job or search preferences.
- V1 does not invent address parts, labels, URLs, or missing contact methods.

### 4.3 Structured employment

Each employment entry has this closed shape:

```json
{
  "record_id": "rec_...",
  "role": { "value": "Engineer", "profile_evidence_ids": ["clm_..."] },
  "employer": { "value": "Example Ltd", "profile_evidence_ids": ["clm_..."] },
  "date_range": { "value": "2020–2024", "profile_evidence_ids": ["clm_..."] },
  "location": null,
  "details": [
    { "value": "Built a verified system.", "profile_evidence_ids": ["clm_..."] }
  ]
}
```

The source mapping is `employment/job_title -> role`, plus
`employment/employer`, `employment/date_range`, `employment/location`, and
`employment/responsibility_or_achievement -> details`. `role`, `employer`, and
`date_range` are nullable because the Evidence Profile contract permits sparse
records. The renderer omits missing parts; pack confirmation must not invent them
or add a new Gate 4 threshold.

Entries are grouped by Profile Snapshot `record_id`. `details` preserves the
snapshot’s deterministic claim order after safe-value collapse.

### 4.4 Education and certifications

Education entry:

```json
{
  "record_id": "rec_...",
  "qualification": null,
  "institution": null,
  "date_range": null,
  "location": null,
  "key_topics": null,
  "details": null
}
```

Each non-null field is a provenanced value. Source fields are the current
`education` claim vocabulary with the same names; `details` is retained because
the LaTeX Profile Snapshot adapter emits it for education records.

Certification entry:

```json
{
  "record_id": "rec_...",
  "name": { "value": "Certification name", "profile_evidence_ids": ["clm_..."] }
}
```

The source mapping is `certifications/certification -> name`.

### 4.5 Other CV presentation sections

V1 snapshots the remaining current CV-oriented Profile Snapshot vocabulary:

- `skills`: `{ "record_id", "category", "value" }`, where `category` is the
  exact Profile Snapshot claim `field` and `value` is provenanced.
- `languages`: `{ "record_id", "language", "proficiency", "notes" }`, with
  nullable provenanced scalars except `language`.
- `projects`: `{ "record_id", "name", "description" }`, nullable provenanced
  scalars.
- `publications`: `{ "record_id", "value" }`.
- `awards`: `{ "record_id", "value" }`.

`constraints` and `identity/employment_status` remain evidence/profile data but
are not CV presentation fields in v1 and are not copied. Adding a new Profile
Snapshot category later does not implicitly add it to v1; a future pack contract
must opt in explicitly.

## 5. Snapshot construction rules

Candidate presentation extraction is a pure transformation of the exact current
Profile Snapshot payload already acquired inside the Gate 4 transaction.

1. Validate the Profile Snapshot using its existing validator.
2. Build the set of conflicted `concept_id` values from `snapshot.conflicts`.
3. Exclude every placeholder claim.
4. Exclude every claim whose `concept_id` is conflicted. A review decision cannot
   turn conflicted evidence into safe candidate presentation data.
5. Group remaining claims by `(record_id, category, field, concept_id)`.
6. Within a group, require values to be equal under the Profile Snapshot’s own
   normalized-value semantics. Collapse corroborating claims into one value and
   retain all sorted claim IDs. A mismatch fails pack construction loudly; it is
   never resolved by source priority.
7. Sort record arrays deterministically by their earliest source position
   `(source.file, source.line_start, record_id)`. Sort evidence IDs
   lexicographically. Preserve `details`/list-item source order with `record_id`
   as the final tie-breaker.
8. Require exactly one safe candidate name value. Zero or multiple distinct safe
   names fails v1 construction. This restates the existing profile-readiness
   requirement; it does not authorize choosing a source winner.
9. Missing optional sections or fields produce empty arrays/nulls. They do not
   fail Gate 4 and do not alter the substantive-completion contract.

No value may come from User Profile/search preferences, workspace metadata,
Job Fit prose, Application Intelligence prose, source files on disk, or a later
Profile Snapshot.

## 6. Provenance invariants

For every persisted v1 pack:

1. `source_artifacts.profile_snapshot.artifact_id` identifies the exact artifact
   whose payload was transformed into `candidate_snapshot`.
2. Its `content_id` equals that artifact’s stored content ID.
3. Every `profile_evidence_id` exists in that artifact’s `claims` list and no
   conflicted or placeholder claim ID is present.
4. Job Fit and Application Intelligence provenance remains the exact current
   artifact references already recorded in `source_artifacts`.
5. `review_record.decisions_consulted` retains each exact review decision ID and
   source artifact ID. No synthetic “review artifact” is introduced.
6. Pack construction, artifact persistence, dependency fingerprints, and the
   drafted workflow event remain within the existing `BEGIN IMMEDIATE`
   transaction.
7. Saving a later Profile Snapshot or confirming a later pack cannot mutate any
   field of an existing pack artifact.

The existing dependency fingerprints for Job Fit and Application Intelligence
remain unchanged. V1 does not redefine staleness or historical-pack semantics.

## 7. Renderer contract

The renderer dispatches only on the exact pack `schema_version`.

### 7.1 V0

- Call the existing legacy rendering path unchanged.
- Preserve current filenames, section order, text, DOCX bytes, content hashes,
  and `renderer_version: "application-pack-renderer.v1"` for the same v0 input.
- Do not fill candidate fields from any external source.
- Do not silently upgrade or normalize v0 to v1.

### 7.2 V1

- Use only `candidate_snapshot`, existing approved `cv_content`, existing
  approved `cover_letter_content`, and `job` embedded in the exact pack.
- Identify output as `renderer_version: "application-pack-renderer.v2"`.
- Produce deterministic bytes for identical pack payload and renderer version.
- Reject malformed v1 candidate structures rather than omitting required name
  or guessing a fallback.

The v1 CV section order is fixed:

1. candidate name;
2. available contact details;
3. Professional Summary from approved `cv_summary_line` units;
4. Professional Experience from `candidate_snapshot.employment`;
5. Tailored Highlights from approved `cv_bullet` units;
6. Education;
7. Certifications;
8. Skills;
9. Languages;
10. Projects;
11. Publications;
12. Awards.

Empty optional sections are omitted. Structured Profile Snapshot details and
approved generated units are never merged into one employment record because
current Application Intelligence units do not carry a reviewed role-placement
contract.

The v1 cover letter may render the embedded candidate name/contact header, the
job subject, and approved cover-letter paragraphs. It must not invent a recipient,
postal address, salutation, closing phrase, or signature.

Renderer code must not import or call Evidence Profile, Job Fit, Application
Intelligence, review, provider, or persistence modules. The HTTP service may
perform its existing owner-scoped lookup of the requested pack artifact and no
other domain lookup before rendering.

## 8. Historical and compatibility behavior

- Explicit historical pack rendering remains exact-artifact rendering.
- A v0 historical pack always uses the v0 branch, even when a newer Profile
  Snapshot or v1 pack exists.
- A v1 historical pack always renders its embedded `candidate_snapshot`, even
  after the live Evidence Profile changes or is deleted.
- Current-pack lookup may choose the current pack artifact, but renderer dispatch
  still uses that artifact’s own version.
- Unknown versions fail with a clean renderer error. No fallback branch is used.
- The legacy Markdown archive projection remains version-aware: v0 output stays
  byte-for-byte unchanged; v1 adds a `Candidate Snapshot` JSON audit section from
  the embedded pack only.

## 9. Persistence and migration decision

No database migration is permitted or required for this ticket.

Rationale:

- `artifacts.payload_json` already stores arbitrary JSON.
- Artifact rows are append-only and historical payloads remain retrievable.
- `current_artifacts` already selects the current pack without assuming a payload
  version.
- Ownership and historical artifact lookup operate on artifact/workspace identity,
  not pack payload columns.

If implementation appears to require a schema/table migration, work stops for
design review; that would indicate scope drift or an unrecognized blocker.

## 10. Non-goals and protected boundaries

This contract does not change:

- Job Fit scoring, verdicts, evidence semantics, or ranking;
- Application Intelligence generation or review semantics;
- `check_staleness` or dependency types;
- Gate 4 substantive-completion thresholds or workflow transitions;
- profile parsing, conflict detection, or source-priority policy;
- account ownership or authorization;
- submission behavior;
- persistence schema.

V1 enriches what Gate 4 snapshots and what the downstream renderer can present.
It does not authorize new facts or weaken any evidence/review gate.

## 11. Required acceptance coverage for a later implementation

At minimum, implementation must prove:

1. A newly confirmed pack is `application-pack.v1` and embeds the exact safe
   candidate presentation data from the current Profile Snapshot artifact.
2. Every embedded value traces to claim IDs in that exact snapshot.
3. Conflicted and placeholder candidate data never enters `candidate_snapshot`.
4. Sparse optional profile sections remain valid and do not change Gate 4
   completion semantics.
5. V0 renders byte-for-byte identically to the accepted baseline.
6. V1 renders candidate name/contact and structured employment, education, and
   certifications without any upstream read.
7. Changing the live Profile Snapshot after confirmation does not change v1
   rendered bytes or content hashes.
8. Rendering an explicitly requested historical v0 or v1 artifact never
   substitutes the current pack.
9. Unknown versions and malformed v1 payloads fail cleanly.
10. Cross-account historical pack access remains denied.
11. The renderer’s import boundary excludes profile, fit, intelligence, review,
    persistence, and provider modules.
12. Fresh-database and existing-database tests pass without a new migration.
13. The full Chrome-inclusive suite remains green.

## 12. Expected implementation seams (informational, not an implementation plan)

The later implementation is expected to remain localized to:

- a pure candidate-presentation snapshot/validation helper;
- `webapp/services/application_pack.py` at pack assembly time;
- version dispatch and v1 presentation in
  `product/application_pack_renderer.py`;
- version-aware legacy archive projection;
- focused service, renderer, route, historical-artifact, and browser tests.

This section does not authorize implementation on the design branch. A separate,
reviewed implementation plan is required before production files change.
