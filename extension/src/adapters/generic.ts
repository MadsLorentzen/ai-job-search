import type { Adapter, CandidateSnapshot, DetectedField, FieldDecision } from "./types";
import { matchSafeCatalogField } from "./safe-catalog";
import { isLegalDeclarationField } from "./legal-patterns";

const ADAPTER_ID = "generic";
const ADAPTER_VERSION = "generic@1";

// Guard scoped narrowly to this adapter's calling site (does NOT modify
// safe-catalog.ts). The shared safe catalog's `location` pattern matches on
// the bare word "location", which also fires on labels like "Employer
// location", "Company location", or "University location" — an ambiguous
// EMPLOYMENT/EDUCATION field, not the candidate's own contact location. The
// design spec (Section 8.1) already protects ambiguous employment fields
// (e.g. a bare "Employer" field) from over-eager autofill; this extends the
// same protection to location so we never write the candidate's own address
// into a field meant for an employer's or institution's address. A bare
// "Location" or "City" label with no such qualifier is unaffected and still
// autofills normally.
const EMPLOYER_CONTEXT_QUALIFIER = /\b(employer|company|institution|university|school|organization)\b/i;

function isAmbiguousEmployerContextField(labelText: string): boolean {
  return EMPLOYER_CONTEXT_QUALIFIER.test(labelText);
}

function safeCatalogMatchFor(labelText: string): string | null {
  const safeType = matchSafeCatalogField(labelText);
  if (safeType && isAmbiguousEmployerContextField(labelText)) {
    // Refuse to trust the safe-catalog match: this looks like an
    // employer/institution-scoped field wearing a safe-catalog label
    // (e.g. "location"). Treat as unmatched so it falls through to the
    // generic `ask` default instead of escalating to `autofill`.
    return null;
  }
  return safeType;
}

function labelFor(input: HTMLInputElement, document: Document): string {
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) return label.textContent?.trim() ?? "";
  }
  const parentLabel = input.closest("label");
  return parentLabel?.textContent?.trim() ?? input.name ?? "";
}

export const genericAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  detect(document: Document): boolean {
    return document.querySelectorAll("input, textarea").length > 0;
  },

  scan(document: Document): DetectedField[] {
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>("input, textarea"),
    );
    return inputs.map((input, index) => ({
      pageFieldKey: `generic:${input.name || input.id || `field_${index}`}`,
      labelText: labelFor(input, document),
      domRef: input,
    }));
  },

  classify(field: DetectedField): FieldDecision {
    if (isLegalDeclarationField(field.labelText)) {
      return {
        normalizedFieldType: "legal_declaration",
        behavior: "never",
        mappingReason: "pattern match: certification/signature language",
        sourceKind: "none",
        requiresUserApproval: false,
        adapterId: ADAPTER_ID,
        adapterVersion: ADAPTER_VERSION,
      };
    }
    const safeType = safeCatalogMatchFor(field.labelText);
    if (safeType) {
      return {
        normalizedFieldType: safeType,
        behavior: "autofill",
        mappingReason: `shared safe catalog: contact.${safeType}`,
        sourceKind: "safe_fact",
        requiresUserApproval: false,
        adapterId: ADAPTER_ID,
        adapterVersion: ADAPTER_VERSION,
      };
    }
    // Structural default (design spec Section 8.2): the generic fallback
    // never escalates beyond the safe catalog. Everything else is `ask`.
    return {
      normalizedFieldType: "unknown",
      behavior: "ask",
      mappingReason: "generic fallback: unmatched field, default ask",
      sourceKind: "none",
      requiresUserApproval: false,
      adapterId: ADAPTER_ID,
      adapterVersion: ADAPTER_VERSION,
    };
  },

  map(field: DetectedField, snapshot: CandidateSnapshot): string | null {
    const safeType = safeCatalogMatchFor(field.labelText);
    if (safeType === "name") return snapshot.identity.name?.value ?? null;
    if (safeType && safeType in snapshot.contact) {
      return snapshot.contact[safeType]?.value ?? null;
    }
    return null;
  },
};
