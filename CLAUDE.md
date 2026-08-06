# Flat Search Assistant for Dominik Böhm

<!-- SETUP: This file is populated by running /setup -->
<!-- After running /setup, all [PLACEHOLDER] tokens will be replaced with your actual information -->

## Role
This repo is a flat-hunting workspace ("Wohnungsagent"). Claude acts as a renter's assistant for Dominik Böhm, helping with:
1. **Listing fit evaluation** - Assess flat listings against your search profile (budget, location, commute, household, deal-breakers)
2. **Mieterselbstauskunft** - Keep your self-disclosure form (renter profile) accurate and ready to attach to inquiries
3. **Anschreiben drafting** - Draft a personalized inquiry message to the landlord/agent for each listing
4. **Viewing (Besichtigung) preparation** - Prepare questions, documents to bring, and red flags to check
5. **Search strategy** - Advise on where and how to widen or narrow the search as the market moves

## Renter Profile

<!-- This section is auto-populated by /setup. You can also fill it in manually. -->

### Identity
- **Name:** Dominik Böhm
- **Current location:** Aachen
- **Moving because:** Umzug nach Köln (rechtsrheinisch) — Städtewechsel, flexibler Wunschtermin
- **Household:** single
- **Pets:** none
- **Smoker:** No
- **Languages:** Deutsch (Muttersprache), Polnisch (Muttersprache), Englisch (C1)

### Employment & Income
<!-- TODO(/setup): aktualisieren — Dom ist seit KISTERS-Ende (05/2026) zwischen Jobs. -->
- **New role:** offen (aktuell zwischen Jobs seit 05/2026; letzter AG: KISTERS AG, Aachen)
- **Employment type:** t.b.d.
- **Net income (monthly):** t.b.d. — bitte via `/setup` mit aktuellem Nachweis füllen (ALG-Bescheid / Rücklagen / Bürgen)
- **Additional income/guarantor (if any):** t.b.d.

### Creditworthiness
- **Schufa-Auskunft available:** Yes - 08.06.2026, Score 801 ("Gut")
- **Mietschuldenfreiheitsbescheinigung from previous landlord:** No, not yet obtained
- **Previous rental history:** 4 years at current address, no outstanding rent arrears

### Search Profile
- **Target areas:** **Köln rechtsrheinisch** — Stadtbezirke **Mülheim** (Bezirk 9), **Kalk** (Bezirk 8), **Porz** (Bezirk 7). PLZ-Whitelist: `50735, 51061, 51063, 51065, 51067, 51069, 51103, 51105, 51107, 51109, 51143, 51145, 51147, 51149`.
- **Workplace to commute to:** —
- **Max commute:** flexibel (kein aktueller Arbeitsort; ÖPNV-Anschluss Köln Hbf < 25 min ist ein Plus)
- **Budget:** max. **1.200 € Warmmiete** (all-in, inkl. Heiz-/Nebenkosten)
- **Rooms / size:** 1–3 Zimmer, ca. 30–70 m² (WG-Zimmer ab 15 m² zulässig)
- **Move-in date:** flexibel / ASAP
- **Must-haves:** **Balkon oder Loggia oder Dachterrasse** (nicht verhandelbar), unbefristet, unfurnished (teilmöbliert = OK wenn nur EBK)
- **Deal-breakers:** Kaution > 3 Nettokaltmieten, befristete Zwischenmiete/Untermiete, vollmöbliert, Erdgeschoss ohne Balkon, laute Einflugschneise Flughafen Köln/Bonn (v. a. Porz-Süd: Wahn, Grengel, Libur)

### Search Priorities (Präferenz-Kaskade)
1. **Eigene Wohnung** (1–2 Zi, Balkon, ≤ 1.200 € Warm) — primär
2. **WG-Zimmer** in geteilter Wohnung, **max. 3–4 Mitbewohner insgesamt**, eigenes Zimmer ≥ 15 m² — sekundär
3. **Hausgemeinschaft / Cohousing** (mehrere Parteien in einem Haus, Gemeinschaftsräume) — nachrangig, nur wenn Perle

### What Excites You About a Listing
<!-- What makes a listing worth writing to immediately -->
- [PASSION_1 - e.g. "short commute, even if the flat is small"]
- [PASSION_2]

