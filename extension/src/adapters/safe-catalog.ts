export const SAFE_CATALOG_FIELD_TYPES = [
  "name", "email", "phone", "linkedin", "github", "location",
] as const;

const LABEL_PATTERNS: Record<(typeof SAFE_CATALOG_FIELD_TYPES)[number], RegExp> = {
  name: /\b(full\s*name|your\s*name|first\s*name)\b/i,
  email: /\bemail\b/i,
  phone: /\b(phone|mobile)\b/i,
  linkedin: /\blinkedin\b/i,
  github: /\bgithub\b/i,
  location: /\b(location|city)\b/i,
};

// Structural rule (design spec Section 8.2): this function is the ONLY
// escalation path to "autofill" behavior. It matches exact catalog
// semantics only; it must never be extended to match employment/education
// labels, which belong to adapter-specific rules, never to this shared
// catalog.
//
// Not exported: every consumer must go through matchSafeCatalogFieldForAdapter
// below, which applies the employer/institution and work/office location
// context guards. Keeping this private prevents a future adapter from
// accidentally importing the unguarded matcher and bypassing those guards.
function matchSafeCatalogField(labelText: string): string | null {
  for (const fieldType of SAFE_CATALOG_FIELD_TYPES) {
    if (LABEL_PATTERNS[fieldType].test(labelText)) {
      return fieldType;
    }
  }
  return null;
}

// Guard centralized here (originally scoped to the generic adapter's calling
// site only) so every adapter that wants a safe-catalog match gets the same
// protection instead of each adapter having to duplicate it. The shared
// safe catalog's `location` pattern matches on the bare word "location",
// which also fires on labels like "Employer location", "Company location",
// or "University location" — an ambiguous EMPLOYMENT/EDUCATION field, not
// the candidate's own contact location. The design spec (Section 8.1)
// already protects ambiguous employment fields (e.g. a bare "Employer"
// field) from over-eager autofill; this extends the same protection to
// location so we never write the candidate's own address into a field
// meant for an employer's or institution's address. A bare "Location" or
// "City" label with no such qualifier is unaffected and still autofills
// normally.
const EMPLOYER_CONTEXT_QUALIFIER = /\b(employer|company|institution|university|school|organization)\b/i;

// Guards the widened `name` pattern (first/last/middle name) the same way
// EMPLOYER_CONTEXT_QUALIFIER guards `location`: a "First Name" label is the
// candidate's own identity and safe to autofill, but "Reference First Name",
// "Recruiter Name", "Manager Name", or "Emergency Contact Name" wear the
// same safe-catalog label while naming a third party — autofilling the
// candidate's own name into those would misrepresent who the field is
// asking about.
const THIRD_PARTY_NAME_QUALIFIER =
  /\b(reference|referee|recruiter|hiring\s*manager|manager|supervisor|contact|emergency|third[\s-]*party)\b/i;

function isThirdPartyNameField(labelText: string): boolean {
  return THIRD_PARTY_NAME_QUALIFIER.test(labelText);
}

// Narrow, phrase-level exclusion (distinct from the qualifier above): only
// fires when "work" or "office" sits immediately in front of "location"
// (tolerating whitespace/hyphen between them and any surrounding
// punctuation/casing). This intentionally does NOT use a bare "work"/"office"
// qualifier word the way EMPLOYER_CONTEXT_QUALIFIER does, because a bare
// qualifier would also wrongly suppress extremely common, legitimate
// safe-catalog labels such as "Work email", "Work phone", or "Office phone"
// — none of which contain the word "location" at all, so this phrase pattern
// never matches them.
const LOCATION_SPECIFIC_EXCLUSION = /\b(work|office)[\s-]*location\b/i;

function isAmbiguousEmployerContextField(labelText: string): boolean {
  return EMPLOYER_CONTEXT_QUALIFIER.test(labelText);
}

function isWorkOrOfficeLocationField(labelText: string): boolean {
  return LOCATION_SPECIFIC_EXCLUSION.test(labelText);
}

// Adapters must call this (never the private raw matcher above) for
// classify()/map() decisions: it applies the employer/institution-context
// guard and the work/office-location phrase guard so an ambiguous label
// never escalates to "autofill".
export function matchSafeCatalogFieldForAdapter(labelText: string): string | null {
  const safeType = matchSafeCatalogField(labelText);
  if (safeType === "name" && isThirdPartyNameField(labelText)) {
    // Refuse to trust the safe-catalog match: this looks like a
    // third-party-scoped name field (reference, recruiter, manager,
    // emergency contact) wearing a safe-catalog "name" label. Treat as
    // unmatched so it falls through to the generic `ask` default instead
    // of escalating to `autofill` with the candidate's own name.
    return null;
  }
  if (safeType && isAmbiguousEmployerContextField(labelText)) {
    // Refuse to trust the safe-catalog match: this looks like an
    // employer/institution-scoped field wearing a safe-catalog label
    // (e.g. "location"). Treat as unmatched so it falls through to the
    // generic `ask` default instead of escalating to `autofill`.
    return null;
  }
  if (safeType && isWorkOrOfficeLocationField(labelText)) {
    // Same reasoning as above, but for the "work location" / "office
    // location" phrase specifically: it is just as ambiguous (candidate's
    // own address vs. a job's worksite address) as the employer-context
    // cases, but a bare "work"/"office" qualifier word would also wrongly
    // suppress legitimate labels like "Work email" or "Office phone".
    // isWorkOrOfficeLocationField only matches the adjacent phrase, so it
    // cannot fire on those.
    return null;
  }
  return safeType;
}
