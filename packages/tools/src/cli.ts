#!/usr/bin/env bun
/** Dispatcher mapping the old python invocations onto the bun/TS tools. */
import { jobKeyMain } from "./job_key.ts";
import { rankStateMain } from "./rank_state.ts";
import { verifyLayoutMain } from "./verify_layout.ts";
import { verifyPdfMain } from "./verify_pdf.ts";

const [command, ...rest] = process.argv.slice(2);
if (command === "job-key") {
  process.exit(jobKeyMain(rest));
} else if (command === "rank-state") {
  process.exit(rankStateMain(rest));
} else if (command === "verify-layout") {
  process.exit(verifyLayoutMain(rest));
} else if (command === "verify-pdf") {
  process.exit(verifyPdfMain(rest));
} else {
  process.stderr.write(
    "usage: cli.ts <job-key|rank-state|verify-layout|verify-pdf> [args]\n",
  );
  process.exit(2);
}
