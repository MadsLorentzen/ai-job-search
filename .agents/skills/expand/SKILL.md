---
name: expand
description: >-
  Enriches the candidate profile by discovering and extracting competencies from documents
  (CV, diplomas, references), GitHub repositories, and online courses.
  Triggers on: expand, expand profile, discover competencies, scan github, enrich skills, /expand.
---

# /expand - Competency Expansion from Documents and Online Presence

You are enriching the candidate profile by discovering competencies hidden in documents and public online presence. This workflow is additive only — it never modifies existing profile content, only extends it.

Follow these steps **exactly in order**.

---

## Step 0: Read Existing Profile Files

Read these files in parallel before doing anything else:
- `.agents/skills/job-application-assistant/01-candidate-profile.md`
- `.agents/skills/job-application-assistant/02-behavioral-profile.md`

---

## Step 1: Discovery — Scan All Sources

Scan available sources for experience items:
1. **`documents/cv/`**: Courses, certifications, job bullets, side projects.
2. **`documents/linkedin/`**: Certifications, skills/endorsements, recommendations.
3. **`documents/diplomas/`**: Courses, thesis topic, GPA/honors.
4. **`documents/references/`**: Competency language and quotes.
5. **GitHub Profile & Repositories**: Read public profile and repositories using `read_url_content` or `search_web`.
6. **Other Profile URLs**: Portfolio, personal site, Kaggle, Scholar.

---

## Step 2: Web Enrichment

For each discovered item, extract implied competencies:
- **Approach A (Direct Lookup)**: Search syllabus/exam guide using `search_web` or `read_url_content`.
- **Approach B (Inference)**: Deduce problem domain, standard toolchains, and necessary skills.

---

## Step 3: Build Competency Map

Group deduplicated findings into:
- **Technical Skills — Primary**
- **Technical Skills — Secondary**
- **Domain Knowledge**
- **Methods and Practices**
- **Soft / Behavioral Signals**

---

## Step 4: Present Grouped Summary

Present all discovered items to the user and ask for confirmation (`all`, `review`, or `skip`).

---

## Step 5: Write Confirmed Additions

Add confirmed additions to:
- `.agents/skills/job-application-assistant/01-candidate-profile.md`
- `.agents/skills/job-application-assistant/02-behavioral-profile.md`

---

## Step 6: Summary Report

Provide a summary of added competencies, sources processed, and items needing manual review.
