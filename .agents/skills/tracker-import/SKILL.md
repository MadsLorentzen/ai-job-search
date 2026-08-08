---
name: tracker-import
description: Importer le tableur de recherche en entreprises, opportunités et tracker portable.
enabled: true
---

La logique canonique vit dans `ai_job_search_fr.tracker`.

```powershell
python -m ai_job_search_fr import-tracker recherche.xlsx --destination data
```

Le mode `--dry-run` produit uniquement le rapport de correspondance. Toutes
les URLs et sources sont conservées; les statuts sont ceux de
`specs/tracker.schema.yaml`.
