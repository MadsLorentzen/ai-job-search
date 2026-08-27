import type { Adapter, CandidateSnapshot, DetectedField, FieldDecision } from "./types";
import { matchSafeCatalogFieldForAdapter } from "./safe-catalog";
import { isLegalDeclarationField } from "./legal-patterns";

const ADAPTER_ID = "generic";
const ADAPTER_VERSION = "generic@1";

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
    const safeType = matchSafeCatalogFieldForAdapter(field.labelText);
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
    const safeType = matchSafeCatalogFieldForAdapter(field.labelText);
    if (safeType === "name") return snapshot.identity.name?.value ?? null;
    if (safeType && safeType in snapshot.contact) {
      return snapshot.contact[safeType]?.value ?? null;
    }
    return null;
  },
};
