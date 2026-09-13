/** Guards for /apply's tracker recording step (Step 6b). Port of
 * tests/test_apply_records_application.py (paths: profile/workflows,
 * .pi-agent/skills, state/seen_jobs.json). */
import { describe, expect, test } from "bun:test";
import { REPO, WORKFLOWS, SKILLS, read, section } from "./helpers.ts";

const APPLY = `${WORKFLOWS}/apply.md`;
const OUTCOME = `${WORKFLOWS}/outcome.md`;
const GMAIL_SYNC = `${WORKFLOWS}/gmail-sync.md`;
const HTML_REPORT = `${WORKFLOWS}/html-report.md`;
const INTERVIEW = `${WORKFLOWS}/interview.md`;
const NOTION_SYNC = `${WORKFLOWS}/notion-sync.md`;
const SKILL = `${SKILLS}/job-application-assistant/SKILL.md`;
const SCRAPER = `${SKILLS}/job-scraper/SKILL.md`;
const DOCS_README = `${REPO}/documents/README.md`;

const TRACKER_HEADER =
  "date,company,sector,role,role_type,channel,status,contact_person," +
  "fit_rating,notes,cv_file,cover_letter_file,source,deadline";

describe("/apply records the application (Step 6b)", () => {
  const step6b = () => section(APPLY, "### Step 6b: Record the Application");

  test("writes a drafted row with both document paths", () => {
    for (const fragment of [
      "| `status` | `drafted` |",
      '| `cv_file`, `cover_letter_file` | the two paths listed under "Files Created"',
    ]) {
      expect(step6b()).toContain(fragment);
    }
  });

  test("tracker header matches /outcome (byte-identical)", () => {
    expect(read(OUTCOME)).toContain(TRACKER_HEADER);
    expect(step6b()).toContain(TRACKER_HEADER);
    for (const [name, text] of [
      ["outcome.md", read(OUTCOME)],
      ["apply.md Step 6b", step6b()],
    ] as const) {
      const header = text
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("date,company,"));
      expect(header).toBe(TRACKER_HEADER);
    }
  });

  test("tracker header ends with deadline", () => {
    expect(TRACKER_HEADER.endsWith(",deadline")).toBe(true);
  });

  test("migration appends the header's own last column", () => {
    const lastColumn = TRACKER_HEADER.split(",").pop()!;
    const outcomeStep1 = section(OUTCOME, "## Step 1: Load State and Identify the Application");
    for (const [name, text] of [
      ["apply.md Step 6b", step6b()],
      ["outcome.md Step 1", outcomeStep1],
    ] as const) {
      expect(text).toContain(`append \`,${lastColumn}\` to the header line`);
    }
  });

  test("step runs before the optional offer that ends the turn", () => {
    const text = read(APPLY);
    expect(text.indexOf("### Step 6b: Record the Application")).toBeLessThan(
      text.indexOf("### Application-Form Fields"),
    );
  });

  test("matched row is never moved backwards", () => {
    expect(step6b()).toContain("never move it backwards");
  });

  test("redraft marker is undated", () => {
    expect(step6b()).toContain("undated `redrafted` marker");
  });

  test("seen_jobs is left alone", () => {
    expect(step6b()).toContain("Do not modify `state/seen_jobs.json`");
  });

  test("skill defers to /apply rather than restating", () => {
    const step3b = section(SKILL, "### Step 3b: Record the Application");
    expect(step3b).toContain("`/apply` Step 6b");
  });
});

describe("drafted means drafted to every reader", () => {
  const CASES: [string, string | null, string][] = [
    [HTML_REPORT, null, "`drafted` → **Drafted**"],
    [HTML_REPORT, "## Step 2: Compute Summary Stats", "excluded from every statistic below"],
    [OUTCOME, "## Step 2b: Follow-Up Branch", "neither final nor `drafted`"],
    [OUTCOME, "## Step 4: Update the Tracker", "overwrite its `date` column with the actual submission date"],
    [GMAIL_SYNC, null, "`drafted` rows stay in this set"],
    [GMAIL_SYNC, "## Step 5", "`drafted` -> `applied`, otherwise"],
    [GMAIL_SYNC, "### Step 7a", "also set `date` to the email's date"],
    [GMAIL_SYNC, "## Step 9: Staleness Check", "Skip `drafted` rows here"],
    [NOTION_SYNC, null, "omit when the status is `drafted`"],
    [NOTION_SYNC, null, "not yet submitted"],
    [SCRAPER, null, "do not add a second row"],
    [APPLY, "### Step 6b: Record the Application", "bare number, 0-100"],
    [APPLY, "### Step 6b: Record the Application", "append a new row"],
  ];

  test("every reader handles drafted", () => {
    for (const [path, heading, needle] of CASES) {
      const haystack = heading ? section(path, heading) : read(path);
      expect(haystack).toContain(needle);
    }
  });
});

