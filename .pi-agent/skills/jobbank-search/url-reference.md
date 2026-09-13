# Jobbank.dk URL Reference

Complete reference for constructing search URLs on Akademikernes Jobbank.

## Base URL

```
https://jobbank.dk/job/
```

## Full URL Pattern

```
https://jobbank.dk/job/?key={search}&antikey={exclude}&cvtype={type_id}&udd={edu_id}&amt={location_id}&erf={workarea_id}&branche={industry_id}&andet={suitability_id}&virk={company}&fjernarbejde={remote}&oprettet={YYYY-MM-DD}&page={num}
```

**Multiple values:** Repeat the parameter name
```
cvtype=3&cvtype=13&amt=2&amt=3
```

## Query Parameters

| Parameter | Description | Format |
|-----------|-------------|--------|
| `key` | Search keywords | URL-encoded string (use `+` for spaces) |
| `antikey` | Exclude keywords | URL-encoded string |
| `cvtype` | Job type ID | Numeric ID (see table below) |
| `udd` | Education area ID | Numeric ID (see table below) |
| `amt` | Location/region ID | Numeric ID (see table below) |
| `erf` | Work area ID | Numeric ID (see table below) |
| `branche` | Industry ID | Numeric ID (see table below) |
| `andet` | Suitability ID | Numeric ID (see table below) |
| `virk` | Company name | URL-encoded string |
| `fjernarbejde` | Remote work | `helt` (fully) or `delvist` (partially) |
| `oprettet` | Posted since date | `YYYY-MM-DD` format |
| `page` | Page number | Integer (1-indexed) |

## Filter Tables

### Job Type (cvtype)

| Label | ID |
|-------|-----|
| Fuldtidsjob (Full-time) | 3 |
| Graduate/trainee | 6 |
| Deltidsjob (Part-time) | 13 |
| Vikariat (Temporary) | 8 |
| Ph.d. & Postdoc | 12 |
| Freelance | 11 |
| Iværksætterprojekt (Entrepreneurship) | 15 |
| Event | 14 |
| Praktikplads (Internship) | 9 |
| Studiejob (Student job) | 4 |
| Studieprojekt/speciale (Study project/thesis) | 5 |

### Education Area (udd)

| Label | ID |
|-------|-----|
| Administration | 20 |
| Anlæg/Byggeri/Konstruktion (Construction) | 43 |
| Arkitektur/Kunst/Design (Architecture/Art/Design) | 29 |
| Elektro/Telekommunikation (Electronics/Telecom) | 47 |
| Fødevarer/Veterinær (Food/Veterinary) | 32 |
| Human Resources | 38 |
| Humaniora (Humanities) | 28 |
| IT | 24 |
| Jura (Law) | 23 |
| Kemi/Biotek/Materialer (Chemistry/Biotech/Materials) | 44 |
| Klima/Miljø/Energi (Climate/Environment/Energy) | 45 |
| Landbrug/Natur (Agriculture/Nature) | 37 |
| Marketing/Business | 22 |
| Maskin/Design (Mechanical/Design) | 48 |
| Matematik/Fysik/Nano (Math/Physics/Nano) | 46 |
| Medicinal/Sundhed (Medicine/Health) | 31 |
| Naturvidenskab (Natural Sciences) | 30 |
| Organisation/Ledelse (Organization/Management) | 41 |
| Produktion/Logistik/Transport (Production/Logistics/Transport) | 35 |
| Samfundsvidenskab (Social Sciences) | 34 |
| Sprog/Media/Kommunikation (Language/Media/Communication) | 25 |
| Teknik/Teknologi (Engineering/Technology) | 33 |
| Undervisning/Pædagogik (Education/Pedagogy) | 26 |
| Økonomi/Revision (Economics/Accounting) | 21 |

### Location/Region (amt)

