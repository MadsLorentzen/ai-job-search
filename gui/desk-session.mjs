import { createArtifactService } from "./artifacts.mjs";
import { createAutofillBridge } from "./autofill-bridge.mjs";
import { createConversationStore } from "./conversation-store.mjs";
import { createPermissionPolicy } from "./permission-policy.mjs";
import { createSessionRuntime } from "./session-runtime.mjs";

export async function createDeskSession({
  workspace,
  adapterFactory,
  autofillBridge = createAutofillBridge(),
  artifactService,
  ...runtimeExtras
} = {}) {
  if (!workspace) throw new Error("workspace is required");
  const store = createConversationStore({ workspace });
  await store.load();
  let conversationId = store.activeConversationId();
  if (!conversationId) conversationId = (await store.createConversation()).id;
  const permissionPolicy = createPermissionPolicy({ workspace });
  await permissionPolicy.load();
  const artifacts = artifactService || createArtifactService({ workspace });
  const runtime = createSessionRuntime({
    workspace,
    conversationId,
    store,
    permissionPolicy,
    artifactService: artifacts,
    autofillBridge,
    adapterFactory,
    ...runtimeExtras,
  });
  return { store, runtime, artifacts, autofill: autofillBridge, conversationId };
}

export function createDeskRuntimeFactory(overrides = {}) {
  return async ({ workspace }) => {
    const session = await createDeskSession({ workspace, ...overrides });
    await session.runtime.start();
    return session.runtime;
  };
}
