---
name: job-application-fr
description: Générer et revoir un dossier de candidature français depuis le profil maître.
enabled: true
---

# Candidature française

La logique canonique vit dans `ai_job_search_fr.applications`. Ce skill ne
duplique pas les règles métier : il pointe vers les commandes portables.

```powershell
python -m ai_job_search_fr build-application --opportunity-id <id>
```

Les éléments `à_confirmer` et `interdite` ne doivent jamais être utilisés. La
revue est distincte de la rédaction et l'envoi reste toujours manuel.