| Label | ID |
|-------|-----|
| Storkøbenhavn (Greater Copenhagen) | 2 |
| Nordsjælland (North Zealand) | 3 |
| Østsjælland (East Zealand) | 14 |
| Vestsjælland (West Zealand) | 4 |
| Sydsjælland & Øer (South Zealand & Islands) | 5 |
| Fyn (Funen) | 13 |
| Sønderjylland (South Jutland) | 12 |
| Sydvestjylland (Esbjerg) | 11 |
| Vestjylland (West Jutland) | 9 |
| Sydøstjylland (Southeast Jutland) | 10 |
| Midtjylland (Central Jutland) | 7 |
| Østjylland (Aarhus) | 8 |
| Nordjylland (North Jutland) | 6 |
| Bornholm | 20 |
| Øresundsregionen (Øresund Region) | 21 |
| Grønland & Færøerne (Greenland & Faroe Islands) | 22 |
| Udlandet - Sverige (Abroad - Sweden) | 23 |
| Udlandet - Norge (Abroad - Norway) | 24 |
| Udlandet - øvrige (Abroad - other) | 19 |

### Work Area (erf)

| Label | ID |
|-------|-----|
| Administration | 20 |
| Arkitektur/Design (Architecture/Design) | 38 |
| Bank/Forsikring (Banking/Insurance) | 22 |
| Data/Analyse (Data/Analysis) | 43 |
| Eksport (Export) | 47 |
| Forskning/Udvikling (Research/Development) | 41 |
| Human Resources | 28 |
| Indkøb (Procurement) | 49 |
| Internet/Multimedia | 34 |
| IT-Hardware | 32 |
| IT-Netværk/Telekomm. (IT-Network/Telecom) | 33 |
| IT-Software | 31 |
| Jura (Law) | 24 |
| Kommunikation/Media/SoMe (Communication/Media/Social Media) | 35 |
| Konstruktion/Beregning (Construction/Calculation) | 46 |
| Kunst/Kultur (Art/Culture) | 37 |
| Ledelse/Planlægning (Management/Planning) | 26 |
| Marketing/Reklame (Marketing/Advertising) | 29 |
| Medicinal/Sundhed (Medicine/Health) | 40 |
| Naturvidenskab (Natural Sciences) | 45 |
| Organisation/Forening (Organization/Association) | 23 |
| Politik/Samfund (Politics/Society) | 52 |
| Produktion (Production) | 44 |
| Projektledelse (Project Management) | 27 |
| Rådgivning/Support (Consulting/Support) | 50 |
| Salg (Sales) | 30 |
| Socialvæsen (Social Services) | 39 |
| Teknik (Engineering) | 42 |
| Topledelse (Executive Management) | 25 |
| Transport/Logistik (Transport/Logistics) | 48 |
| Undervisning (Education) | 36 |
| Økonomi/Forvaltning (Finance/Administration) | 21 |

### Industry (branche)

| Label | ID |
|-------|-----|
| Advokat/Revision (Law/Accounting) | 10359 |
| Byggeri/Anlæg (Construction) | 11669 |
| Elektronik/Maskin (Electronics/Machinery) | 11634 |
| Fagforeninger/A-kasser/Pensionskasser (Unions/Unemployment funds/Pension funds) | 16791 |
| Finans/Forsikring/Pension (Finance/Insurance/Pension) | 10358 |
| Forskning/Uddannelse (Research/Education) | 10442 |
| Fødevarer/Dagligvarer (Food/Groceries) | 15407 |
| Handel/Service (Trade/Service) | 10364 |
| IT/Tele | 10331 |
| Klima/Energi/Forsyning (Climate/Energy/Utilities) | 17209 |
| Kommuner (Municipalities) | 16826 |
| Kultur/Medier/Underholdning (Culture/Media/Entertainment) | 10341 |
| Medicinal/Biotek/Kemi (Pharmaceuticals/Biotech/Chemistry) | 10333 |
| Papir/Møbel/Materialer (Paper/Furniture/Materials) | 10363 |
| Regioner/Sundhed/Socialvæsen (Regions/Health/Social services) | 11626 |
| Rådgivning/Konsulentservice (Consulting services) | 15586 |
| Stat/Politik/Samfund (Government/Politics/Society) | 10362 |
| Transport | 10440 |
| Vikar/Rekruttering (Temp/Recruitment) | 12450 |

### Suitability (andet)

| Label | ID |
|-------|-----|
| Nyuddannede (New graduates) | 2 |
| Personer med international baggrund (People with international background) | 4 |
| Erfarne (Experienced) | 5 |

### Remote Work (fjernarbejde)

