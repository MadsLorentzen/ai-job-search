# Evidence-grounded diagnostic assistant

Status: proposed; target-job mapping pending. Assumes Python and engineering-domain
experience. Focus on evaluating retrieval and answer behavior, not a chatbot UI.
Budget: 22-32 hours; no paid model is required for the retrieval-only baseline.

## Problem

Answer questions from a small synthetic equipment manual corpus, with evidence
citations and explicit abstention when support is absent. This is a learning demo,
not a real vehicle repair or safety decision system. Use no proprietary manuals.

## Milestones

1. **Evaluation first (4-5h):** author 15 short synthetic manuals and 40 questions,
   including answerable, ambiguous and unsupported questions. Label relevant passages
   and expected facts. Freeze a held-out question set before tuning.
2. **Retrieval baseline (5-7h):** implement lexical retrieval, then compare an embedding
   retriever if suitable. Measure recall@k and reciprocal rank against passage labels.
   Record chunking and query choices; use development questions for tuning.
3. **Answer layer (7-11h):** add a replaceable model interface, citations and abstention.
   Mock it for deterministic tests; optionally use a local model or explicitly chosen
   paid provider. Measure answer support separately from retrieval quality.
4. **Failure report (6-9h):** test contradictory manuals, irrelevant retrieval and
   instruction-like text embedded in documents. Compare retrieval-only, baseline and
   improved pipeline on the frozen test set, reporting failures and limitations.

## Acceptance checks

- Every displayed citation resolves to a stored document and passage.
- Unsupported questions are evaluated for abstention, not rewarded for fluent guesses.
- No document instruction can trigger a tool or network request.
- Report retrieval and answer metrics separately, with sample counts and evaluation rubric.
- State whether answer scores came from humans, rules or model judges; do not equate
  model-judge scores with factual correctness. Report latency/cost only when measured.

## What you should explain

Is a wrong answer caused by retrieval or generation? Why this chunk size? What changes
when two sources conflict? How would you set an abstention threshold without using
held-out questions? How could a judge share the generator's blind spots?

## Official reading

- [Ragas metric definitions](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/)

A library is optional: first implement and understand the metric definitions.
