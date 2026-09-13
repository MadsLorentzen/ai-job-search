#!/usr/bin/env bun
/** Dispatcher mapping the old python invocations onto the bun/TS tools. */
import { frameworkVersionMain } from "./check_framework_version.ts";
import { upstreamUpdatesMain } from "./check_upstream_updates.ts";
import { jobKeyMain } from "./job_key.ts";
import { lintSkillsMain } from "./lint_skills.ts";
import { rankStateMain } from "./rank_state.ts";
import { convertSalaryExcelMain } from "./convert_salary_excel.ts";
import { salaryLookupMain } from "./salary_lookup.ts";
import { robotsCheckMain } from "./robots_check.ts";
import { securityGuardsMain } from "./security_guards.ts";
import { upstreamTriageMain } from "./upstream_triage.ts";
import { verifyLayoutMain } from "./verify_layout.ts";
import { verifyPdfMain } from "./verify_pdf.ts";
import { fetchPostingMain } from "./fetch_posting.ts";

const [command, ...rest] = process.argv.slice(2);
if (command === "job-key") {
  process.exit(jobKeyMain(rest));
} else if (command === "rank-state") {
  process.exit(rankStateMain(rest));
} else if (command === "verify-layout") {
  process.exit(verifyLayoutMain(rest));
} else if (command === "verify-pdf") {
  process.exit(verifyPdfMain(rest));
} else if (command === "fetch-posting") {
  process.exit(fetchPostingMain(rest));
} else if (command === "lint-skills") {
  process.exit(lintSkillsMain(rest));
} else if (command === "robots-check") {
  process.exit(robotsCheckMain(rest));
} else if (command === "framework-version") {
  process.exit(frameworkVersionMain(rest));
} else if (command === "upstream-updates") {
  process.exit(upstreamUpdatesMain(rest));
} else if (command === "security-guards") {
  process.exit(securityGuardsMain(rest));
} else if (command === "upstream-triage") {
  process.exit(upstreamTriageMain(rest));
} else if (command === "convert-salary-excel") {
  process.exit(convertSalaryExcelMain(rest));
} else if (command === "salary-lookup") {
  process.exit(salaryLookupMain(rest));
} else {
  process.stderr.write(
    "usage: cli.ts <job-key|rank-state|verify-layout|verify-pdf|lint-skills|robots-check|framework-version|upstream-updates|security-guards|upstream-triage|convert-salary-excel|salary-lookup> [args]\n",
  );
  process.exit(2);
}
