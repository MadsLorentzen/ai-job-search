# Setup Guide

Step-by-step instructions for getting the AI Flat Search framework running.

## 1. Prerequisites

### Claude Code

Install Claude Code (Anthropic's CLI for Claude):

```bash
npm install -g @anthropic-ai/claude-code
```

You'll need an Anthropic API key or a Claude Pro/Team subscription. See the [Claude Code docs](https://docs.anthropic.com/en/docs/claude-code) for details.

### LaTeX (for compiling the Selbstauskunft and Anschreiben)

Install a LaTeX distribution to compile the generated `.tex` files to PDF:

- **Windows:** [MiKTeX](https://miktex.org/download)
- **macOS:** [MacTeX](https://tug.org/mactex/)
- **Linux:** `sudo apt install texlive-full` or `sudo dnf install texlive-scheme-full`

The Selbstauskunft compiles with `lualatex`. The Anschreiben compiles with `xelatex` because `cover.cls` requires `fontspec` for its custom Lato/Raleway fonts.

## 2. Run the setup interview

Start Claude Code in the repository:

```bash
claude
```

Then run the onboarding:

```
/setup
```

Claude will offer three paths:

- **Path A (recommended if you have documents):** Point it at your `documents/` folder (income proof, employer letter, Schufa, landlord references).
- **Path B:** Paste your income, employer, and household details directly in chat.
- **Path C:** Answer structured interview questions section by section.

All three paths produce the same result: fully populated profile files.

### What gets populated

| File | Content |
|------|---------|
| `CLAUDE.md` | Your full renter profile |
| `01-renter-profile.md` | Structured identity, household, income, search profile |
| `02-tenant-profile.md` | Tenant persona and selling points |
| `04-flat-evaluation.md` | Your commute tolerance, filled into the scoring framework |
| `selbstauskunft/selbstauskunft_example.tex` | Your LaTeX Mieterselbstauskunft with actual details |
| `search-criteria.md` | Listing search criteria for `/scrape` |

### What's already pre-filled

This fork ships pre-configured for a specific search:
- **Target areas:** Köln rechtsrheinisch — Stadtbezirke Mülheim (9) / Kalk (8) / Porz (7); PLZ-Whitelist im Skill
- **Budget:** 1.200 € Warmmiete (all-in)
- **Must-have:** Balkon / Loggia / Dachterrasse
- **Workplace:** — (aktuell zwischen Jobs; ÖPNV-Anschluss Köln Hbf ist ein Plus)
- **Search cascade:** (1) eigene Wohnung → (2) WG (max 3–4 Mitbewohner) → (3) Hausgemeinschaft / Cohousing
- **Portal priority:** Kleinanzeigen + WG-Gesucht primary, Immowelt secondary, ImmoScout24 best-effort only

`/setup` confirms these with you rather than re-deriving them from scratch. If you're repointing this fork at a different city, budget, or workplace, say so during setup and it'll update `CLAUDE.md` and `search-criteria.md` accordingly.

### Re-running setup

You can update specific sections later:

```
/setup --section search
```

Useful as your budget, commute tolerance, or must-haves change.

## 3. Test the workflow

Find a listing you're interested in, then:

```
/apply https://www.kleinanzeigen.de/s-anzeige/...
```

Or paste the listing text directly:

```
/apply [paste listing text here]
```

Claude will:
1. Evaluate the fit against your profile and check for scam red flags
2. Ask if you want to proceed
3. Draft a Selbstauskunft and Anschreiben
4. Have a reviewer agent check listing-detail accuracy and tone
5. Revise and present the final PDFs

**Nothing is sent automatically.** You review the PDFs and send the inquiry yourself, through whatever channel the listing specifies.

## 4. Compile your documents

After `/apply` creates the LaTeX files:

```bash
# Compile Selbstauskunft
cd selbstauskunft && lualatex selbstauskunft_<address-slug>.tex && cd ..

# Compile Anschreiben
cd anschreiben && xelatex anschreiben_<address-slug>.tex && cd ..
```

## 5. Optional: recurring searches

Listings in Köln rechtsrheinisch (Mülheim/Kalk/Porz) in this price range can disappear within hours — vor allem Angebote von Privat und Nachmieter-Deals. If you want `/scrape` to run on a timer rather than only on demand, use Claude Code's `/schedule` or `/loop` skills to re-invoke it periodically (e.g. every 30–60 minutes). This is opt-in and not configured by default — set it up explicitly if you want it.

## Troubleshooting

### Listing URL won't fetch (especially ImmoScout24)
Expected for portals with strong anti-bot protection. Paste the listing text directly instead of the URL; the workflow does not attempt to bypass anti-bot measures.

### LaTeX compilation errors
- Selbstauskunft: uses `lualatex`
- Anschreiben: uses `xelatex` (for custom fonts in `anschreiben/OpenFonts/fonts/`)
- Make sure your LaTeX distribution includes `fontspec`, `babel`, and `enumitem`

### Fonts not found in the Anschreiben
The Anschreiben template expects fonts in `anschreiben/OpenFonts/fonts/`. Make sure this directory exists and contains the Lato and Raleway font files.

### A listing looks like a scam
Stop and check it against the red flags in `.claude/skills/flat-application-assistant/07-besichtigung-prep.md` before doing anything else - or just ask Claude "is this listing a scam?" and it will check directly.
