/**
 * job-tools: native pi tools wrapping the packages/tools bun CLI.
 *
 * State moves through tools, not context (SYSTEM.md rule 3): the agent never
 * filters seen_jobs.json or the tracker by eye — it calls these instead.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const CLI = `${REPO_ROOT}packages/tools/src/cli.ts`;

interface CliResult {
  ok: boolean;
  text: string;
}

async function runCli(pi: ExtensionAPI, args: string[]): Promise<CliResult> {
  const res = await pi.exec("bun", ["run", CLI, ...args], { cwd: REPO_ROOT });
  const text = (res.stdout || "") + (res.stderr ? `\n${res.stderr}` : "");
  return { ok: res.code === 0, text: text.trim() };
}

function result(ok: boolean, text: string) {
  return {
    content: [{ type: "text" as const, text: ok ? text : `ERROR (exit != 0)\n${text}` }],
    details: {},
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "job_candidates",
    label: "Job candidates",
    description:
      "List eligible unranked candidates from state/seen_jobs.json (dedup backlog), " +
      "excluding companies/roles already in the tracker. Use before ranking jobs.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max candidates (default 10)" })),
      all: Type.Optional(Type.Boolean({ description: "Include already-ranked entries" })),
      focus: Type.Optional(Type.String({ description: "Focus text filter" })),
    }),
    async execute(_id, params) {
      const args = ["rank-state", "candidates"];
      if (params.limit != null) args.push("--limit", String(params.limit));
      if (params.all) args.push("--all");
      if (params.focus) args.push("--focus", params.focus);
      const r = await runCli(pi, args);
      return result(r.ok, r.text);
    },
  });

  pi.registerTool({
    name: "job_rank_apply",
    label: "Apply ranking results",
    description:
      "Write scored ranking results (a temporary JSON file path) back into " +
      "state/seen_jobs.json. Path-only: never edit the JSON by hand.",
    parameters: Type.Object({
      resultsPath: Type.String({ description: "Path to the temporary results JSON file" }),
    }),
    async execute(_id, params) {
      const r = await runCli(pi, [
        "rank-state",
        "apply",
        "--results",
        params.resultsPath,
      ]);
      return result(r.ok, r.text);
    },
  });

  pi.registerTool({
    name: "job_key",
    label: "Job key",
    description:
      "Compute the stable dedup key for a posting (company + title + url). " +
      "Use before recording any job anywhere.",
    parameters: Type.Object({
      company: Type.String(),
      title: Type.String(),
      url: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      const args = ["job-key", "--company", params.company, "--title", params.title];
      if (params.url) args.push("--url", params.url);
      const r = await runCli(pi, args);
      return result(r.ok, r.text);
    },
  });

  pi.registerTool({
    name: "cv_verify",
    label: "Verify CV PDF",
    description:
      "Verify a compiled CV PDF: page count and extractable text layer. " +
      "Call after every latexml compile in the apply workflow.",
    parameters: Type.Object({
      pdfPath: Type.String({ description: "Path to the compiled PDF" }),
      pages: Type.Optional(Type.Number({ description: "Expected page count" })),
    }),
    async execute(_id, params) {
      const args = ["verify-pdf", params.pdfPath];
      if (params.pages != null) args.push("--pages", String(params.pages));
      const r = await runCli(pi, args);
      return result(r.ok, r.text);
    },
  });
}
