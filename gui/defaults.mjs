/** Shared constants for the desk server and the installable app. */

export const TEMPLATE_REPO =
  process.env.JOB_SEARCH_TEMPLATE_URL || "https://github.com/iLevyTate/ai-job-search.git";

export function templateArchiveUrl(repoUrl = TEMPLATE_REPO) {
  return `${repoUrl.replace(/\.git$/i, "").replace(/\/$/, "")}/archive/refs/heads/master.zip`;
}

export function templateArchiveRoot(repoUrl = TEMPLATE_REPO) {
  const name = repoUrl.replace(/\.git$/i, "").replace(/\/$/, "").split("/").pop();
  return `${name}-master`;
}

export const CHROME_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn";

export const CLAUDE_AI_URL = "https://claude.ai";
export const CLAUDE_INSTALL_SH = "https://claude.ai/install.sh";
export const CLAUDE_INSTALL_PS1 = "https://claude.ai/install.ps1";
export const CLAUDE_PRICING_URL = "https://claude.com/pricing";
export const DESK_SESSION_NAME = "Job Search Desk";
