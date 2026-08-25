<!-- application-pack-artifact: art_v1_manual_editing_projection_baseline -->

# Application Pack

**Company:** Acme Corp  
**Title:** Backend Engineer  

## Source Artifacts

```json
{
  "profile_snapshot": {
    "artifact_id": "art_profile_exact",
    "artifact_type": "profile_snapshot",
    "content_id": "content_profile_exact"
  },
  "job_posting_snapshot": {
    "artifact_id": "art_job",
    "artifact_type": "job_posting_snapshot",
    "content_id": "content_job"
  },
  "job_fit_result": {
    "artifact_id": "art_fit",
    "artifact_type": "job_fit_result",
    "content_id": "content_fit"
  },
  "application_intelligence_result": {
    "artifact_id": "art_ai",
    "artifact_type": "application_intelligence_result",
    "content_id": "content_ai"
  }
}
```

## Job Posting Evidence

```json
{
  "company": "Acme Corp",
  "title": "Backend Engineer",
  "location": "London"
}
```

## Fit Summary

```json
{}
```

## Recommendation

PROCEED

Reviewed evidence supports proceeding.

## CV Content

- Reviewed summary.
- Reviewed highlight.

## Cover Letter Content

- Reviewed cover-letter paragraph.

## Candidate Snapshot

```json
{
  "profile_schema_version": "candidate-profile-evidence-snapshot.v0",
  "identity": {
    "name": {
      "value": "Ada Lovelace",
      "profile_evidence_ids": [
        "clm_0000000000000001"
      ]
    }
  },
  "contact": {
    "email": null,
    "phone": null,
    "linkedin": null,
    "github": null,
    "location": null
  },
  "employment": [],
  "education": [],
  "certifications": [],
  "skills": [],
  "languages": [],
  "projects": [],
  "publications": [],
  "awards": []
}
```

## Review and Exclusion Audit

```json
{
  "decisions_consulted": [
    {
      "id": "rev_cv_summary",
      "workspace_id": "workspace_1",
      "review_item_type": "content_unit",
      "source_artifact_id": "art_ai",
      "domain_item_id": "cv_summary_1",
      "disposition": "acknowledged_and_proceed",
      "note": null,
      "created_at": "2026-08-24T10:00:00+00:00"
    },
    {
      "id": "rev_cv_bullet",
      "workspace_id": "workspace_1",
      "review_item_type": "content_unit",
      "source_artifact_id": "art_ai",
      "domain_item_id": "cv_bullet_1",
      "disposition": "acknowledged_and_proceed",
      "note": null,
      "created_at": "2026-08-24T10:01:00+00:00"
    },
    {
      "id": "rev_cover",
      "workspace_id": "workspace_1",
      "review_item_type": "content_unit",
      "source_artifact_id": "art_ai",
      "domain_item_id": "cover_1",
      "disposition": "acknowledged_and_proceed",
      "note": null,
      "created_at": "2026-08-24T10:02:00+00:00"
    }
  ],
  "exclusions": [],
  "informational_items": {}
}
```
