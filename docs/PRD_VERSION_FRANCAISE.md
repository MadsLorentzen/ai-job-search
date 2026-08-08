# PRD — ai-job-search-fr

> Statut : proposition initiale  
> Version : 0.2  
> Date : 8 août 2026  
> Nom du projet : `ai-job-search-fr`  
> Projet amont : [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search)  
> Licence envisagée : MIT, avec conservation de l'avis de copyright amont

## 1. Résumé

`ai-job-search-fr` est une version française open source, francophone et orientée marché français du projet `ai-job-search`. Le produit aide un candidat à transformer ses documents et ses préférences en un processus local, traçable et assisté par agent pour :

- structurer son profil professionnel ;
- rechercher ou importer des offres françaises ;
- classer les opportunités selon leur adéquation réelle ;
- produire un CV et une lettre adaptés sans inventer d'expérience ;
- suivre les candidatures, relances et résultats ;
- préparer les entretiens ;
- identifier les compétences à développer.

La première version couvre la recherche d'emploi au sens large en France : alternance, stage, premier emploi, CDD, CDI et autres contrats configurés par l'utilisateur. Elle accorde une attention particulière aux étudiants, jeunes diplômés et personnes à la recherche de leur premier poste. Le premier cas d'usage réel du mainteneur reste la recherche d'une alternance. Elle doit fonctionner avec Codex en premier lieu, tout en conservant une architecture compatible avec d'autres agents de développement.

Le produit reste local-first : le dépôt du candidat constitue la source de vérité, aucun service central n'est requis et aucune candidature n'est envoyée automatiquement.

## 2. Problème

La recherche d'un emploi, d'un premier poste ou d'une alternance en France est fragmentée :

- les offres sont réparties entre France Travail, JobTeaser, APEC, LinkedIn, Welcome to the Jungle, les sites carrières et les réseaux d'écoles ;
- les intitulés, niveaux de diplôme et types de contrat ne sont pas normalisés ;
- une offre peut être pertinente techniquement mais incompatible avec le type de contrat, l'expérience attendue, le diplôme, la date de début, le rythme éventuel ou la mobilité du candidat ;
- les offres expirent vite et les doublons sont fréquents ;
- les candidatures spontanées sont importantes, notamment auprès des PME, startups et laboratoires ;
- adapter correctement un CV, une lettre et un message d'approche prend du temps ;
- le suivi est souvent dispersé entre tableurs, favoris, courriels et documents locaux ;
- les assistants généralistes produisent facilement des textes génériques ou des affirmations non vérifiées.

Le projet amont résout une grande partie du workflow de candidature, mais ses principaux connecteurs sont danois, son expérience principale est conçue autour de Claude Code et ses conventions documentaires ne sont pas adaptées par défaut au marché français, à la recherche d'un premier emploi ou aux spécificités de l'alternance.

## 3. Vision produit

Permettre à toute personne cherchant un emploi en France — notamment une alternance ou un premier poste — de disposer d'un copilote open source qui connaît son parcours, respecte ses contraintes, explique chaque recommandation et l'aide à produire des candidatures crédibles, sans automatisation abusive ni dépendance à une plateforme propriétaire.

## 4. Principes directeurs

1. **Exactitude avant volume** — aucune compétence, réalisation ou motivation ne doit être inventée.
2. **Humain dans la boucle** — le produit prépare et recommande ; le candidat décide et envoie.
3. **Sources visibles** — une information issue d'une offre ou d'une recherche entreprise doit conserver son URL et sa date de vérification.
4. **Local-first et portable** — les données personnelles restent dans le workspace par défaut.
5. **Conformité par défaut** — API officielle ou import manuel avant scraping ; connecteurs désactivables ; faible volume.
6. **Marché français d'abord** — type de poste, contrat, expérience attendue, formation, mobilité et date de début sont des critères de premier rang ; le rythme et l'école s'ajoutent en mode alternance.
7. **Agent-agnostique** — les règles métier canoniques ne doivent pas dépendre d'une syntaxe propre à un seul agent.
8. **Dégradation élégante** — chaque workflow essentiel doit fonctionner avec le texte d'une offre collé manuellement.
9. **Configuration plutôt que fork permanent** — les différences de marché, de CV et de portails doivent être exprimées dans des profils, schémas et connecteurs isolés.

## 5. Objectifs

### 5.1 Objectifs du MVP

- Exécuter l'ensemble du parcours principal avec Codex.
- Créer un profil candidat français structuré à partir d'un CV et d'un entretien guidé.
- Représenter une recherche générique : type de poste, contrat, expérience, secteur, date de début, localisation et mobilité.
- Activer des critères spécialisés selon le mode choisi, notamment rythme, durée, rentrée et école pour l'alternance.
- Importer des offres par texte, URL, JSON, CSV ou XLSX.
- Rechercher des offres via au moins un connecteur officiel français : l'API Offres d'emploi de France Travail.
- Dédupliquer, vérifier la fraîcheur et classer les offres avec une justification lisible.
- Gérer à égalité offres publiées et candidatures spontanées.
- Maintenir un profil maître YAML unique contenant toutes les expériences, tous les projets et toutes les compétences vérifiées.
- Générer pour chaque annonce un CV français dérivé et adapté, une lettre ou un message court selon le canal.
- Compiler et contrôler visuellement les PDF, puis contrôler leur couche texte pour les ATS.
- Suivre candidatures, relances, entretiens et résultats dans des fichiers ouverts.
- Importer le tableur existant de recherche d'entreprises sans perte des sources.
- Documenter l'installation Windows, macOS et Linux.

