export const SAFE_CATALOG_FIELD_TYPES = [
  "name", "email", "phone", "linkedin", "github", "location",
] as const;

const LABEL_PATTERNS: Record<(typeof SAFE_CATALOG_FIELD_TYPES)[number], RegExp> = {
  name: /\b(full\s*name|your\s*name)\b/i,
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
export function matchSafeCatalogField(labelText: string): string | null {
  for (const fieldType of SAFE_CATALOG_FIELD_TYPES) {
    if (LABEL_PATTERNS[fieldType].test(labelText)) {
      return fieldType;
    }
  }
  return null;
}
