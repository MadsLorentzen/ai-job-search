# Installation Windows, macOS et Linux

Le socle nécessite Python 3.10 ou plus récent. Aucun serveur ni clé API n'est
nécessaire pour les imports manuels, le classement et la génération de brouillons.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m ai_job_search_fr init
python -m ai_job_search_fr --help
```

Sur macOS/Linux, l'activation est `. .venv/bin/activate`.

## Options

- PyYAML rend les fichiers YAML plus agréables; sans lui, le projet écrit du
  JSON valide YAML et le lit sans dépendance.
- `openpyxl` améliore l'import XLSX; un lecteur standard-library est fourni
  pour les feuilles tabulaires simples.
- `pdftotext` (Poppler) ou `pypdf` permet l'extraction PDF. Si aucun n'est
  présent, collez le texte de l'offre/CV manuellement.
- `lualatex`/`xelatex` est nécessaire uniquement pour compiler les modèles
  LaTeX. Une absence de LaTeX ne bloque pas l'import ou le classement.

## Premier parcours

```text
python -m ai_job_search_fr import-documents documents/cv/mon-cv.pdf
python -m ai_job_search_fr import-opportunity --text "..." --output data/opportunities/import.json
python -m ai_job_search_fr deduplicate
python -m ai_job_search_fr rank
python -m ai_job_search_fr html-report --tracker job_search_tracker.csv
```

Le connecteur réseau est explicite : configurez les deux variables France
Travail dans l'environnement local, puis lancez `search-france-travail`. Ne
mettez jamais ces valeurs dans Git.

Le tracker reste canonique en CSV; `export-tracker` produit un XLSX partageable
sans changer la source de vérité.