### 5.2 Objectifs post-MVP

- Ajouter des connecteurs validés pour d'autres portails français.
- Synchroniser facultativement les réponses depuis une messagerie avec approbation préalable.
- Proposer un tableau de bord HTML local.
- Fournir des réglages spécialisés supplémentaires pour reconversion, VIE, freelance et secteur public.
- Ajouter l'anglais comme langue de sortie pour les entreprises internationales en France.
- Permettre des packs communautaires de portails, modèles de CV et grilles d'évaluation.

## 6. Hors périmètre du MVP

- Envoi automatique de candidatures, courriels ou messages LinkedIn.
- Remplissage automatique de formulaires de candidature.
- Scraping massif, contournement de CAPTCHA, authentification automatisée ou rotation de comptes.
- Promesse d'obtenir un entretien ou un emploi.
- Décision juridique automatique sur l'éligibilité à un contrat.
- Évaluation d'un candidat par un recruteur ou classement de personnes.
- Stockage centralisé des CV et données personnelles des utilisateurs.
- Application web hébergée multi-utilisateur.
- Reproduction ou redistribution de contenus de portails au-delà de ce que permettent leurs licences et conditions d'utilisation.

## 7. Utilisateurs cibles

### Persona A — Étudiant recherchant une alternance

Étudiant en Master, université ou école recherchant une alternance, parfois à l'interface de plusieurs domaines. Il possède des projets et premières expériences, mais les intitulés d'offres ne correspondent pas toujours exactement à son profil.

**Besoin principal :** identifier les rôles où ses compétences transférables créent une forte adéquation et les présenter clairement.

### Persona B — Jeune diplômé recherchant son premier emploi

Jeune diplômé disposant de stages, projets académiques, engagements ou expériences freelance, mais de peu d'expérience en emploi permanent.

**Besoin principal :** transformer ses expériences de formation en preuves professionnelles crédibles, identifier les postes réellement accessibles et éviter de s'auto-éliminer face à des exigences seulement préférentielles.

### Persona C — Candidat en territoire régional

Candidat qui privilégie une ou plusieurs villes et doit combiner offres publiées, réseau local et candidatures spontanées.

**Besoin principal :** maintenir une liste d'entreprises cibles, vérifier régulièrement les opportunités et préparer une approche personnalisée.

### Persona D — Mainteneur ou contributeur open source

Développeur souhaitant ajouter un portail, un format de CV, une région ou un workflow sans accéder aux données personnelles du candidat.

**Besoin principal :** disposer de contrats d'interface, fixtures anonymes, tests hors ligne et règles de contribution claires.

## 8. Jobs to be done

- Quand je démarre ma recherche, je veux transformer mes documents en un profil précis afin que l'agent ne produise pas de contenu générique.
- Quand je cherche mon premier emploi, je veux valoriser honnêtement stages, projets et compétences transférables sans prétendre avoir une expérience que je n'ai pas.
- Quand je trouve une offre, je veux savoir rapidement si elle mérite une candidature et comprendre pourquoi.
- Quand une entreprise m'intéresse sans publier d'alternance, je veux préparer une candidature spontanée crédible.
- Quand je candidate, je veux adapter mon CV sans modifier les faits ni dégrader sa lisibilité ATS.
- Quand plusieurs offres s'accumulent, je veux prioriser selon l'adéquation, l'urgence et l'effort nécessaire.
- Quand une candidature reste silencieuse, je veux une relance courte et contextualisée.
- Quand j'obtiens un entretien, je veux préparer des réponses fondées sur les documents réellement envoyés.
- Quand mes candidatures échouent, je veux distinguer problème de ciblage, lacune de compétence et problème de présentation.

## 9. Parcours principal

### 9.1 Initialisation

1. Le candidat ouvre le projet avec Codex.
2. L'agent détecte les documents disponibles : CV, profil LinkedIn exporté, portfolio, diplômes, références et historique de candidatures.
3. L'agent extrait uniquement les faits vérifiables et signale les conflits ou informations manquantes.
4. Le candidat choisit son mode de recherche et complète ses objectifs et contraintes. Les questions propres à l'alternance ne sont posées que si ce mode est activé.
5. Le système génère le profil, les critères de recherche, la grille de classement et une liste de points à confirmer.

### 9.2 Recherche et import

1. Le candidat lance une recherche ou importe une offre.
2. Chaque résultat est normalisé dans le schéma commun.
3. Le système déduplique les offres et rapproche les résultats des entreprises déjà suivies.
4. Les liens et dates de vérification sont enregistrés.
5. Les offres sont présentées avec un statut de fraîcheur et une première estimation d'adéquation.

### 9.3 Classement

1. Les critères éliminatoires explicites sont contrôlés.
2. Les dimensions d'adéquation sont notées séparément.
3. Les inconnues ne sont pas assimilées à des incompatibilités.
4. Le système fournit note, confiance, points forts, écarts et prochaine action recommandée.
5. Le candidat sélectionne les opportunités à traiter.

