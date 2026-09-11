# Candidate Profile Schema

This file is the provider-neutral profile contract used by local setup and application workflows.

## Historical facts

The master CV (`cv/main_example.tex`, or a user-provided master CV under `documents/cv/`) is authoritative for:

- Identity and contact details
- Employment titles, employers, locations, and exact dates
- Education, institutions, degrees, thesis topics, and dates
- Quantitative metrics, publications, awards, certifications, skills, and projects

A preference file, model inference, archived application, or behavioral signal must never overwrite a historical fact. Conflicts are proposed to the user and require an explicit manual override.

## Application preferences

`CLAUDE.md` and the candidate preference files are authoritative for:

- Target role titles and sectors
- Compensation goals
- Remote, location, commute, and travel preferences
- Career goals and motivations
- Deal-breakers
- CV language and application preferences

Preferences cannot change historical facts.

## Behavioral and writing signals

Behavioral observations and writing-style preferences are suggestions, not facts. They must be source-tagged, confidence-scored, and explicitly approved before persistence.

## Update contract

Every proposed update contains:

- `field`
- `category`
- `current_value`
- `proposed_value`
- `source`
- `reasoning`
- `confidence`
- `requires_confirmation: true`

The local application displays numbered proposals. It supports approve all, reject all, selective approval, and manual edits. No proposal is written without explicit approval.
