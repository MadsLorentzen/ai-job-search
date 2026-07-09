#!/usr/bin/env bash
set -euo pipefail

docker compose run --rm --user "$(id -u):$(id -g)" latex '
  cd cv
  lualatex -interaction=nonstopmode -halt-on-error main_example.tex
  cd ../cover_letters
  xelatex -interaction=nonstopmode -halt-on-error cover_example.tex
'
