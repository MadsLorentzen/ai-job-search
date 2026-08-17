# Hosted Job Understanding provider v0

This adapter sends one job posting's selected source text to OpenAI so the
existing Job Understanding contract can validate proposed evidence locally.
OpenAI remains an untrusted proposer: exact quote resolution, citation offsets,
accepted evidence, and review separation are controlled by the product.

## Developer invocation

Set the API credential in the process environment and pass a validated Job
Posting Snapshot JSON file:

```powershell
$env:OPENAI_API_KEY = "<secret>"
python -m product.job_understanding_cli extract job-snapshot.json --provider openai
```

The schema-valid `JobUnderstandingResult` is written to stdout. Bounded audit
or error metadata is written to stderr. Failures return a nonzero exit code and
do not echo source text or raw provider responses.

## Outbound data boundary

The OpenAI request contains only:

- the product-owned extraction instructions;
- the exact selected `raw_text` or `description` value;
- the requested evidence categories;
- the derived strict candidate-response schema.

Snapshot identity, job metadata, local correlation IDs, content hashes, source
URLs, structured evidence IDs, Candidate Profile data, CV content, extensions,
Evaluation Policy, Job Fit data, and application history are not separately
serialized. Details already present inside the selected source text necessarily
remain part of that exact text; the adapter never rewrites or silently truncates
it.

## OpenAI configuration and cost bounds

- Responses API using `gpt-5.4-mini-2026-03-17`;
- reasoning effort `low` and no temperature override;
- strict Structured Outputs;
- `store=false`, no streaming/background state, and no previous response;
- no tools, files, browsing, search, conversations, agents, or fallback model;
- 100,000 Unicode code-point source limit, rejected before network access;
- 8,192 maximum output tokens;
- at most two HTTP attempts, only for bounded transient failures;
- no retry after a model response fails product validation.

## Privacy and retention

The adapter sets `store=false`. OpenAI states that API data is not used to train
models by default, but standard API abuse-monitoring retention may still apply.
`store=false` is **not** Zero Data Retention. Modified Abuse Monitoring and Zero
Data Retention require an eligible and approved OpenAI organization/project.
See OpenAI's current [API data controls](https://developers.openai.com/api/docs/guides/your-data).

Regional processing likewise depends on eligible, configured OpenAI project
controls. OpenAI's documented Europe region is EEA plus Switzerland; this
documentation does not claim that it provides UK data residency.

The API key is read only from `OPENAI_API_KEY`. It is never included in product
request/result JSON, audit output, logs, exceptions, or test fixtures. The
adapter does not support arbitrary custom API base URLs.

Runtime audit telemetry is bounded to provider/model identity, response ID,
timing, attempt count, and token usage. It remains outside the immutable evidence
contract and is not persisted.

## Opt-in synthetic live smoke test

Default tests and CI are offline. A real synthetic smoke test runs only when
both variables are set:

```powershell
$env:RUN_OPENAI_LIVE_TESTS = "1"
$env:OPENAI_API_KEY = "<secret>"
python -m unittest tests.test_openai_job_understanding_live -v
```

The fixture contains no candidate, application, or private job-search data.
