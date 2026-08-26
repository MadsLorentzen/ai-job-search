import type { QueuedEvent } from "./event-queue";

const BASE_URL = "http://127.0.0.1:8420";

// The ONLY module that makes HTTP calls to the JobSearch server (design
// spec Section 4 / Section 17 — content scripts never call this
// directly, only through messages relayed by the background worker).
export class ServerClient {
  constructor(private readonly getCredential: () => Promise<string | null>) {}

  private async headers(): Promise<Record<string, string>> {
    const credential = await this.getCredential();
    if (!credential) throw new Error("extension is not paired");
    return { "X-Handoff-Credential": credential, "Content-Type": "application/json" };
  }

  async startSession(body: {
    workspaceId: string; packArtifactId: string; targetUrl: string;
    targetDomain: string; atsAdapterId: string; atsAdapterVersion: string;
  }): Promise<{ id: string }> {
    const response = await fetch(`${BASE_URL}/api/handoff/sessions`, {
      method: "POST", headers: await this.headers(),
      body: JSON.stringify({
        workspace_id: body.workspaceId, pack_artifact_id: body.packArtifactId,
        target_url: body.targetUrl, target_domain: body.targetDomain,
        ats_adapter_id: body.atsAdapterId, ats_adapter_version: body.atsAdapterVersion,
      }),
    });
    if (!response.ok) throw new Error(`failed to start handoff session: ${response.status}`);
    return response.json();
  }

  async sendEvent(event: QueuedEvent): Promise<boolean> {
    const response = await fetch(
      `${BASE_URL}/api/handoff/sessions/${event.handoffSessionId}/events`,
      {
        method: "POST", headers: await this.headers(),
        body: JSON.stringify({
          event_id: event.eventId, event_type: event.eventType,
          event_payload: event.eventPayload,
          normalized_field_type: event.normalizedFieldType ?? null,
          page_field_key: event.pageFieldKey ?? null,
          observed_at: event.observedAt,
        }),
      },
    );
    return response.ok;
  }

  async confirmSubmission(
    handoffSessionId: string, markWorkflowApplied: boolean,
  ): Promise<unknown> {
    const response = await fetch(
      `${BASE_URL}/api/handoff/sessions/${handoffSessionId}/confirm-submission`,
      {
        method: "POST", headers: await this.headers(),
        body: JSON.stringify({ mark_workflow_applied: markWorkflowApplied }),
      },
    );
    if (!response.ok) throw new Error(`failed to confirm submission: ${response.status}`);
    return response.json();
  }
}