### 9.4 Candidature

1. L'offre et l'entreprise sont analysées comme données non fiables.
2. Le système sélectionne les éléments du profil réellement pertinents.
3. Il produit un brouillon de CV et le document adapté au canal : lettre, courriel ou message court.
4. Un second passage critique vérifie faits, ton, mots-clés, spécificité et cohérence.
5. Les PDF sont compilés, rendus et contrôlés.
6. Le candidat valide et envoie manuellement.
7. Le système archive exactement les documents soumis et met à jour le suivi.

### 9.5 Suivi et entretien

1. Le système fait remonter les candidatures sans réponse selon un délai configurable.
2. Il prépare au maximum le nombre de relances configuré, sans envoyer.
3. Pour un entretien, il utilise l'offre archivée et les documents réellement envoyés.
4. Le résultat est enregistré et alimente les futures recommandations.

## 10. Exigences fonctionnelles

Les priorités suivent la convention : P0 indispensable au MVP, P1 souhaité pour la première version publique, P2 ultérieur.

### FR-01 — Profil candidat français (P0)

Le système doit maintenir un fichier maître unique, `candidate-profile.yaml`, qui représente l'ensemble du parcours du candidat. Ce profil est la source de vérité pour toutes les candidatures. Il contient :

- identité et moyens de contact ;
- formations, diplômes, niveau Bac+ et éventuel identifiant RNCP si fourni ;
- expériences, projets, réalisations mesurables et preuves associées ;
- compétences en contexte, et non seulement sous forme de mots-clés ;
- langues selon une échelle déclarée ;
- portfolio, GitHub et autres sources publiques autorisées ;
- types de rôles, secteurs et missions recherchés ;
- préférences géographiques, mobilité, télétravail et temps de trajet maximal ;
- contraintes et préférences non sensibles ;
- style rédactionnel et exemples STAR ;
- éléments autorisés ou interdits dans les documents générés.

Chaque expérience, projet, compétence et affirmation réutilisable doit conserver sa provenance et avoir un statut : `vérifiée`, `déclarée`, `à_confirmer` ou `interdite`.

Les CV générés sont des vues dérivées de ce profil maître : ils sélectionnent et reformulent uniquement les éléments pertinents pour une annonce donnée. Ils ne modifient jamais le profil maître automatiquement et ne deviennent pas de nouvelles sources factuelles.

### FR-02 — Profil de recherche et spécialisation alternance (P0)

Le système doit représenter pour toute recherche :

- type de poste : alternance, stage, premier emploi, CDD, CDI, VIE, freelance ou autre valeur configurable ;
- intitulés et familles de métiers ciblés ;
- secteurs et types d'entreprises ;
- niveau d'expérience accepté ;
- contrats acceptés et refusés ;
- date de disponibilité ;
- préférences de localisation, mobilité et télétravail ;
- missions recherchées et refusées ;
- critères éliminatoires et préférences, explicitement séparés.

Lorsque le mode alternance est actif, le système doit également représenter :

- contrat d'apprentissage, contrat de professionnalisation ou indifférent ;
- formation et établissement ;
- niveau préparé ;
- date de début souhaitée et flexibilité ;
- durée ;
- rythme école/entreprise ;
- calendrier éventuel ;
- présence d'un CFA ou organisme partenaire, si pertinente ;
- capacité de déplacement et de relocalisation ;
- besoin éventuel de validation de la mission par l'école ;
- domaines de mission acceptés et refusés.

Le produit ne doit pas déduire ni utiliser un critère protégé pour classer les offres. Toute question d'éligibilité juridique doit être formulée comme point à vérifier, avec lien vers une source officielle.

Les objectifs, préférences, contraintes, critères éliminatoires et autorisations d'utilisation doivent être déclarés directement par l'utilisateur. Les expériences, projets, compétences, formations et dates peuvent être extraits de ses documents, avec leur provenance ; toute donnée ambiguë, contradictoire ou structurante doit être confirmée avant utilisation. Le système peut suggérer des métiers ou compétences transférables, mais ne les inscrit pas comme faits vérifiés sans validation.

### FR-03 — Import de documents (P0)

Formats minimum : PDF, texte, Markdown, LaTeX, CSV et XLSX. L'import doit :

- conserver les fichiers originaux ;
- signaler les problèmes d'encodage ;
- normaliser les textes internes en UTF-8 ;
- détecter les doublons et contradictions ;
- être relançable sans dupliquer les données ;
- produire un journal des éléments ajoutés, modifiés et ignorés.

### FR-04 — Import d'opportunités (P0)

Le système doit accepter :

- URL d'une offre ;
- texte intégral collé ;
- fichier texte ou PDF ;
- ligne CSV/XLSX ;
- fiche d'entreprise pour candidature spontanée ;
- résultat normalisé d'un connecteur.

Une page inaccessible ne doit jamais bloquer le workflow : le candidat doit pouvoir coller son contenu.

### FR-05 — Connecteur France Travail (P0)

Le premier connecteur français doit utiliser l'API Offres d'emploi de France Travail, sous réserve de l'inscription et des conditions d'accès applicables. Il doit :

