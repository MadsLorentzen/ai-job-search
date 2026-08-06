# 🐝 Quickstart — für Ungeduldige

_So einfach, dass ein Fünfjähriger den Wohnungsagenten benutzen kann._

Dieses Repo ist ein Wohnungsagent auf Basis von [Claude Code](https://claude.com/claude-code). Er sucht Wohnungen für dich, prüft ob sie passen, schreibt die Selbstauskunft und das Anschreiben — und du drückst am Ende auf Senden. Nichts geht ohne dich raus.

## Was du brauchst (einmalig einrichten)

| Ding | Warum | Wie |
|---|---|---|
| **Node.js** ≥ 18 | Damit Claude Code läuft | `sudo apt install nodejs npm` (Debian/Ubuntu) oder [nodejs.org](https://nodejs.org) |
| **Claude Code** | Der KI-Kern | `npm install -g @anthropic-ai/claude-code` |
| **Claude-Login** | Damit die KI dich erkennt | Beim ersten `claude`-Start: mit deinem Anthropic-Account (Pro reicht) oder API-Key einloggen |
| **LaTeX** | Damit PDFs aus den Anschreiben werden | Ubuntu: `sudo apt install texlive-full` — ist groß (~5 GB), dafür funktioniert alles |
| **Git + GitHub-Konto** | Um dieses Repo zu holen und Änderungen zu speichern | `sudo apt install git` und dann [github.com](https://github.com) Login |

**Test ob alles da ist:**
```bash
node -v         # sollte v18+ zeigen
claude --version
lualatex --version
git --version
```
Wenn eines fehlt: nachinstallieren, bevor du weitermachst.

## Ablauf in 5 Schritten

### 1️⃣ Repo holen

```bash
cd ~                            # oder wo immer du Projekte magst
git clone https://github.com/domib97/ai-flat-search.git
cd ai-flat-search
```

_Später mal, wenn's Updates gibt: `git pull`._

### 2️⃣ Claude Code starten

```bash
claude
```

Es öffnet sich die Claude-CLI. Beim ersten Mal: einloggen.

### 3️⃣ Profil einrichten mit `/setup`

Tipp im Claude-Fenster ein:

```
/setup
```

Claude fragt dich Dinge über dich (Name, Job/Einkommen, Schufa, Umzugstermin, warum du nach Köln willst). **Wichtig:** ehrlich antworten — die Angaben landen später in deinem echten Anschreiben. Erfundene Sachen fliegen bei Vermietern schneller auf, als du gucken kannst.

Wenn du Belege (Gehaltsnachweis, Arbeitgeberbescheinigung, Schufa, alte Anschreiben) schon im Ordner `documents/` liegen hast, sagst du "Pfad A" und Claude liest die selbst.

**Ergebnis:** Alle Profil-Dateien (`CLAUDE.md`, `01-renter-profile.md`, etc.) sind mit deinen Daten gefüllt.

### 4️⃣ Wohnungen suchen (Dry-Run) mit `/scrape`

```
/scrape
```

Claude durchsucht Kleinanzeigen, WG-gesucht und Immowelt nach:
- **Köln rechtsrheinisch** (Mülheim / Kalk / Porz — siehe [`search-criteria.md`](.claude/skills/flat-scraper/search-criteria.md))
- **max. 1.200 € Warmmiete**
- **mit Balkon / Loggia / Dachterrasse**
- Filtert automatisch **Tauschwohnungen, Zwischenmieten, WBS-Pflicht, Gesuche und Scam-Signale** raus

Am Ende bekommst du eine sortierte Liste: 🟢 Top-Match, 🟡 mittel, 🔴 nicht passend. **Es wird nichts verschickt.** Du entscheidest, welches Angebot dich interessiert.

Möchtest du nur einen bestimmten Bezirk absuchen?
```
/scrape mülheim
/scrape kalk
/scrape porz
/scrape wg          # nur WG-Zimmer
```

### 5️⃣ Bewerbung vorbereiten mit `/apply`

Du hast ein Top-Match gefunden? Kopier die URL (oder wenn ImmoScout blockt: den Anzeigentext) und:

```
/apply https://www.kleinanzeigen.de/s-anzeige/...
```

oder

```
/apply
```
und dann den Anzeigentext reinkopieren.

Claude macht jetzt:
1. **Fit-Check** — passt Preis, Größe, Lage, Balkon?
2. **Scam-Check** — Vorkasse verlangt? "Vermieter im Ausland"? Auffällig günstig? → Warnung
3. **Selbstauskunft** — als LaTeX-Datei in `selbstauskunft/`
4. **Anschreiben** — als LaTeX-Datei in `anschreiben/`, mit mindestens einem konkreten Detail aus DIESER Anzeige (kein Copy-Paste-Text!)
5. **Review** — ein zweiter KI-Agent prüft beide Dokumente auf Fehler, Scam-Signale, generische Phrasen
6. **PDFs** — beide werden kompiliert, du kannst sie lesen und dann verschicken

**Du versendest selbst.** Über die Plattform, per Mail, wie in der Anzeige gewünscht.

## Häufige Stolperfallen

| Problem | Lösung |
|---|---|
| **"ImmoScout24 fetch fehlgeschlagen"** | Erwartet. Cloudflare blockt. Anzeigentext direkt reinkopieren. |
| **"LaTeX Error: File `fontspec.sty' not found"** | `sudo apt install texlive-luatex texlive-xetex texlive-fonts-extra` |
| **Anschreiben ist 2 Seiten lang** | Claude sieht das im Verify-Schritt und iteriert automatisch. Wenn nicht: `/apply` nochmal mit dem Hinweis "muss auf 1 Seite passen". |
| **Ich will die Konfig ändern** (andere Stadt, anderes Budget) | Sag es einfach beim `/setup` oder edit `CLAUDE.md` + `.claude/skills/flat-scraper/search-criteria.md` direkt. |
| **Ich brauche einen WBS-Filter aus** | In `search-criteria.md` unter "Exclude: WBS-Pflicht" die Regel auskommentieren. |

## Anders als andere Wohnungs-Bots

- **Nix wird auto-verschickt.** Das ist kein Spam-Bot — du bleibst der letzte Mensch in der Schleife.
- **Kein Anti-Bot-Umgehen.** ImmoScout Cloudflare wird nicht ausgetrickst; wenn's blockt, kopierst du halt Text.
- **Jedes Anschreiben nennt ein Detail aus DIESER Anzeige.** Der größte Fehler bei Miet-Anfragen ist der Copy-Paste-Text, der bei 100+ Anfragen untergeht. Diese Regel ist hart eingebaut.
- **Scam-Erkennung serienmäßig.** Vorkasse-Betrug, "Landlord ist im Ausland", verdächtig günstige Preise — automatischer Check.

## Weiterlesen

- [`README.md`](README.md) — Übersicht, Architektur
- [`SETUP.md`](SETUP.md) — Detaillierte Installation, LaTeX-Troubleshooting
- [`CLAUDE.md`](CLAUDE.md) — Dein persönliches Profil (wird beim `/setup` gefüllt)
- [`.claude/skills/flat-scraper/search-criteria.md`](.claude/skills/flat-scraper/search-criteria.md) — Suchkriterien für `/scrape`

---

_Fragen? Repo-Owner: [@domib97](https://github.com/domib97) · Basis-Fork: [Mads Lorentzen — ai-job-search](https://github.com/MadsLorentzen/ai-job-search)_