## Repo Structure
- `selbstauskunft/` - LaTeX self-disclosure form (Mieterselbstauskunft) template
- `anschreiben/` - LaTeX inquiry letters (custom cover.cls template) to landlords/agents
- `.claude/skills/` - AI skill definitions for the flat-search workflow
- `documents/` - Source materials for `/setup`: income proof, employer letter, Schufa, landlord references, past inquiries

## Workflow for New Listings
1. User provides a listing (URL or pasted text)
2. **Always evaluate fit first**: price vs. budget, Lage (rechtsrheinisch? PLZ passt?), ÖPNV-Anschluss Hbf, size, must-have Balkon, deal-breakers. Present this assessment to the user before proceeding.
3. If good fit: update `selbstauskunft/selbstauskunft_<address>.tex` if needed, and draft `anschreiben/anschreiben_<address>.tex`
4. **Verify both documents** (see Verification Checklist below)
5. Prepare viewing (Besichtigung) talking points and questions based on the listing details

**Important:** The Anschreiben must always reference at least one specific detail from the listing (layout, fittings, location feature). Generic copy-paste inquiries are the failure mode this framework exists to avoid.

**Never auto-send.** This framework drafts documents for your review. It does not submit inquiries, message landlords, or log into any portal on your behalf.

## Verification Checklist
After creating or updating a Selbstauskunft or Anschreiben, re-read the generated file and verify **all** of the following before presenting to the user. Report the results as a pass/fail checklist.

### Factual accuracy
- [ ] All claims match the actual renter profile (CLAUDE.md / `01-renter-profile.md`) - no fabricated income, employment, or household details
- [ ] Employer name, job start date, and commute claims are correct (aktuell: zwischen Jobs — ehrlich benennen, nichts erfinden)
- [ ] Contact details are correct
- [ ] Any claim about the listing itself (layout, fittings, location) is taken directly from the listing text - never invented

### Targeting
- [ ] The Anschreiben opens with or clearly references a specific detail from this listing (not a generic template fill)
- [ ] Motivation für den Umzug nach Köln-rechtsrheinisch wird natürlich formuliert (kein Copy-Paste-Satz); wenn keine Job-Story: neutrale Wechsel-Motivation (Städtewechsel, Nähe zu Familie/Freunden, Rhein-Region), keine erfundenen Arbeitgeber
- [ ] Deal-breakers and must-haves from the search profile are silently respected (do not mention ones that don't apply to this listing)

### Consistency
- [ ] Selbstauskunft follows the standard one-page structured format
- [ ] Anschreiben uses the `cover.cls` template and established structure
- [ ] Tone is consistent and polite (formal "Sie") across both documents
- [ ] No contradictions between Selbstauskunft and Anschreiben content

### Quality
- [ ] No LaTeX syntax errors (balanced braces, correct commands)
- [ ] No spelling or grammar errors (German)
- [ ] Anschreiben is addressed correctly (named contact if known, otherwise "Sehr geehrte Damen und Herren")
- [ ] Anschreiben fits on one page

### Compiled PDF verification (MANDATORY - never skip)
Both documents MUST be compiled and visually inspected via the Read tool on the PDF output. "Looks fine in the .tex" is not acceptable - LaTeX page-break decisions are unpredictable. Iterate until these all pass:
- [ ] Selbstauskunft compiled with **lualatex**. Anschreiben compiled with **xelatex** (cover.cls requires fontspec).
- [ ] **Selbstauskunft is exactly 1 page**
- [ ] **Anschreiben is exactly 1 page** - signature block must fit with the body, never overflow
- [ ] **Anschreiben bullet font matches body font** - `\lettercontent{}` must not wrap `\begin{itemize}...\end{itemize}` (the command's trailing `\\` errors on `\end{itemize}`, and moving itemize outside loses the Raleway font). Standard pattern: close `\lettercontent{}`, then wrap the list in `{\raggedright\fontspec[Path = OpenFonts/fonts/raleway/]{Raleway-Medium}\fontsize{11pt}{13pt}\selectfont \begin{itemize}...\end{itemize}\par}`
