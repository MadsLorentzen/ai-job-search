export type AttachmentOutcome =
  | "selected" | "upload_confirmed_by_adapter" | "rejected" | "unknown";

export interface RenderedDocument {
  kind: "cv" | "cover_letter";
  filename: string;
  mimeType: string;
  sha256: string;
  byteLength: number;
  bytes: ArrayBuffer;
}

function parseFilename(contentDisposition: string): string {
  const match = contentDisposition.match(/filename="([^"]+)"/);
  return match ? match[1] : "document.docx";
}

// Calls the existing render route fresh every time (design spec Section
// 7) — no caching, no new persisted file bytes. pack_artifact_id is
// always explicit and always the session's pinned value; this function
// has no parameter that could omit it and fall back to "current".
export async function fetchExactPackDocument(
  baseUrl: string,
  credential: string,
  workspaceId: string,
  packArtifactId: string,
  kind: "cv" | "cover_letter",
): Promise<RenderedDocument> {
  const url =
    `${baseUrl}/api/workspaces/${workspaceId}/application-pack/render/${kind}` +
    `?pack_artifact_id=${encodeURIComponent(packArtifactId)}`;
  const response = await fetch(url, {
    headers: { "X-Handoff-Credential": credential },
  });
  if (!response.ok) {
    throw new Error(`failed to render ${kind} for pack ${packArtifactId}: ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  return {
    kind,
    filename: parseFilename(response.headers.get("content-disposition") ?? ""),
    mimeType: response.headers.get("content-type") ?? "application/octet-stream",
    sha256: response.headers.get("x-content-hash") ?? "",
    byteLength: bytes.byteLength,
    bytes,
  };
}

// Builds the event_payload for an upload_selected / upload_confirmed /
// upload_failed event (design spec Section 7, Section 11). The outcome
// vocabulary is deliberately not a boolean: "selected" proves only that
// the extension attempted the attachment, not that the ATS's own
// asynchronous upload completed.
export function buildAttachmentEventPayload(
  document: RenderedDocument,
  packArtifactId: string,
  rendererVersion: string,
  outcome: AttachmentOutcome,
): Record<string, unknown> {
  return {
    kind: document.kind,
    filename: document.filename,
    mime_type: document.mimeType,
    sha256: document.sha256,
    byte_length: document.byteLength,
    pack_artifact_id: packArtifactId,
    renderer_version: rendererVersion,
    outcome,
  };
}