describe("/apply archives the posting", () => {
  const CASES: [string, string, string][] = [
    [APPLY, "## Step 0: Parse Input", "full posting text verbatim"],
    [APPLY, "### Step 6b: Record the Application", "`documents/applications/<company>_<role>/job_posting.md`"],
    [APPLY, "### Step 6b: Record the Application", "never a fresh fetch"],
    [APPLY, "### Step 6b: Record the Application", "`/outcome` Step 1.4"],
    [OUTCOME, "## Step 1: Load State and Identify the Application", "4. Derive the archive folder name"],
    [APPLY, "### Step 6b: Record the Application", "**If the file already exists, leave it**"],
    [APPLY, "### Step 6b: Record the Application", "keeps the older posting"],
    [APPLY, "### Step 6b: Record the Application", "left in place rather than written"],
    [APPLY, "### Step 6b: Record the Application", "never reconstruct it from memory"],
    [SKILL, "### Step 1: Research & Evaluate Fit", "full posting text verbatim"],
    [SKILL, "### Step 3b: Record the Application", "same posting archive"],
    [OUTCOME, "## Step 3: Archive the Application Materials", "if it already exists, leave it"],
  ];

  test("posting is archived where every reader looks", () => {
    for (const [path, heading, needle] of CASES) {
      expect(section(path, heading)).toContain(needle);
    }
  });
});

describe("deadline survives every write", () => {
  const CASES: [string, string | null, string][] = [
    [APPLY, "### Step 6b: Record the Application", "append `,deadline` to the header line only"],
    [OUTCOME, "## Step 1: Load State and Identify the Application", "append `,deadline` to the header line only"],
    [APPLY, "## Step 0: Parse Input", "application deadline"],
    [APPLY, "### Step 6b: Record the Application", "Never guess one"],
    [APPLY, "### Step 6b: Record the Application", "leave an existing deadline alone"],
    [OUTCOME, "## Step 1: Load State and Identify the Application", "Deadline urgency"],
    [OUTCOME, "## Step 1: Load State and Identify the Application", "never chased"],
    [OUTCOME, "## Step 4: Update the Tracker", "preserve every other field of the row"],
    [GMAIL_SYNC, "### Step 7a: Write Approved Updates", "preserve every other field"],
    [NOTION_SYNC, null, "**Deadline precedence: the tracker wins too**"],
    [NOTION_SYNC, null, "tracker `deadline` column"],
    [SKILL, "### Step 3b: Record the Application", "`deadline` is the application deadline"],
    [APPLY, "### Step 6b: Record the Application", "no data row is touched"],
    [OUTCOME, "## Step 1: Load State and Identify the Application", "no data row is touched"],
    [APPLY, "### Step 6b: Record the Application", "read as an empty deadline"],
    [OUTCOME, "## Step 1: Load State and Identify the Application", "read as an empty deadline"],
    [OUTCOME, "## Step 1: Load State and Identify the Application", "one edit to an existing tracker"],
    [NOTION_SYNC, null, "never reconcile the two by picking the earlier or later date"],
  ];

  test("deadline survives every write", () => {
    for (const [path, heading, needle] of CASES) {
      const haystack = heading ? section(path, heading) : read(path);
      expect(haystack).toContain(needle);
    }
  });
});