- rechercher par mots-clés, localisation, distance et type de contrat lorsque l'API le permet ;
- récupérer le détail d'une offre ;
- conserver l'identifiant source et l'URL canonique ;
- transformer les champs dans le schéma commun ;
- gérer pagination, limites, erreurs, offres supprimées et jetons expirés ;
- ne jamais écrire les secrets dans le dépôt ;
- proposer des fixtures anonymisées pour les tests hors ligne.

### FR-06 — Connecteurs additionnels (P1/P2)

Chaque connecteur doit être livré comme module isolé respectant le contrat `search/detail`, avec :

- source et propriétaire clairement identifiés ;
- méthode d'accès documentée ;
- note sur les conditions d'utilisation et `robots.txt` ;
- volume conseillé ;
- tests hors ligne ;
- activation explicite ;
- absence de scripts d'installation cachés et de dépendances inutiles.

Ordre d'étude proposé :

1. API France Travail — P0 ;
2. import générique d'un site carrière ou d'un ATS public — P0/P1 ;
3. APEC, JobTeaser, Welcome to the Jungle — P1 seulement après validation des modalités d'accès ;
4. LinkedIn public — expérimental, désactivé par défaut et usage personnel à faible volume ;
5. packs régionaux ou sectoriels communautaires — P2.

### FR-07 — Schéma commun d'opportunité (P0)

Champs minimum :

```yaml
id: identifiant interne stable
source:
source_id:
source_url:
canonical_url:
title:
company:
company_website:
location:
remote_policy:
contract_type:
job_search_mode:
alternance_type:
experience_level:
education_level:
start_date:
duration:
work_study_schedule:
published_at:
expires_at:
verified_at:
description_raw:
description_normalized:
required_skills: []
preferred_skills: []
languages: []
salary:
contact:
application_channel:
spontaneous: false
status:
sources: []
```

Les champs inconnus doivent rester `null` ou `inconnu`, jamais être déduits sans preuve.

### FR-08 — Déduplication et fraîcheur (P0)

Le système doit :

- dédupliquer d'abord par source et identifiant ;
- utiliser ensuite URL canonique, entreprise, titre, localisation et similarité textuelle ;
- conserver la provenance de chaque doublon fusionné ;
- distinguer `active`, `probablement_active`, `à_vérifier`, `expirée` et `inaccessible` ;
- ne pas considérer une ancienne annonce comme active sans vérification ;
- afficher la date de dernière vérification.

### FR-09 — Classement explicable (P0)

Le classement doit séparer au minimum :

1. adéquation des missions ;
2. adéquation des compétences ;
3. compatibilité poste/contrat/expérience ;
4. localisation et organisation du travail ;
5. trajectoire et motivation ;
6. qualité et fraîcheur des informations.

En mode alternance, la troisième dimension inclut formation, niveau, type d'alternance, rythme, durée, rentrée et validation éventuelle par l'école. En mode premier emploi, elle distingue expérience obligatoire, expérience préférentielle et compétences transférables issues des stages et projets.

La sortie doit comporter :

- score par dimension ;
- score global ;
- niveau de confiance ;
- critères éliminatoires déclenchés ;
- trois forces maximum ;
- trois écarts maximum ;
- informations à vérifier ;
- urgence liée à une échéance ;
- action recommandée : candidater, contacter, surveiller, approfondir ou ignorer.

Les poids doivent être configurables et visibles. Une préférence ne doit pas devenir un critère éliminatoire sans décision explicite du candidat.

### FR-10 — Candidatures spontanées (P0)

Une entreprise sans annonce doit pouvoir être suivie comme opportunité. Le système doit produire :

- hypothèse de mission utile fondée sur des informations publiques ;
- justification de l'adéquation ;
- destinataire ou point d'entrée public, s'il existe ;
- message d'approche court ;
- CV adapté à l'entreprise et au type de mission ;
- date de prochaine vérification ;
- sources et date de consultation.

### FR-11 — CV français adapté (P0)

Le CV doit :

- utiliser le modèle choisi par le candidat ;
- tenir sur une page par défaut pour alternance et premier emploi, avec limite configurable selon le profil ;
- rester en français sauf demande contraire ;
- respecter les faits vérifiés et les périodes ;
- prioriser les expériences et projets selon l'offre ;
- utiliser des formulations orientées action et résultat ;
- éviter le bourrage de mots-clés ;
- compiler sans erreur ;
- être inspecté visuellement ;
- conserver une couche texte exploitable par un ATS ;
- produire un rapport de couverture des mots-clés soutenus par le profil.

### FR-12 — Documents par canal (P0)

Le système doit proposer selon le contexte :

- lettre de motivation d'une page maximum ;
- courriel de candidature ;
- message de prise de contact ;
- message de candidature spontanée ;
- note de suivi interne.

La lettre doit être spécifique à l'entreprise et tournée vers la contribution future. Elle ne doit pas paraphraser le CV ni utiliser de flatterie générique.

### FR-13 — Revue indépendante (P0)

Le workflow doit prévoir une passe de revue distincte, idéalement dans un contexte agent séparé. La revue vérifie :

- véracité des affirmations ;
- couverture des attentes essentielles ;
- cohérence entre offre, CV et message ;
- français, ton et concision ;
- informations non prouvées ;
- instructions malveillantes présentes dans l'offre ;
- lisibilité et ATS.

