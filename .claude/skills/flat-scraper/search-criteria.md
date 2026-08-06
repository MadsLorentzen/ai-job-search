# Search Criteria for Flat Scraper

<!-- Konfiguriert für: Köln rechtsrheinisch (Mülheim / Kalk / Porz), max 1.200 € Warmmiete, Balkon Pflicht -->

## Portals

**Primary** (search first, every run):
- **kleinanzeigen.de** — schwächster Anti-Bot-Schutz, breite Streuung inkl. privater Vermieter
- **wg-gesucht.de** — beste Quelle für WG-Zimmer UND kleine 1-Zi-Wohnungen; gerade wichtig, weil WG jetzt Teil der Kaskade ist

**Secondary** (search if time/budget allows):
- **immowelt.de** — anständige Makler-Coverage
- **inberlin.de / kalaydo.de** — regionales Aachen/Rheinland-Portal, hat auch Köln-Angebote, oft unter dem Radar

**Best-effort only** (do not retry aggressively if blocked):
- **immoscout24.de** — größtes Portal, stärkstes Cloudflare; Fehlschläge sind erwartbar, nicht umgehen

## Query Categories

Jede Query kombiniert Portal-Filter + Ort/Veedel + Preisdeckel (soweit die Portalsuche das unterstützt). Immer explizit rechtsrheinische Veedel benennen — "Köln" allein liefert zu viel linksrheinisches Rauschen.

### Priority 1: Mülheim (Bezirk 9) — urban, gut angebunden, im Trend

```
site:kleinanzeigen.de Wohnung Köln-Mülheim OR Buchforst OR Buchheim OR Holweide OR Dellbrück Miete
site:wg-gesucht.de Köln Mülheim OR Buchforst OR Buchheim OR Holweide OR Dellbrück
site:immowelt.de Wohnung Köln Mülheim miete
```

Veedel im Bezirk: Mülheim, Buchforst, Buchheim, Holweide, Dellbrück, Höhenhaus, Dünnwald, Stammheim, Flittard.

### Priority 2: Kalk (Bezirk 8) — günstiger, mehrsprachig, aufstrebend

```
site:kleinanzeigen.de Wohnung Köln-Kalk OR Humboldt-Gremberg OR Vingst OR Höhenberg OR Ostheim OR Merheim Miete
site:wg-gesucht.de Köln Kalk OR Humboldt OR Vingst OR Höhenberg OR Ostheim OR Merheim
site:immowelt.de Wohnung Köln Kalk miete
```

Veedel im Bezirk: Kalk, Humboldt-Gremberg, Vingst, Höhenberg, Ostheim, Merheim, Neubrand, Rath/Heumar.

### Priority 3: Porz (Bezirk 7) — stadtauswärts, größere Flächen möglich

```
site:kleinanzeigen.de Wohnung Köln-Porz OR Ensen OR Westhoven OR Poll OR Zündorf Miete
site:wg-gesucht.de Köln Porz OR Ensen OR Westhoven OR Poll OR Zündorf
site:immowelt.de Wohnung Köln Porz miete
```

⚠️ **Fluglärm-Filter für Porz:** Wahn, Grengel, Libur, Lind, Elsdorf-Süd sind im direkten Einflug-Korridor Flughafen Köln/Bonn — als Deal-Breaker markieren, nicht in Priority-3-Queries aufnehmen.

Veedel im Bezirk (rein-nehmen): Porz-Zentrum, Ensen, Westhoven, Poll, Zündorf, Urbach, Eil, Gremberghoven. (Rausnehmen wg. Fluglärm: Wahn, Grengel, Libur, Lind.)

### Priority 4: WG-spezifisch (für die Kaskaden-Stufe 2)

```
site:wg-gesucht.de WG-Zimmer Köln Mülheim OR Kalk OR Buchforst OR Ehrenfeld  # Ehrenfeld ist linksrheinisch, aber grenznah zu Mülheim — nur wenn Zusatz-Wunsch
site:kleinanzeigen.de WG-Zimmer Köln rechtsrheinisch
```

Max Mitbewohner: **4 Personen insgesamt** (also 3 WG-Partner + Dom). Alles größer verwerfen.

## Budget Filter

- **Hard ceiling: 1.200 € Warmmiete** (all-in, inkl. Heiz-/Nebenkosten)
- Für WG-Zimmer: derselbe Deckel, aber realistisch werden Zimmer meist 400–650 € liegen — Angebote unter 350 € doppelt auf Scam-Signale prüfen (siehe scam-check-Skill)
- Nur Kaltmiete gelistet → Warmmiete schätzen als Kalt + Nebenkosten (angegeben), sonst + ~2,50 €/m². Schätzung immer als Schätzung ausweisen.
- Angebote knapp über Budget dürfen als "Medium/Low match — over budget" auftauchen, wenn Lage/Balkon/Größe außergewöhnlich sind. Aber niemals stillschweigend als Treffer verbuchen.

## Location Filter — der wichtigste Filter

**PLZ-Whitelist (harter Filter):**

| Bezirk | PLZ |
|---|---|
| Mülheim | 51063, 51065, 51067, 51069 |
| Buchforst / Buchheim | 51065 |
| Holweide / Dellbrück / Höhenhaus / Dünnwald / Stammheim / Flittard | 51067, 51069, 51061 |
| Kalk / Humboldt-Gremberg / Vingst / Höhenberg / Ostheim / Merheim / Rath | 51103, 51105, 51107, 51109 |
| Porz (Zentrum + rein-nehmbare Veedel) | 51143, 51145, 51147, 51149 |
| Poll (offiziell Porz, aber grenznah Deutz) | 50735 |

