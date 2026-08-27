const LEGAL_PATTERNS: RegExp[] = [
  /\bcertify\b/i,
  /\battest\b/i,
  /\belectronic\s*signature\b/i,
  /\be-?sign(ature)?\b/i,
  /\bunder\s*penalty\s*of\s*perjury\b/i,
  /\bI\s*agree\b/i,
];

// This is the ONLY authorization path to `never` in the closed policy
// (design spec Section 8). It is intentionally conservative: a false
// positive here just means one more field is left for the user to fill,
// which is always the safe direction to err in.
export function isLegalDeclarationField(labelText: string): boolean {
  return LEGAL_PATTERNS.some((pattern) => pattern.test(labelText));
}
