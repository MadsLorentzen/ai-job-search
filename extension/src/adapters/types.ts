export type Behavior = "autofill" | "suggest" | "ask" | "never";
export type SourceKind = "safe_fact" | "adapter_rule" | "generic_fallback" | "none";

export interface FieldDecision {
  normalizedFieldType: string;
  behavior: Behavior;
  mappingReason: string;
  sourceKind: SourceKind;
  requiresUserApproval: boolean;
  adapterId: string;
  adapterVersion: string;
}

export interface DetectedField {
  pageFieldKey: string;
  labelText: string;
  domRef: unknown;
}

export interface ProvenancedValue {
  value: string;
  profile_evidence_ids: string[];
}

export interface CandidateSnapshot {
  identity: { name: ProvenancedValue };
  contact: Record<string, ProvenancedValue | null>;
  employment: Array<{
    record_id: string;
    role: ProvenancedValue | null;
    employer: ProvenancedValue | null;
    date_range: ProvenancedValue | null;
    location: ProvenancedValue | null;
    details: ProvenancedValue[];
  }>;
}

export interface Adapter {
  id: string;
  version: string;
  detect(document: Document): boolean;
  scan(document: Document): DetectedField[];
  classify(field: DetectedField): FieldDecision;
  map(field: DetectedField, snapshot: CandidateSnapshot): string | null;
  detectLikelySuccess?(document: Document): boolean;
}