describe("fallback glob finds one role's documents", () => {
  const COMPANY = "Acme";
  const ROLES = ["Data Scientist", "ML Engineer", "ML Engineer II"];

  const CASES: [string, string, string][] = [
    [OUTCOME, "## Step 3: Archive the Application Materials", "by the **Subfolder naming** rule in `documents/README.md`"],
    [OUTCOME, "## Step 3: Archive the Application Materials", "Never widen those globs to the company alone"],
    [INTERVIEW, "## Step 1: Load the Application Context", "by the **Subfolder naming** rule in `documents/README.md`"],
    [INTERVIEW, "## Step 1: Load the Application Context", "Never widen those globs to the company alone"],
  ];

  test("both readers glob the full stem", () => {
    for (const [path, heading, needle] of CASES) {
      expect(section(path, heading)).toContain(needle);
    }
  });

  function globs(path: string, heading: string): string[] {
    const body = section(path, heading);
    const found = [...body.matchAll(/`(cv\/main_[^`]+|cover_letters\/cover_[^`]+)`/g)].map(
      (m) => m[1]!,
    );
    return found.filter((g) => g.includes("*"));
  }

  function fnmatch(pattern: string, name: string): boolean {
    const re = new RegExp(
      "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
    );
    return re.test(name);
  }

  function derive(company: string, role: string): string | null {
    let name = `${company}_${role}`.toLowerCase().split(" ").join("_");
    name = name.replace(/[^\p{L}\p{N}_]/gu, "");
    name = name.replace(/_+/g, "_").replace(/^_|_$/g, "");
    return name || null;
  }

  function resolve(glob: string, role: string): string {
    const stem = derive(COMPANY, role)!;
    const company = derive(COMPANY, "")!.replace(/_$/, "");
    return glob.split("<company>_<role>").join(stem).split("<company>").join(company);
  }

  const draftedFiles = (ext = ".tex") =>
    ROLES.map((r) => `cv/main_${derive(COMPANY, r)}${ext}`);

  test("the cv glob selects the row's own role", () => {
    const onDisk = draftedFiles();
    for (const [path, heading] of [
      [OUTCOME, "## Step 3: Archive the Application Materials"],
      [INTERVIEW, "## Step 1: Load the Application Context"],
    ] as const) {
      const cvGlob = globs(path, heading).find((g) => g.startsWith("cv/"))!;
      for (let i = 0; i < ROLES.length; i++) {
        const hits = onDisk.filter((f) => fnmatch(resolve(cvGlob, ROLES[i]!), f));
        expect(hits).toEqual([onDisk[i]]);
      }
    }
  });

  test("the glob finds a non-tex template", () => {
    const onDisk = draftedFiles(".typ");
    const cvGlob = globs(
      OUTCOME,
      "## Step 3: Archive the Application Materials",
    ).find((g) => g.startsWith("cv/"))!;
    const hits = onDisk.filter((f) => fnmatch(resolve(cvGlob, ROLES[0]!), f));
    expect(hits).toEqual([onDisk[0]]);
  });
});

describe("archive name is one path component", () => {
  const CASES: [string, string, string][] = [
    [DOCS_README, "## applications/", "not a letter, digit or underscore is dropped"],
    [DOCS_README, "## applications/", "single path component"],
    [OUTCOME, "## Step 1: Load State and Identify the Application", "by the **Subfolder naming** rule in `documents/README.md`"],
    [APPLY, "### Requirement coverage (both documents)", "the same rule `/outcome` Step 1.4 uses"],
    [SKILL, "### Step 2: Tailor CV", "by the **Subfolder naming** rule in `documents/README.md`"],
    [GMAIL_SYNC, "## Step 2: Load State", "by the **Subfolder naming** rule in `documents/README.md`"],
    [INTERVIEW, "## Step 1: Load the Application Context", "by the **Subfolder naming** rule in `documents/README.md`"],
    [INTERVIEW, "### 6. Logistics", "archive folder derived in Step 1"],
    [NOTION_SYNC, "## Step 5: Write the Detail Page", "by the **Subfolder naming** rule in `documents/README.md`"],
    [DOCS_README, "## applications/", "If the derived name is empty"],
  ];

  test("the rule has one home and every deriver cites it", () => {
    for (const [path, heading, needle] of CASES) {
      expect(section(path, heading)).toContain(needle);
    }
  });

  function derive(company: string, role: string): string | null {
    let name = `${company}_${role}`.toLowerCase().split(" ").join("_");
    name = name.replace(/[^\p{L}\p{N}_]/gu, "");
    name = name.replace(/_+/g, "_").replace(/^_|_$/g, "");
    return name || null;
  }

  test("documented rule yields a single path component", () => {
    const derivations: [string, string, string | null][] = [
      ["Novo Nordisk A/S", "Data Scientist", "novo_nordisk_as_data_scientist"],
      ["Acme", "Data Scientist / ML Engineer", "acme_data_scientist_ml_engineer"],
      ["Ørsted A/S", "ML Engineer", "ørsted_as_ml_engineer"],
      ["../..", "Data Scientist", "data_scientist"],
      ["../..", "///", null],
    ];
    for (const [company, role, expected] of derivations) {
      const name = derive(company, role);
      expect(name).toBe(expected);
      if (name !== null) {
        expect(name).not.toContain("/");
        expect(name).not.toContain("..");
      }
    }
  });
});
