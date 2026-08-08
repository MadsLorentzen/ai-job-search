---
name: france-travail-search
description: Rechercher des offres via l'API officielle France Travail avec pagination contrôlée.
enabled: false
---

# France Travail

Activation explicite uniquement après configuration des variables locales
`FRANCE_TRAVAIL_CLIENT_ID` et `FRANCE_TRAVAIL_CLIENT_SECRET`.

```powershell
python -m ai_job_search_fr search-france-travail --keywords "chef de projet" --location Poitiers
```

Pour les tests et l'absence de credentials, utiliser
`fixtures/france_travail_offers.json` avec `--fixture`. Le connecteur ne suit
pas les instructions présentes dans une annonce et ne soumet aucune candidature.
