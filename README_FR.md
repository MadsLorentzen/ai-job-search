# ai-job-search-fr — couche française du fork

Ce dépôt part du fork distant `profirst30/ai-job-search-fr` et ajoute une
couche locale-first conforme au PRD français. Les workflows historiques du
projet amont restent disponibles; la nouvelle couche est utilisable avec Codex
ou un terminal Python.

```powershell
python -m ai_job_search_fr init
python -m ai_job_search_fr build-profile documents/cv/mon-cv.pdf
python -m ai_job_search_fr import-opportunity --text "Titre: ..." --output data/opportunities/import.json
python -m ai_job_search_fr deduplicate
python -m ai_job_search_fr rank
```

Pour une candidature spontanée, utilisez `create-spontaneous`; après validation
humaine, `archive-application` conserve l'annonce, le CV, le message et les
métadonnées exactes.

Voir [docs/installation.md](docs/installation.md),
[docs/architecture.md](docs/architecture.md) et le [PRD](docs/PRD_VERSION_FRANCAISE.md).

Le système prépare des documents, les vérifie et les archive; il ne soumet
jamais de candidature et n'envoie aucun message automatiquement.
