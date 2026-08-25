import type { Adapter, CandidateSnapshot, DetectedField, FieldDecision } from "./types";
import { matchSafeCatalogFieldForAdapter } from "./safe-catalog";
import { isLegalDeclarationField } from "./legal-patterns";

const ADAPTER_ID = "lever";
const ADAPTER_VERSION = "lever@1";

export const leverAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  detect(document: Document): boolean {
    return document.querySelector("form.application-form") !== null;
  },

  scan(document: Document): DetectedField[] {
    const form = document.querySelector("form.application-form")!;
    const inputs = Array.from(form.querySelectorAll<HTMLElement>("input, textarea"));
    return inputs.map((input, index) => {
      const label = input.closest("label");
      return {
        pageFieldKey: `lever:application:${index}`,
        labelText: label?.textContent?.replace(input.textContent ?? "", "").trim()
          ?? label?.firstChild?.textContent?.trim() ?? "",
        domRef: input,
      };
    });
  },

  classify(field: DetectedField): FieldDecision {
    if (isLegalDeclarationField(field.labelText)) {
      return {
        normalizedFieldType: "legal_declaration", behavior: "never",
        mappingReason: "pattern match: certification/signature language",
        sourceKind: "none", requiresUserApproval: false,
        adapterId: ADAPTER_ID, adapterVersion: ADAPTER_VERSION,
      };
    }
    const safeType = matchSafeCatalogFieldForAdapter(field.labelText);
    if (safeType) {
      return {
        normalizedFieldType: safeType, behavior: "autofill",
        mappingReason: `shared safe catalog: contact.${safeType}`,
        sourceKind: "safe_fact", requiresUserApproval: false,
        adapterId: ADAPTER_ID, adapterVersion: ADAPTER_VERSION,
      };
    }
    return {
      normalizedFieldType: "unknown", behavior: "ask",
      mappingReason: "generic fallback: unmatched field, default ask",
      sourceKind: "none", requiresUserApproval: false,
      adapterId: ADAPTER_ID, adapterVersion: ADAPTER_VERSION,
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
