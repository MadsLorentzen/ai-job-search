# Conformité des connecteurs

Le connecteur France Travail utilise l'[API officielle Offres d'emploi](https://www.data.gouv.fr/dataservices/api-offres-demploi) v2. Il
est opt-in, limité par `--pages` et n'enregistre que les champs nécessaires au
suivi d'une offre. Les conditions d'accès, quotas et finalités doivent être
revus avant toute mise en production.

Les portails sans API officielle restent en import manuel dans le MVP. Aucun
scraping massif, contournement de CAPTCHA, authentification automatisée ou
envoi de candidature n'est implémenté.

Une erreur réseau produit un état traçable (`inaccessible` ou `à_vérifier`) et
ne bloque pas l'import par texte collé. Les fixtures sont synthétiques et ne
contiennent ni coordonnées personnelles ni jetons.
