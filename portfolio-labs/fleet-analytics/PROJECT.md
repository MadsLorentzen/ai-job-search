# Fleet analytics warehouse

Status: proposed; target-job mapping pending. Assumes existing Python/SQL pipeline
experience. Focus on dbt rather than repeating Python or Airflow fundamentals.
Budget: 18-26 hours, adjusted after the first milestone.

## Problem

Build daily fleet operational metrics from synthetic vehicle events. A source delivers
duplicates, late events, vehicle metadata changes and schema errors. Analysts need
consistent metrics and a reproducible explanation of corrections.

## Milestones

1. **Contract and data (3-4h):** define event_id, vehicle_id, event_time, ingested_at,
   distance_km and energy_kwh. Generate deterministic synthetic Parquet with injected
   bad/late events. Document units, timezone and which rows are intentionally invalid.
2. **Models (5-7h):** choose a local dbt-compatible backend, pin a compatible adapter,
   and build staging, vehicle dimension and daily fact models. Decide how metadata
   changes should affect historical facts; explain the chosen grain and keys.
3. **Incremental correctness (6-8h):** implement deduplication, a documented late-arrival
   policy and backfill. Show incremental results equal a full rebuild after a correction.
4. **Evidence (4-7h):** add data tests and a failure investigation; publish lineage,
   clean-clone run instructions, measured runtime on your machine and a 3-minute demo.

## Acceptance checks

- Running the same batch twice cannot inflate event count or totals.
- Correcting a prior-day event changes the intended day and no other day's totals.
- Uniqueness, missing-key and relationship tests detect seeded failures.
- A full rebuild and incremental/backfill run produce equal business metrics.
- Report peak data size and runtime honestly; synthetic data is labeled synthetic.

## What you should explain

Why this grain? Why this late-event window? When would a snapshot be appropriate?
What breaks if vehicle metadata joins duplicate the facts? Which operations require a
full refresh, and how do you distinguish a data test from a unit test?

## Evidence for a later resume

Only after implementation: link the pipeline, model documentation, passing checks and
measured dataset scale. Do not claim production deployment or employer adoption.

## Official reading

- [dbt data tests](https://docs.getdbt.com/docs/build/data-tests)
- [Incremental models](https://docs.getdbt.com/docs/build/incremental-models)

Target requirements and private gap notes stay outside the public project.
