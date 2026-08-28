import assert from "node:assert/strict";
import test from "node:test";
import { claudeSupportsDeskRuntime, parseClaudeVersion, resolveCommand } from "../claude.mjs";

const enabled = process.env.JOB_SEARCH_RUN_CLAUDE_INTEGRATION === "1";

test("real Claude Agent SDK session can send two turns, interrupt, and resume", { skip: !enabled }, async () => {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const claude = resolveCommand("claude");
  const { stdout } = await execFileAsync(claude, ["--version"], { timeout: 15000, windowsHide: true });
  assert.equal(claudeSupportsDeskRuntime(parseClaudeVersion(stdout)), true);

  const sessionIds = [];
  for await (const message of query({
    prompt: "Reply with the single word ping and stop.",
    options: {
      pathToClaudeCodeExecutable: claude,
      permissionMode: "dontAsk",
      allowDangerouslySkipPermissions: false,
    },
  })) {
    if (message.session_id) sessionIds.push(message.session_id);
    if (message.type === "result") break;
  }
  assert.ok(sessionIds.at(-1));
});
