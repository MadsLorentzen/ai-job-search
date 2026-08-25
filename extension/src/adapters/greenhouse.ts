import type { Adapter, CandidateSnapshot, DetectedField, FieldDecision } from "./types";
import { matchSafeCatalogFieldForAdapter } from "./safe-catalog";
import { isLegalDeclarationField } from "./legal-patterns";

const ADAPTER_ID = "greenhouse";
const ADAPTER_VERSION = "greenhouse@1";

function labelFor(input: Element, document: Document): string {
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) return label.textContent?.trim() ?? "";
  }
  return "";
}

export const greenhouseAdapter: Adapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,

  detect(document: Document): boolean {
    return document.querySelector("#application_form") !== null;
  },

  scan(document: Document): DetectedField[] {
    const inputs = Array.from(
      document.querySelectorAll<HTMLElement>(
        "#application_form input, #application_form select",
      ),
    );
    return inputs.map((input) => ({
      pageFieldKey: `greenhouse:application:${input.id}`,
      labelText: labelFor(input, document),
      domRef: input,
    }));
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
    // Adapter-specific rule (design spec Section 8.1): Greenhouse's own
    // form makes this field's meaning unambiguous ("Most Recent
    // Employer" is explicitly labeled, unlike a bare "Employer" field
    // that could mean any of several roles), so this specific label may
    // autofill from employment[0] even though employment fields are never
    // in the shared universal catalog. Checked before the shared safe
    // catalog so an adapter-specific unambiguous rule always wins.
    if (field.labelText === "Most Recent Employer") {
      return {
        normalizedFieldType: "employment[0].employer", behavior: "autofill",
        mappingReason: "adapter rule: greenhouse most_recent_employer",
        sourceKind: "adapter_rule", requiresUserApproval: false,
        adapterId: ADAPTER_ID, adapterVersion: ADAPTER_VERSION,
      };
    }
    if (field.labelText === "Years of Experience") {
      return {
        normalizedFieldType: "years_of_experience", behavior: "suggest",
        mappingReason: "adapter rule: greenhouse derived years_of_experience",
        sourceKind: "adapter_rule", requiresUserApproval: true,
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
    if (field.labelText === "Most Recent Employer") {
      return snapshot.employment[0]?.employer?.value ?? null;
    }
    const safeType = matchSafeCatalogFieldForAdapter(field.labelText);
    if (safeType === "name") return snapshot.identity.name?.value ?? null;
    if (safeType && safeType in snapshot.contact) {
      return snapshot.contact[safeType]?.value ?? null;
    }
    return null; // years_of_experience derivation is implemented in Task 15
  },
};