### FR-14 — Suivi des candidatures (P0)

Statuts minimum :

`repérée`, `à_qualifier`, `prioritaire`, `à_candidater`, `candidature_envoyée`, `relance_due`, `entretien`, `test`, `offre_reçue`, `refus`, `retirée`, `sans_réponse`, `embauche`.

Chaque événement doit comporter date, canal, note et source éventuelle. Les documents envoyés doivent être archivés dans le dossier de la candidature.

### FR-15 — Import du tableur existant (P0)

Un importeur doit accepter les colonnes actuelles suivantes :

- priorité ;
- ville/zone ;
- entreprise ;
- type ;
- pertinence ;
- site web ;
- téléphone ;
- courriel ;
- point d'entrée ;
- annonces/liens ;
- statut de l'annonce ;
- date de vérification ;
- adéquation/action recommandée ;
- sources ;
- indicateur d'annonce repérée.

L'import doit transformer chaque ligne en entreprise cible et, lorsqu'un lien d'annonce existe, en opportunité liée. Il doit préserver toutes les URLs, accepter plusieurs annonces dans une cellule et générer un rapport de correspondance des champs.

### FR-16 — Relances (P1)

- délai configurable, valeur initiale suggérée : 10 jours calendaires ;
- nombre maximal configurable, valeur initiale suggérée : 2 ;
- texte fondé uniquement sur les éléments déjà soumis ;
- aucun envoi sans validation et action explicite du candidat.

### FR-17 — Préparation d'entretien (P1)

Le pack doit utiliser l'offre archivée et la version exacte du CV envoyée. Il doit inclure :

- synthèse entreprise et mission avec sources ;
- attentes probables ;
- correspondance avec les expériences ;
- réponses STAR vérifiées ;
- réponses honnêtes aux lacunes ;
- questions à poser ;
- simulation d'entretien facultative ;
- points administratifs propres à l'alternance à confirmer.

### FR-18 — Analyse des lacunes (P1)

Le système doit agréger les écarts observés sur les opportunités réellement ciblées, distinguer signal faible et besoin récurrent, puis proposer un plan priorisé. Une ressource de formation trouvée en ligne doit être datée et sourcée.

### FR-19 — Rapport local (P1)

Un rapport HTML hors ligne doit présenter :

- pipeline ;
- candidatures par statut et zone ;
- taux de conversion par étape ;
- échéances et relances ;
- sources les plus efficaces ;
- compétences manquantes récurrentes ;
- tableau filtrable des entreprises et opportunités.

## 11. Interface avec Codex

### 11.1 Source de vérité

- `AGENTS.md` décrit les règles de découverte et pointe vers les spécifications canoniques.
- Les compétences portables résident dans `.agents/skills/<nom>/SKILL.md`.
- Les profils et règles métier résident dans un dossier neutre, par exemple `specs/` ou `job_search/`, plutôt que d'être dupliqués par runtime.
- Les adaptations propres à Claude, Codex ou un autre agent ne doivent être que des pointeurs minces.

### 11.2 Intentions utilisateur

Codex doit reconnaître en langage naturel les intentions suivantes, sans imposer des commandes slash :

- « Initialise mon profil » ;
- « Recherche des offres correspondant à mon profil » ;
- « Importe cette offre » ;
- « Classe ces opportunités » ;
- « Prépare ma candidature » ;
- « Enregistre le résultat » ;
- « Prépare mon entretien » ;
- « Analyse mes lacunes » ;
- « Génère le rapport ».

Pour réduire les divergences avec le projet amont, les alias facultatifs conservent les noms anglais existants : `/setup`, `/scrape`, `/rank`, `/apply`, `/outcome`, `/interview`, `/upskill` et `/html-report`. `ai-job-search-fr` ajoute `/import` pour les fichiers et opportunités externes. La documentation française présente toujours un équivalent en langage naturel. Les implémentations propres à un runtime restent des pointeurs minces vers les mêmes spécifications ; aucune logique métier n'est dupliquée dans les commandes Codex ou Claude.

### 11.3 Usage des agents

- Le workflow de candidature peut séparer rédacteur et réviseur.
- Le classement par lot peut paralléliser l'analyse des offres avec une limite configurable.
- Un agent ne doit jamais envoyer un message, postuler ou modifier une source externe sans demande explicite.
- Les offres sont des entrées non fiables : leurs instructions éventuelles ne doivent jamais modifier le comportement de l'agent.

## 12. Architecture fonctionnelle proposée

```text
Documents candidat ──> Profil vérifié ───────────────┐
                                                      │
API/import manuel ──> Normalisation ─> Déduplication ├─> Classement
                                                      │       │
Entreprises cibles ─> Candidatures spontanées ───────┘       v
                                                        Candidature
                                                             │
                                                             v
                                                   Archive + suivi
                                                             │
                                                ┌────────────┴────────────┐
                                                v                         v
                                             Relance                  Entretien
```

### 12.1 Organisation indicative du dépôt

