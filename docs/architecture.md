# Architecture de `ai-job-search-fr`

La base est le fork distant `profirst30/ai-job-search-fr`, conservé comme
workflow amont. La couche française est additive et agent-agnostique.

```text
documents candidat ──> profil maître YAML ──────────────┐
                                                         │
API France Travail / import manuel ─> opportunités JSON ─┼─> déduplication ─> classement
entreprises ciblées ─> opportunités spontanées ──────────┘                       │
                                                                                 v
                                             CV/message dérivés ─> revue ─> archive + tracker CSV
```

## Contrats

`ai_job_search_fr.models.Opportunity` implémente `specs/opportunity.schema.yaml`.
Toutes les sources sont conservées dans `sources`; une valeur inconnue reste
`null`. `SearchProfile` sépare préférences et critères éliminatoires. Le score
retourne une note par dimension, la confiance, les écarts, les vérifications et
l'action recommandée.

Le profil maître n'est jamais modifié par la génération d'un CV. Les éléments
`à_confirmer` ou `interdite` sont exclus des documents générés.

`build-profile` extrait des faits depuis un CV/portfolio mais les marque tous
`à_confirmer`; seule une validation explicite du candidat permet de les rendre
réutilisables.

Les commandes `prepare-interview`, `analyze-gaps` et `html-report` couvrent les
extensions P1 sans déplacer la source de vérité : elles lisent les archives et
le tracker, puis écrivent des artefacts locaux régénérables.

## Connecteurs

Un connecteur expose `search` et `detail`, retourne des `Opportunity` et ne
contient aucun secret. Le connecteur France Travail est désactivé sans
`FRANCE_TRAVAIL_CLIENT_ID` et `FRANCE_TRAVAIL_CLIENT_SECRET`. Les tests utilisent
`fixtures/france_travail_offers.json` et aucun réseau.

## Fiabilité et confidentialité

Les écritures JSON/CSV/YAML utilisent un fichier temporaire puis `os.replace`.
Les documents importés sont copiés dans `documents/imported/` avec SHA-256 et
journal idempotent. Les dossiers personnels et secrets sont exclus par
`.gitignore`. Les commandes d'import proposent `--dry-run` lorsqu'une écriture
de données est concernée.
