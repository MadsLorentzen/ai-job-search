export async function switchToTerminal({
  controllers,
  startPty,
  expectedControllerGeneration,
} = {}) {
  const begun = await controllers.beginTerminalHandoff({ expectedControllerGeneration });
  if (!begun.ok) return begun;
  try {
    const pty = await startPty(begun);
    if (!pty?.id) throw new Error("pty-not-ready");
    const committed = await controllers.commitTerminalHandoff({
      handoffId: begun.handoffId,
      terminalId: pty.id,
    });
    if (!committed.ok) {
      await pty.dispose?.();
      return committed;
    }
    return { ok: true, terminalId: pty.id, snapshot: committed, handoffId: begun.handoffId };
  } catch (error) {
    await controllers.rollbackTerminalHandoff({ handoffId: begun.handoffId });
    return { ok: false, reason: "process-failure", error: error.message };
  }
}

export async function switchToChat({
  controllers,
  disposePty,
  expectedControllerGeneration,
  terminalId,
} = {}) {
  const begun = await controllers.beginChatHandoff({ expectedControllerGeneration, terminalId });
  if (!begun.ok) return begun;
  try {
    await disposePty?.();
    const committed = await controllers.commitChatHandoff({ handoffId: begun.handoffId });
    if (!committed.ok) return committed;
    return { ok: true, snapshot: committed, handoffId: begun.handoffId };
  } catch (error) {
    await controllers.rollbackTerminalHandoff({ handoffId: begun.handoffId });
    return { ok: false, reason: "process-failure", error: error.message };
  }
}