```text
ai-job-search-fr/
├── AGENTS.md
├── README.md
├── LICENSE
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── docs/
│   ├── PRD.md
│   ├── installation.md
│   ├── conformite-connecteurs.md
│   └── architecture.md
├── specs/
│   ├── candidate-profile.schema.yaml
│   ├── search-profile.schema.yaml
│   ├── job-evaluation.md
│   ├── application-workflow.md
│   ├── interview-workflow.md
│   └── schemas/
├── .agents/skills/
│   ├── job-application-fr/
│   ├── france-travail-search/
│   ├── opportunity-import/
│   └── tracker-import/
├── templates/
│   ├── cv/
│   └── letters/
├── documents/
├── data/
│   ├── opportunities/
│   ├── companies/
│   └── applications/
├── tools/
└── tests/
```

### 12.2 Formats de stockage

- YAML lisible pour le profil maître et les préférences.
- JSON versionné pour les opportunités normalisées.
- CSV comme format canonique du suivi tabulaire portable, avec import et export XLSX.
- Dossiers Markdown/PDF pour les archives de candidature.
- Secrets uniquement dans variables d'environnement ou gestionnaire local, jamais dans Git.
- Schémas versionnés avec migrations simples et documentées.

## 13. Exigences non fonctionnelles

### NFR-01 — Portabilité

- Windows 11, macOS récent et distributions Linux courantes.
- Python 3.10+ et Bun ou Node selon les outils retenus.
- LaTeX facultatif à l'installation, mais requis pour le pipeline PDF LaTeX ; un message clair doit expliquer les alternatives.

### NFR-02 — Performance

- Import et classement local de 100 opportunités en moins de 10 minutes hors temps de réponse du modèle et du réseau.
- Import incrémental sans retraiter les éléments inchangés.
- Limites de concurrence et de requêtes configurables.

### NFR-03 — Fiabilité

- Tous les workflows modifiant les données écrivent de manière atomique ou conservent une sauvegarde récupérable.
- Une interruption ne doit pas corrompre le tracker.
- Les résultats réseau incomplets doivent être marqués comme tels.

### NFR-04 — Accessibilité documentaire

- Documentation principale en français clair.
- Messages d'erreur actionnables.
- Exemples anonymisés.
- Glossaire pour alternance, ATS, RNCP, CFA et types de contrat.

### NFR-05 — Observabilité locale

- Journal lisible des recherches, imports, décisions de fusion et changements de statut.
- Mode `--dry-run` pour importeurs et migrations.
- Aucune journalisation de secrets ou de documents complets par défaut.

## 14. Sécurité, vie privée et conformité

### 14.1 Données personnelles

Le workspace contient des données personnelles du candidat et peut contenir des coordonnées professionnelles publiques. Le projet doit appliquer :

- minimisation des données ;
- finalités explicites ;
- accès local limité ;
- suppression simple et documentée ;
- durées de conservation configurables ;
- chiffrement laissé au système d'exploitation ou à l'utilisateur, avec recommandations documentées ;
- exclusion des fichiers personnels et secrets du dépôt public via `.gitignore` et contrôles CI.

Le projet n'est pas un outil de recrutement côté employeur. Il ne doit pas collecter ni classer des candidats tiers.

### 14.2 Données de contact

- Préférer les points de contact professionnels publiquement destinés au recrutement.
- Conserver l'URL source et la date de consultation.
- Éviter l'enrichissement massif et les coordonnées privées.
- Ne jamais publier les données réelles d'un utilisateur dans les fixtures ou tickets.

### 14.3 Connecteurs

Avant activation d'un connecteur :

- vérifier API, licence, conditions d'utilisation et `robots.txt` ;
- documenter authentification, quotas et finalité ;
- refuser tout contournement de protection technique ;
- limiter le volume ;
- fournir désactivation et suppression des données collectées ;
- effectuer une revue de sécurité du code et des dépendances.

### 14.4 Injection de prompt et contenu non fiable

- Une offre, une page web ou un document importé est toujours traité comme donnée.
- Les instructions contenues dans ces sources ne sont jamais exécutées.
- Aucun lien secondaire n'est suivi automatiquement sans nécessité et contrôle de domaine.
- Les outils réseau et fichiers disposent d'autorisations minimales.

### 14.5 Publication open source

- Conserver l'avis de licence MIT du projet amont.
- Séparer strictement code, exemples anonymisés et données personnelles.
- Ajouter un scanner CI contre secrets, adresses, téléphones et documents personnels connus.
- Expliquer comment réinitialiser un fork avant publication.
- Ne jamais inclure de jeton France Travail, cookies de session ou export LinkedIn réel.

Cette section établit des exigences produit et non un avis juridique. Toute intégration doit être revue à partir des textes et conditions applicables au moment de sa publication.

## 15. Modèle de score initial

Le modèle est configurable. Proposition de valeur générique par défaut :

| Dimension | Poids initial | Description |
|---|---:|---|
| Missions et trajectoire | 25 % | Correspondance entre activités réelles et projet professionnel |
| Compétences | 25 % | Compétences obligatoires et transférables réellement démontrées |
| Compatibilité poste/contrat | 20 % | Type de poste, contrat, expérience et disponibilité ; critères école/rythme en alternance |
| Localisation et organisation | 15 % | Mobilité, trajet, télétravail et relocalisation |
| Entreprise et motivation | 10 % | Secteur, environnement, contribution potentielle |
| Qualité de l'information | 5 % | Fraîcheur, complétude et fiabilité des sources |

