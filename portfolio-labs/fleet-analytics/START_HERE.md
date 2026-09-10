# First working milestone: event contract

AI-assisted starter; learning is not yet demonstrated. All records are synthetic.
No dependencies beyond Python 3.10+. From this directory:

```sh
python -m unittest discover -v
python starter.py --output /tmp/fleet-events.jsonl
```

On Windows, use a new file path such as `fleet-events.jsonl` outside this repository.
The command refuses to overwrite an existing file. JSONL is the dependency-free
first milestone; Parquet and dbt remain future work.

Your first exercise: quarantine invalid rows, deduplicate by event ID, and compute
daily distance and energy. A duplicate must not increase totals. Explain why a
late event belongs to January 1 despite arriving January 3. Then add a corrected
version of an existing event and define how to choose the winning version.

Expected clean totals before corrections: January 1, 20 km, 24 kWh, two events.
Do not use ingestion date as the business date.

Next: choose a dbt adapter, implement incremental models, and compare incremental
results with a full rebuild after late arrivals and corrections. Keep the actual
benchmark and your design explanation as evidence of your learning.

## Job grounding, checked 2026-09-10

The public Power Digital Data Engineer, AI & Analytics posting requires production
dbt ownership, incremental modeling and late corrections. This lab targets those
concepts. Completing a lab does not meet its one-year production-ownership requirement.

https://job-boards.greenhouse.io/powerdigitalmarketing/jobs/5219542007

The Luxor Data Engineer posting emphasizes pipeline reliability and automated data
quality checks, motivating the starter contract and repeatable fixtures.

https://jobs.ashbyhq.com/luxor/710287ed-5596-47a1-b0bc-3fb44ba720b0

These are learning references, not confirmation of salary, location eligibility or
application status. No personal gap analysis belongs in this public directory.
