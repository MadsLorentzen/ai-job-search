# Bug Fixes

## Bug #10 — `convert_salary_excel.py`: Silent zero output due to `read_only=True` incompatibility

### What is the bug?

`tools/convert_salary_excel.py` opens the Excel workbook in read-only mode for memory efficiency:

```python
wb = openpyxl.load_workbook(excel_path, read_only=True, data_only=True)
```

Then, after finding which row number contains the header, it re-accesses that row by index:

```python
for cell in ws[header_row]:
    headers.append(str(cell.value).strip() if cell.value else "")
```

**openpyxl's `read_only=True` mode does not support random row access via `ws[row_index]`.** The worksheet only supports sequential forward iteration. Depending on the openpyxl version, `ws[header_row]` either raises an `AttributeError` or silently returns no cells — meaning `headers` ends up as an empty list, `company_col` is never set, and the function returns `[]` with just a warning:

```
Warning: Could not find company column in sheet '...'.
```

The script then exits with:

```
Error: No data could be parsed from the Excel file.
```

Zero output. No indication that the root cause is a library compatibility issue rather than a malformed file.

### Why fix it?

The bug makes the salary conversion tool completely non-functional on any Excel file when using a modern openpyxl release. Users get a misleading error about their file format rather than a clear explanation of what went wrong. The `read_only=True` flag was added for memory efficiency, but it silently breaks the core feature it was meant to support.

### How it was fixed

During the header-row scan, we now save the row's values at the same time we find the row index — so we never need to go back and re-access it:

**Before:**
```python
header_row = None
for row_idx, row in enumerate(ws.iter_rows(min_row=1, max_row=10, values_only=False), start=1):
    for cell in row:
        if cell.value and str(cell.value).strip().lower() in COMPANY_PATTERNS:
            header_row = row_idx
            break
    if header_row:
        break

# Later — broken under read_only=True:
headers = []
for cell in ws[header_row]:
    headers.append(str(cell.value).strip() if cell.value else "")
```

**After:**
```python
header_row = None
saved_header_cells = None
for row_idx, row in enumerate(ws.iter_rows(min_row=1, max_row=10, values_only=True), start=1):
    for cell_val in row:
        if cell_val and str(cell_val).strip().lower() in COMPANY_PATTERNS:
            header_row = row_idx
            saved_header_cells = row
            break
    if header_row:
        break

# Use the saved row — no random access needed:
headers = [str(v).strip() if v else "" for v in saved_header_cells]
```

Key changes:
- `values_only=False` → `values_only=True` (we only need values, not cell objects)
- Store the matching row tuple in `saved_header_cells` during the scan
- Replace `ws[header_row]` with `saved_header_cells` — already in memory, compatible with `read_only=True`

---

## Bug #5 — LinkedIn CLI: `parseInt` on flag values not validated for `NaN`

### What is the bug?

In `.agents/skills/linkedin-search/cli/src/cli.ts`, numeric flags `--jobage`, `--page`, and `--limit` are parsed like this:

```typescript
jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
page:   flags.page   ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
limit:  flags.limit  ? parseInt(flags.limit as string, 10) : undefined,
```

If the user passes a non-numeric value (e.g. `--jobage foo`), `parseInt("foo", 10)` returns `NaN`. This `NaN` is then passed into `jobageToTPR(NaN)` inside `helpers.ts`:

```typescript
if (!days || days <= 0 || days >= 9999) return null
```

`!NaN` evaluates to `true`, so the function returns `null` — the age filter is silently dropped and the search runs as if `--jobage` was never passed. The user gets results back with no indication their filter was ignored.

The same issue applies to `--page` (NaN makes `Math.max(1, NaN)` → `NaN`, sent as the page parameter) and `--limit` (NaN passed as cap → no limiting applied).

### Why fix it?

The `--jobage` flag is a meaningful user request: "only show jobs posted within N days." Silently ignoring a typo or bad value means the user gets stale results they didn't ask for, with no feedback. Same logic applies to `--page` and `--limit`. Fast-fail with a clear error is always better than silent incorrect behavior.

### How it was fixed

Added a `parseIntFlag` helper that validates the result of `parseInt` before it reaches `SearchOpts`. If `NaN` is detected, it writes a structured error to stderr and returns `null` — the caller immediately returns exit code `1`.

**Before:**
```typescript
jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
page:   flags.page   ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
limit:  flags.limit  ? parseInt(flags.limit as string, 10) : undefined,
```

**After:**
```typescript
const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
  const val = parseInt(raw as string, 10)
  if (isNaN(val)) {
    process.stderr.write(JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n")
    return null
  }
  return val
}

if (flags.jobage !== undefined) {
  const v = parseIntFlag("jobage", flags.jobage)
  if (v === null) return 1
  flags.jobage = String(v)
}
if (flags.page !== undefined) {
  const v = parseIntFlag("page", flags.page)
  if (v === null) return 1
  flags.page = String(v)
}
if (flags.limit !== undefined) {
  const v = parseIntFlag("limit", flags.limit)
  if (v === null) return 1
  flags.limit = String(v)
}
```

The flags are validated and stringified back before `SearchOpts` is built, so all existing `parseInt` calls at the opts level still work correctly on clean input.

---

## Bonus discovery: `detect_column_type` — `"n"` pattern in `COUNT_PATTERNS` is too broad

> **Not fixed in this PR — logged for follow-up.**

`COUNT_PATTERNS = {"antal", "count", "number", "n", "employees", "medarbejdere"}`

The single-character pattern `"n"` matches as a substring of almost any word: `"n" in "indeks"` → `True`, `"n" in "index"` → `True`, `"n" in "median"` → `True`. This causes Danish index columns (`Indeks`, `Indeks All`, etc.) to be misclassified as count columns, so the count/index pairing logic never fires for typical Danish salary Excel files.

**Fix (suggested):** Replace `"n"` with a word-boundary check, or remove it entirely — it adds no meaningful detection value that `"antal"`, `"count"`, and `"number"` don't already cover.
