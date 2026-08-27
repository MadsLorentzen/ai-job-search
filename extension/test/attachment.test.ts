import { describe, expect, it, vi } from "vitest";
import { buildAttachmentEventPayload, fetchExactPackDocument } from "../src/background/attachment";

describe("fetchExactPackDocument", () => {
  it("calls the exact render route with the pinned pack_artifact_id and reads the hash header", async () => {
    const bytes = new TextEncoder().encode("fake docx bytes").buffer;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([
        ["content-disposition", 'attachment; filename="Acme_Engineer_CV.docx"'],
        ["content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        ["x-content-hash", "sha256:abc123"],
      ]),
      arrayBuffer: async () => bytes,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchExactPackDocument(
      "http://127.0.0.1:8420", "cred-123", "ws_1", "art_XYZ", "cv",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8420/api/workspaces/ws_1/application-pack/render/cv?pack_artifact_id=art_XYZ",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Handoff-Credential": "cred-123" }) }),
    );
    expect(result.sha256).toBe("sha256:abc123");
    expect(result.filename).toBe("Acme_Engineer_CV.docx");
    expect(result.byteLength).toBe(bytes.byteLength);
    vi.unstubAllGlobals();
  });

  it("always includes the explicit pack_artifact_id, never omitting it for a handoff session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([
        ["content-disposition", 'attachment; filename="x.docx"'],
        ["content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        ["x-content-hash", "sha256:def456"],
      ]),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchExactPackDocument("http://127.0.0.1:8420", "cred", "ws_1", "art_PINNED", "cover_letter");

    const [calledUrl] = fetchMock.mock.calls[0] as [string, unknown];
    expect(calledUrl).toContain("pack_artifact_id=art_PINNED");
    vi.unstubAllGlobals();
  });
});

describe("buildAttachmentEventPayload", () => {
  it("carries the exact pack id, renderer version, hash, and outcome — never a bare boolean", () => {
    const doc = {
      kind: "cv" as const, filename: "Acme_Engineer_CV.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sha256: "sha256:abc123", byteLength: 42, bytes: new ArrayBuffer(42),
    };
    const payload = buildAttachmentEventPayload(
      doc, "art_XYZ", "application-pack-renderer.v2", "selected",
    );
    expect(payload).toEqual({
      kind: "cv", filename: "Acme_Engineer_CV.docx",
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sha256: "sha256:abc123", byte_length: 42,
      pack_artifact_id: "art_XYZ", renderer_version: "application-pack-renderer.v2",
      outcome: "selected",
    });
  });

  it("supports the unknown outcome as an honest default, never upgraded to selected", () => {
    const doc = {
      kind: "cover_letter" as const, filename: "x.docx", mimeType: "x",
      sha256: "sha256:x", byteLength: 1, bytes: new ArrayBuffer(1),
    };
    const payload = buildAttachmentEventPayload(doc, "art_1", "v2", "unknown");
    expect(payload.outcome).toBe("unknown");
  });
});