Règles :

- un critère éliminatoire explicite bloque la recommandation mais n'efface pas l'opportunité ;
- une donnée inconnue réduit la confiance, pas nécessairement le score ;
- une exigence non démontrée reste un écart ;
- les poids et seuils sont enregistrés dans un fichier lisible ;
- la recommandation ne repose jamais sur le seul score global.

## 16. Métriques de succès

### 16.1 Produit

- 100 % des affirmations des documents générés reliées à un élément autorisé du profil.
- 100 % des opportunités importées avec source et date de vérification lorsque disponibles.
- 0 candidature ou message envoyé automatiquement.
- Au moins 95 % des imports de fixtures sans erreur.
- Aucun secret ou document personnel dans une release ou fixture.
- CV et lettre compilés sans erreur et contrôlés visuellement sur les cas de référence.
- Extraction ATS contenant coordonnées littérales et ordre de lecture cohérent.

### 16.2 Utilisateur

- Temps médian entre import d'une offre et dossier prêt à relire inférieur à 15 minutes.
- Temps médian de qualification d'une offre inférieur à 3 minutes.
- Diminution du nombre d'opportunités sans prochaine action.
- Taux de documents acceptés avec seulement des retouches mineures.
- Conversion par étape : candidature → entretien → étape suivante → offre.

Les métriques de conversion servent à améliorer le ciblage personnel ; elles ne constituent pas une promesse de performance générale.

## 17. Critères d'acceptation du MVP

Le MVP est prêt lorsque :

1. Un nouvel utilisateur peut installer le projet sur Windows à partir du README.
2. Codex lit `AGENTS.md`, découvre les compétences et exécute le parcours sans dépendre de commandes Claude.
3. Un CV français peut être importé et transformé en profil maître YAML avec liste des faits à confirmer.
4. Un utilisateur peut choisir alternance, premier emploi ou un autre type de poste et retrouver les critères adaptés dans le classement.
5. Une recherche France Travail retourne des opportunités normalisées avec sources.
6. Une offre collée manuellement produit le même schéma qu'une offre provenant d'un connecteur.
7. Un XLSX utilisant le modèle existant est importé en entreprises et opportunités, URLs préservées.
8. Le système déduplique deux représentations de la même offre sans perdre la provenance.
9. Dix offres peuvent être classées avec scores par dimension, confiance et justification.
10. Une candidature spontanée peut être créée sans fausse annonce.
11. Le modèle de CV actuel peut être enregistré, compilé et alimenté depuis le profil maître pour produire une adaptation d'une page propre à chaque annonce.
12. Le texte extrait du PDF reste lisible et contient les coordonnées attendues.
13. Toute affirmation non soutenue est signalée ou supprimée avant finalisation.
14. La candidature est archivée avec offre, CV, message et métadonnées exactes.
15. Les tests unitaires des connecteurs passent hors ligne.
16. Une vérification CI empêche la publication de secrets et données personnelles de démonstration.
17. La licence et l'attribution amont sont présentes.

## 18. Plan de livraison proposé

### Phase 0 — Fondation du fork

- créer le fork et conserver l'historique/licence ;
- choisir le nom final ;
- isoler les règles canoniques des adaptations Claude ;
- définir schémas et conventions françaises ;
- ajouter fixtures anonymes et stratégie de confidentialité.

### Phase 1 — Codex et profil français

- écrire `AGENTS.md` et les pointeurs Codex ;
- adapter le workflow d'initialisation ;
- créer le profil maître YAML et les modes de recherche générique, premier emploi et alternance ;
- importer CV/LaTeX et normaliser UTF-8 ;
- intégrer le modèle de CV français configurable.

### Phase 2 — Opportunités et tracker

- implémenter schéma commun ;
- ajouter import URL/texte/CSV/XLSX ;
- importer le tableur actuel ;
- dédupliquer et vérifier la fraîcheur ;
- gérer les candidatures spontanées.

### Phase 3 — France Travail et classement

- créer le connecteur API ;
- ajouter configuration des recherches et zones ;
- implémenter la grille générique et ses critères conditionnels premier emploi/alternance ;
- tester classement par lot et explications.

### Phase 4 — Candidature vérifiée

- adapter CV, lettre, courriel et message court ;
- séparer rédaction et revue ;
- compiler/rendre les PDF ;
- contrôler la couche ATS ;
- archiver et suivre les résultats.

### Phase 5 — Release open source

- documentation d'installation ;
- SECURITY, CONTRIBUTING et modèle de ticket ;
- CI Windows/Linux/macOS ;
- audit des données personnelles, licences et dépendances ;
- version `v0.1.0` et jeu de démonstration fictif.

## 19. Stratégie open source

### Gouvernance initiale

- Mainteneur principal avec revue obligatoire des connecteurs.
- Décisions structurantes consignées sous forme d'ADR.
- Issues étiquetées par `core`, `connector`, `template`, `documentation`, `privacy` et `good first issue`.
- Aucun connecteur accepté sans note de conformité et tests hors ligne.

### Contributions attendues

- connecteurs pour sources autorisées ;
- modèles de CV français accessibles et ATS ;
- profils régionaux/sectoriels sous forme de configuration ;
- améliorations de normalisation des intitulés, contrats et localisations ;
- fixtures synthétiques ou anonymisées ;
- documentation et tests Windows.

