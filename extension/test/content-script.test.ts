import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { runContentScript, approveSuggestion } from "../src/content/content-script";
import { genericAdapter } from "../src/adapters/generic";
import type { CandidateSnapshot } from "../src/adapters/types";
import type { ContentScriptMessage } from "../src/content/messages";

function loadDoc(html: string): Document {
  return new JSDOM(html).window.document;
}

const SNAPSHOT: CandidateSnapshot = {
  identity: { name: { value: "Test User", profile_evidence_ids: ["clm_name"] } },
  contact: {
    email: { value: "test@example.com", profile_evidence_ids: ["clm_email"] },
    phone: null,
    linkedin: null,
    github: null,
    location: null,
  },
  employment: [],
};

const FIXTURE_HTML = `<!doctype html><html><body>
  <form id="application">
    <label for="f_name">Full Name</label><input id="f_name" name="name">
    <label for="f_email">Email address</label><input id="f_email" name="email">
    <label for="f_salary">Desired salary</label><input id="f_salary" name="salary">
    <label for="f_cert"><input type="checkbox" id="f_cert" name="certify"> I certify that the information above is true and correct</label>
  </form>
</body></html>`;

describe("runContentScript", () => {
  it("writes the DOM for an autofill field using exactly the adapter-mapped value", () => {
    const document = loadDoc(FIXTURE_HTML);
    const sent: ContentScriptMessage[] = [];
    runContentScript(document, SNAPSHOT, [genericAdapter], (m) => sent.push(m));

    const emailInput = document.querySelector<HTMLInputElement>("#f_email")!;
    expect(emailInput.value).toBe("test@example.com");
  });

  it("never writes ask fields", () => {
    const document = loadDoc(FIXTURE_HTML);
    runContentScript(document, SNAPSHOT, [genericAdapter], () => {});
    const salaryInput = document.querySelector<HTMLInputElement>("#f_salary")!;
    expect(salaryInput.value).toBe("");
  });

  it("never writes never fields regardless of label wording", () => {
    const document = loadDoc(FIXTURE_HTML);
    runContentScript(document, SNAPSHOT, [genericAdapter], () => {});
    const certInput = document.querySelector<HTMLInputElement>("#f_cert") as HTMLInputElement;
    expect(certInput.checked).toBe(false);
  });

  it("a location-looking field rejected by the adapter cannot be rescued by content-script heuristics", () => {
    const document = loadDoc(`<!doctype html><html><body>
      <form><label for="f_eloc">Employer location</label><input id="f_eloc" name="employer_location"></form>
    </body></html>`);
    const snapshotWithLocation: CandidateSnapshot = {
      ...SNAPSHOT,
      contact: { ...SNAPSHOT.contact, location: { value: "Springfield", profile_evidence_ids: ["clm_loc"] } },
    };
    runContentScript(document, snapshotWithLocation, [genericAdapter], () => {});
    const input = document.querySelector<HTMLInputElement>("#f_eloc")!;
    // The adapter's own guard (Task 13/refactor) already classifies this
    // "ask" — this test proves the content script has no independent
    // location-detection logic of its own that could override that.
    expect(input.value).toBe("");
  });

  it("suggest produces UI state but zero DOM writes until explicit approval", () => {
    const document = loadDoc(`<!doctype html><html><body>
      <form><label for="f_years">Years of Experience</label><input id="f_years" name="years"></form>
    </body></html>`);
    // A minimal fake Adapter constructed inline to isolate the
    // suggest-boundary behavior from any one real adapter's specifics.
    const suggestOnlyAdapter = {
      id: "test-suggest", version: "test@1",
      detect: () => true,
      scan: (doc: Document) => [{
        pageFieldKey: "test:years", labelText: "Years of Experience",
        domRef: doc.querySelector("#f_years"),
      }],
      classify: () => ({
        normalizedFieldType: "years_of_experience", behavior: "suggest" as const,
        mappingReason: "test adapter rule", sourceKind: "adapter_rule" as const,
        requiresUserApproval: true, adapterId: "test-suggest", adapterVersion: "test@1",
      }),
      map: () => "7",
    };
    const sent: ContentScriptMessage[] = [];
    const result = runContentScript(document, SNAPSHOT, [suggestOnlyAdapter], (m) => sent.push(m));

    const input = document.querySelector<HTMLInputElement>("#f_years")!;
    expect(input.value).toBe(""); // no DOM write yet
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].pageFieldKey).toBe("test:years");
    expect(sent.some((m) => m.type === "suggestion_presented")).toBe(true);
    expect(sent.some((m) => m.type === "value_inserted")).toBe(false);

    approveSuggestion(result, "test:years", (m) => sent.push(m));
    expect(input.value).toBe("7");
    expect(sent.some((m) => m.type === "user_approved_insert")).toBe(true);
    expect(sent.some((m) => m.type === "value_inserted")).toBe(true);
  });

  it("repeated scans do not produce duplicate logical events for unchanged fields", () => {
    const document = loadDoc(FIXTURE_HTML);
    const sent: ContentScriptMessage[] = [];
    const push = (m: ContentScriptMessage) => sent.push(m);

    const first = runContentScript(document, SNAPSHOT, [genericAdapter], push);
    const firstCount = sent.length;
    // Second scan of the SAME unchanged DOM, reusing the same tracked
    // state the first scan returned.
    runContentScript(document, SNAPSHOT, [genericAdapter], push, first.trackedState);

    expect(sent.length).toBe(firstCount); // no new events emitted
  });

  it("a removed/replaced DOM field produces a conservative target_unresolved event, never a silent drop or a write", () => {
    const document = loadDoc(FIXTURE_HTML);
    const sent: ContentScriptMessage[] = [];
    const first = runContentScript(document, SNAPSHOT, [genericAdapter], (m) => sent.push(m));

    // Simulate an SPA replacing the email field's DOM node entirely.
    const oldInput = document.querySelector("#f_email")!;
    const replacement = document.createElement("input");
    replacement.id = "f_email_v2";
    oldInput.replaceWith(replacement);

    sent.length = 0;
    runContentScript(document, SNAPSHOT, [genericAdapter], (m) => sent.push(m), first.trackedState);

    const unresolved = sent.find((m) => m.type === "target_unresolved");
    expect(unresolved).toBeDefined();
    expect((replacement as HTMLInputElement).value).toBe(""); // never written to the new, unverified node
  });

  it("a freshly attached field is not wrongly reported as target_unresolved on first scan", () => {
    // Regression guard for the instanceof-vs-jsdom-global pitfall: under this
    // project's vitest node environment there is no global `Element` or
    // `HTMLInputElement` constructor, so an isAttached()/write check that
    // relies on `instanceof Element` against the ambient global would treat
    // every freshly-scanned, correctly-attached field as unresolved. This
    // test would fail loudly if that regression were reintroduced.
    const document = loadDoc(FIXTURE_HTML);
    const sent: ContentScriptMessage[] = [];
    runContentScript(document, SNAPSHOT, [genericAdapter], (m) => sent.push(m));

    expect(sent.some((m) => m.type === "target_unresolved")).toBe(false);
    expect(sent.some((m) => m.type === "value_inserted")).toBe(true);
  });
});