Alles außerhalb dieser PLZ = **nicht anzeigen** (auch wenn Titel "Köln" enthält — der Titel lügt oft).

**BBox (für Overpass/Map-Queries):** ungefähr `50.83, 6.97, 51.05, 7.15` (Süd-West-Ecke ↔ Nord-Ost-Ecke) — deckt alle drei Bezirke ab und schneidet Linksrheinisch weg.

**Fluglärm-Ausschluss (Porz-Süd):** Listings in 51147/51149 mit Adresse in Wahn, Grengel, Libur, Lind, Elsdorf → Warnung setzen, nur zeigen wenn Wohnung Schallschutzfenster explizit nennt.

## Must-have Filter

- **Balkon / Loggia / Dachterrasse** — Pflicht. Listings ohne Balkon-Erwähnung: Warnung setzen, aber nicht auto-verwerfen (Immo-Inserate lassen das gerne weg — im Zweifel im Anschreiben nachfragen). Explizit "kein Balkon" / "ohne Balkon" → verwerfen.
- Unbefristet, unfurnished bzw. maximal EBK-teilmöbliert (siehe Zwischenmiete-Ausschluss unten).

## Exclude: Tauschwohnungen (Wohnungs-Swap)

Auf Kleinanzeigen sind **~60 % der Kölner Miet-Treffer eigentlich Tauschangebote**, keine regulären Anmietungen. Immer verwerfen, wenn der Titel oder erste Beschreibungszeile eines der folgenden Signale enthält:

- `TAUSCHWOHNUNG` (häufigstes Präfix bei Kleinanzeigen)
- `Wohnungsswap` / `Wohnungstausch` / `zum Tausch` / `gegen … tauschen`
- "Es handelt es sich hierbei um ein Tauschangebot" / "handelt sich hierbei um ein Tauschangebot" (Standardformel)
- `(Anbieter-ID: …)` in Kombination mit den obigen Wortlauten

Ausnahme: Wenn die Kachel explizit auch als **reguläre Anmietung** angeboten wird ("Tauschwohnung oder Direktmiete möglich") und Preis + Kaltmiete klar genannt sind, darf sie übernommen werden — aber mit `swap-fallback` markieren.

## Exclude: WBS-Pflicht (ohne WBS im Dom-Profil)

Listings mit **`WBS erforderlich`** / **`WBS 60+`** / **`Wohnberechtigungsschein nötig`** verwerfen, solange Dom keinen WBS hat. Wenn `01-renter-profile.md` später einen WBS einträgt: Regel deaktivieren.

## Exclude: Gesuche (der Anbieter sucht, bietet nicht)

In den Portalen tauchen "Gesuch"-Anzeigen gemischt mit Angeboten auf. Verwerfen wenn:

- Kategorie/Label `Gesuch`
- Titel: `Suche Wohnung …`, `Suche Nachmieter… gesucht (durch mich)`, `Suche langfristiges Zuhause`, `Suche Mietwohnung… (Belohnung|Prämie)`
- Text-Signal: "zahle eine Prämie von €…0 bei Vermittlung" (der schreibt = will Vermittlung, ist selbst Suchender)

## Exclude: Furnished Short-Term Sublets (Zwischenmiete)

Dom will unbefristet wohnen, nicht Sublet-hoppen. **Skip and never present** Listings die:

- Vollmöbliert sind — "voll möbliert" / "vollständig möbliert" / "komplett möbliert" / "furnished" / "fully-furnished" (ganze Wohnung, nicht nur EBK), ODER
- Ein festes End-Datum haben (z. B. "verfügbar 12.07.–07.09.2026", "available from ... until ...", "Zwischenmiete", "Untermiete", "befristet auf X Monate")

Nur ein Startdatum ("ab 01.09.2026") ist okay — normaler unbefristeter Vertrag. **"Teilmöbliert" ist KEIN Ausschlussgrund** — heißt hier meist nur EBK, was sogar willkommen ist. Ausschluss greift nur bei explizitem End-Datum, Zwischenmiete-Wording oder "komplett möbliert".

## Date Filter

Nur Listings der letzten 7 Tage. Portale sind schnell — älter als eine Woche = meist schon weg, selbst wenn noch "aktiv". Wenn kein Datum ermittelbar: aufnehmen, aber flaggen als "Datum unbekannt" und niedriger priorisieren.

## Adapting Queries

Wenn Dom eine Fokus-Region nennt ("/scrape mülheim"), alle Portale nur für die Bezirks-Queries laufen lassen + 2–3 Custom-Queries (bestimmte Straße, bestimmter Veedel). Beispiel:
- "/scrape mülheim" → Priority 1 komplett + jedes Mülheim-Veedel das Dom als bevorzugt genannt hat (z. B. Buchforst, Buchheim für kurze S-Bahn nach Hbf)
- "/scrape wg" → Priority 4 komplett + kurze Frage: "welcher Bezirk bevorzugt?"

## Dry-Run-Semantik

`/scrape` ist per Definition ein Dry-Run: sucht, dedupliziert, präsentiert Matches mit Fit-Rating. Nichts wird gesendet, keine Anschreiben gebaut. Erst `/apply <URL>` startet den Bewerbungs-Flow — und auch der endet mit "Du versendest selbst".
