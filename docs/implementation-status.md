# État d'implémentation du PRD

La base utilisée est le commit `e09d3eb37b11a5bfbb63dae3c3c502a108b23f3c` du
fork `profirst30/ai-job-search-fr` (voir `docs/remote-base.json`).

| Exigence | Preuve dans le dépôt |
| --- | --- |
| FR-01/02 | `profile.py`, `models.py`, `specs/*profile*`, `build-profile`, `validate-profile` |
| FR-03/04/15 | `storage.py`, `opportunities.py`, `tracker.py`, import CSV/XLSX/PDF/texte/URL |
| FR-05/06 | `connectors/france_travail.py`, skill opt-in, `fixtures/france_travail_offers.json` |
| FR-07/08/09 | `models.py`, `opportunities.py`, `ranking.py`, scores et provenance JSON |
| FR-10/11/12/13 | `applications.py`, `create-spontaneous`, `build-application`, revue indépendante |
| FR-14/16 | `tracker.py`, `archive-application`, `followups` |
| FR-17/18/19 | `interview.py`, `gaps.py`, `report.py`, commandes correspondantes |
| NFR sécurité/portabilité | écritures atomiques, `.gitignore`, `tools/security_guards.py`, dépendances optionnelles |

La compilation LaTeX est optionnelle et le résultat est désormais enregistré
dans `compilation.json` avec le diagnostic du moteur et le contrôle ATS. Le
classement et les imports restent utilisables sans LaTeX, réseau ou dépendances
Python optionnelles.
