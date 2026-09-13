#!/usr/bin/env bun
/** Dispatcher mapping the old python invocations onto the bun/TS tools. */
import { jobKeyMain } from "./job_key.ts";
import { rankStateMain } from "./rank_state.ts";

const [command, ...rest] = process.argv.slice(2);
if (command === "job-key") {
  process.exit(jobKeyMain(rest));
} else if (command === "rank-state") {
  process.exit(rankStateMain(rest));
} else {
  process.stderr.write("usage: cli.ts <job-key|rank-state> [args]\n");
  process.exit(2);
}