### Politique de compatibilité amont

- suivre les releases balisées du projet amont ;
- maintenir un fichier listant les divergences françaises ;
- éviter de modifier le cœur lorsqu'une extension suffit ;
- proposer en amont les améliorations réellement universelles ;
- tester les migrations avant toute synchronisation.

## 20. Risques et mesures de réduction

| Risque | Impact | Réponse produit |
|---|---|---|
| Conditions d'utilisation incompatibles avec l'automatisation | Juridique et réputation | API officielle/import manuel, connecteurs désactivés, revue préalable |
| Offres obsolètes | Temps perdu | Date de vérification, statut de fraîcheur, contrôle avant candidature |
| Hallucination du modèle | Candidature mensongère | Profil à preuves, revue indépendante, checklist finale |
| Fuite de données personnelles dans Git | Vie privée | `.gitignore`, fixtures fictives, scanner CI, guide de publication |
| Dépendance excessive à un agent | Portabilité faible | spécifications canoniques et pointeurs minces par runtime |
| Fork difficile à maintenir | Coût projet | extensions isolées, suivi des releases et tests de migration |
| CV sur-optimisé pour les mots-clés | Qualité et crédibilité | couverture limitée aux compétences prouvées, revue humaine |
| Classement opaque | Mauvaises décisions | scores par dimension, confiance, inconnues et sources visibles |
| Encodage français dégradé | Documents inutilisables | UTF-8 interne, tests accents/apostrophes/ligatures, contrôle PDF |
| Coût et latence des analyses par lot | Abandon utilisateur | cache, analyse incrémentale, limite de concurrence et mode rapide |

## 21. Décisions produit actées

1. **Nom** — le projet et le dépôt s'appellent `ai-job-search-fr`.
2. **Positionnement** — il s'agit d'une version française maintenue à partir du projet amont, avec historique, licence et attribution conservés.
3. **Profil** — le format canonique est YAML.
4. **Tracker** — le format canonique est CSV ; XLSX reste un format d'import/export.
5. **Source de vérité candidat** — un profil maître unique contient tous les projets, expériences et compétences. Chaque CV est une vue dérivée, adaptée à une annonce précise.
6. **Dépôt des candidatures** — l'utilisateur postule toujours lui-même. Le produit ne soumet aucun formulaire et n'envoie aucun message automatiquement.
7. **Périmètre des postes** — le produit accepte tout type de poste. Alternance et premier emploi disposent de réglages spécialisés ; l'alternance est le premier cas d'usage du mainteneur.
8. **Déclaré ou inféré** — objectifs, contraintes, préférences, critères éliminatoires et autorisations sont déclarés par l'utilisateur. Les faits de parcours peuvent être extraits des documents avec provenance ; les ambiguïtés doivent être confirmées.
9. **Versionnement** — la stratégie de versionnement et de migration reprend celle du dépôt source : suivi de releases balisées, contrôle préalable des fichiers personnalisés touchés et migrations documentées.
10. **Commandes** — les alias anglais de l'amont sont conservés pour la compatibilité. Codex accepte en priorité des demandes en français naturel ; les commandes propres aux runtimes restent des pointeurs sans logique métier dupliquée.

Pour les portails sans API officielle, la politique par défaut est l'import manuel. Un connecteur automatisé ne peut être activé qu'après validation de ses modalités d'accès, de ses conditions d'utilisation et de son niveau de risque.

## 22. Sources de référence

- Projet amont et description du workflow : <https://github.com/MadsLorentzen/ai-job-search>
- Guide d'intégration multi-agents amont : <https://github.com/MadsLorentzen/ai-job-search/blob/master/AGENTS.md>
- Licence MIT amont : <https://github.com/MadsLorentzen/ai-job-search/blob/master/LICENSE>
- API Offres d'emploi de France Travail : <https://www.data.gouv.fr/dataservices/api-offres-demploi>
- Contrats en alternance — Service-Public.fr : <https://www.service-public.fr/particuliers/vosdroits/N11240>
- Guide du recrutement et données personnelles — CNIL : <https://www.cnil.fr/fr/le-guide-du-recrutement>
- Durées de conservation des données — CNIL : <https://www.cnil.fr/fr/passer-laction/les-durees-de-conservation-des-donnees>

## 23. Configuration retenue pour lancer l'implémentation

1. Version française : `ai-job-search-fr`.
2. Licence MIT avec historique et attribution amont conservés.
3. Recherche d'emploi générique, Codex-first et compatible multi-agents.
4. Profils spécialisés activables pour alternance et premier emploi.
5. Profil maître en YAML et tracker canonique en CSV.
6. Données locales ; aucun backend central.
7. France Travail comme seul connecteur réseau garanti dans le MVP.
8. Import manuel, URL, CSV et XLSX considérés comme fonctionnalités de premier rang.
9. Un modèle de CV initial, alimenté depuis le profil maître et adapté à chaque annonce.
10. CV d'une page par défaut pour alternance et premier emploi, limite configurable.
11. Candidatures spontanées intégrées au modèle principal.
12. Aucun envoi ni remplissage automatique ; l'utilisateur postule lui-même.