| Label | Value |
|-------|-------|
| Helt hjemmearbejde (Fully remote) | `helt` |
| Delvist hjemmearbejde (Partially remote) | `delvist` |

## Job Detail URL Pattern

```
https://jobbank.dk/job/{id}/{company-slug}/{title-slug}/
```

Example: `https://jobbank.dk/job/12345/novo-nordisk/senior-data-scientist/`

## RSS Feed URL

Every search has an RSS equivalent:

```
https://jobbank.dk/job/rss?{same_query_params}
```

Example:
```
https://jobbank.dk/job/rss?key=python&amt=2&cvtype=3
```

## Pagination

- Pages are 1-indexed (first page is `page=1` or no page parameter)
- Approximately 20 results per page
- Use `&page=2`, `&page=3`, etc. to navigate

## Job Card Extraction

### CSS Selectors

| Element | Selector |
|---------|----------|
| Job card container | `div.job-item` |
| Job ID | `div.job-item[name]` (use `getAttribute("name")`) |
| Job title | `.job-header` |
| Job type/company/location | `.job-teaser` |
| Job description excerpt | `.job-description` |
| Date updated | `.job-date-updated` |
| Application deadline | `.job-date-application` |
| Job detail link | `a[href^="/job/"]` (prepend `https://jobbank.dk`) |

### Working Extraction Code

```javascript
async page => {
  const jobs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("div.job-item")).map(item => {
      const id = item.getAttribute("name");
      const link = item.querySelector("a[href^='/job/']");
      const url = link ? "https://jobbank.dk" + link.getAttribute("href") : null;
      const header = item.querySelector(".job-header");
      const teaser = item.querySelector(".job-teaser");
      const desc = item.querySelector(".job-description");
      const dateUpdated = item.querySelector(".job-date-updated");
      const deadline = item.querySelector(".job-date-application");
      return {
        id,
        title: header ? header.textContent.trim() : null,
        teaser: teaser ? teaser.textContent.trim() : null,
        description: desc ? desc.textContent.trim() : null,
        url,
        dateUpdated: dateUpdated ? dateUpdated.textContent.trim() : null,
        deadline: deadline ? deadline.textContent.trim() : null,
      };
    });
  });
  return JSON.stringify(jobs, null, 2);
}
```

## Examples

### Simple Keyword Search

```
https://jobbank.dk/job/?key=data+scientist
```

### Full-Time IT Jobs in Copenhagen

```
https://jobbank.dk/job/?key=developer&cvtype=3&udd=24&amt=2
```

### Remote Software Development Positions

```
https://jobbank.dk/job/?erf=31&fjernarbejde=helt
```

### Graduate/Trainee Positions in Multiple Cities

```
https://jobbank.dk/job/?cvtype=6&amt=2&amt=8
```

### Project Management Jobs Suitable for New Graduates

```
https://jobbank.dk/job/?key=project+manager&erf=27&andet=2
```

### Jobs in IT/Telecom Industry, Excluding Senior Positions

```
https://jobbank.dk/job/?key=developer&antikey=senior&branche=10331
```

### Data Analysis Jobs Posted in Last 7 Days

```
https://jobbank.dk/job/?key=data+analysis&erf=43&oprettet=2026-02-03
```

### Second Page of Python Jobs in Aarhus

```
https://jobbank.dk/job/?key=python&amt=8&page=2
```

### Specific Company Search (Novo Nordisk)

```
https://jobbank.dk/job/?virk=novo+nordisk
```

### Ph.D. and Postdoc Positions in Natural Sciences

```
https://jobbank.dk/job/?cvtype=12&udd=30
```

## Notes

- **URL encoding:** Use `+` or `%20` for spaces in text parameters (`key`, `antikey`, `virk`)
- **Multiple filters:** Repeat parameter names for multiple values in same category
- **Date format:** Use ISO format `YYYY-MM-DD` for `oprettet` parameter
- **Remote work:** Only two values: `helt` (fully) or `delvist` (partially)
- **Case sensitivity:** Filter IDs are case-sensitive, use exact values from tables
- **Empty results:** Invalid filter combinations may return zero results
- **RSS monitoring:** Use RSS feeds for automated job monitoring and alerts
