# Methods — the pipeline contracts

Numbering is the sequence: `01-scrape` → `02-rank` → `03-apply` →
`04-outcome` (`05-gmail-sync` feeds 04; `06-interview` follows an interview).
The rest are supporting contracts.

- Read the contract at the start of its task; do not restate it.
- Each contract names its inputs (profile files, state, postings) and outputs
  (state writes, `applications/` records). Follow them exactly — the spec-text
  tests in `packages/tools/tests/spec/` pin them.
- `setup.md` and `reset.md` configure this factory; run setup before anything
  else on a fresh clone.
