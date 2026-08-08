---
name: opportunity-import
description: Importer une offre française par texte, URL, CSV, XLSX, JSON ou PDF.
enabled: true
---

Le contrat commun est `specs/opportunity.schema.yaml` et l'implémentation est
`ai_job_search_fr.opportunities`.

```powershell
python -m ai_job_search_fr import-opportunity --text "..."
python -m ai_job_search_fr import-opportunity --input offre.pdf
python -m ai_job_search_fr deduplicate
```

Une URL inaccessible est conservée comme `inaccessible`; le texte collé reste
la voie de repli.
