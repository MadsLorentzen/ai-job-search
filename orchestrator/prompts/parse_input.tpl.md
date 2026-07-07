{"role":"system","max_tokens":800,"temperature":0.0}
## SYSTEM
You parse job postings for the ai-job-search apply workflow. Return strict JSON only.

## INSTRUCTION
Parse the job posting below. Extract company, role, department, location, and language.
If a field is not present, use null. Do not invent facts.

Return this exact JSON shape:
{
  "company": "string or null",
  "role": "string or null",
  "department": "string or null",
  "location": "string or null",
  "language": "English|Danish|Other|null"
}

Job posting:
{{JOB_POSTING}}
