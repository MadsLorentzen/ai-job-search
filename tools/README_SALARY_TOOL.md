# Salary Benchmark Tool

## What Is This?

The salary lookup tool (`salary_lookup.py`) benchmarks a company or role against your own EUR salary data. It is optional; if `salary_data.json` is missing, `$job-apply` skips the salary step.

Use sources that make sense for Portugal and EU remote roles: public salary ranges, Portuguese salary surveys, Glassdoor, Teamlyzer, Levels.fyi where relevant, networking notes, recruiter ranges, or your own spreadsheet.

## Data Format

Create `salary_data.json` in the repo root:

```json
{
  "metadata": {
    "source": "Personal EUR salary research 2026",
    "index_baseline": 0,
    "index_label": "Annual gross salary (EUR)",
    "baseline_description": "Approximate annual gross compensation"
  },
  "companies": [
    {
      "company": "Example Tech Portugal",
      "city": "Lisbon",
      "categories": {
        "mid_level": { "count": 5, "index": 45000 },
        "senior": { "count": 3, "index": 65000 }
      }
    },
    {
      "company": "Remote EU Startup",
      "city": "Remote EU",
      "categories": {
        "senior": { "index": 80000 }
      }
    }
  ]
}
```

## Fields

- `metadata.source`: Where the data comes from.
- `metadata.index_label`: Label shown in output.
- `metadata.baseline_description`: Human-readable explanation.
- `companies[].company`: Company name.
- `companies[].city`: Optional city, country, or remote scope.
- `companies[].categories`: Named salary categories with `count` and/or `index`.

## Setup Options

### Create Manually

Add companies as you research them. This is usually enough for a personal job search.

### Convert From Excel

```bash
pip install openpyxl
python tools/convert_salary_excel.py path/to/salary-data.xlsx \
  --source "My EUR Salary Data 2026" \
  --baseline 0 \
  --baseline-desc "Annual gross salary in EUR"
```

The converter auto-detects common columns such as company, city/location, salary, median, average, EUR, count, and sample size.

## Usage

```bash
python salary_lookup.py "Example Tech Portugal"
python salary_lookup.py "Remote EU Startup" --city "Remote EU"
python salary_lookup.py "Example Tech Portugal" --json
python salary_lookup.py --list-all
```

## Notes

- `salary_data.json` is excluded from git because salary notes can be private.
- Missing salary data is fine; `$job-apply` continues without it.
- Matching is accent-insensitive and strips common Portuguese legal suffixes such as `Lda`, `S.A.`, and `Unipessoal`.
