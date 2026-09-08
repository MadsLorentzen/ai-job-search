import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { filterJobs, renderApplications, renderChecklist, renderJobs, renderTools, statusLabel } from "../../public/src/desk-views.js";

function document() {
  return new Window({ url: "http://127.0.0.1/" }).document;
}

const jobs = [
  { key: "a", title: "Staff Engineer", company: "Acme", location: "Remote", url: "https://jobs.example/a", firstSeen: "2026-09-01", rankScore: 82, rankVerdict: "strong fit", strengths: ["Python"], gaps: [], portal: "linkedin-search", bucket: "new", mark: null },
  { key: "b", title: "Platform Lead", company: "Globex", location: "", url: "", firstSeen: "2026-08-30", rankScore: null, rankVerdict: "", strengths: [], gaps: [], portal: "", bucket: "interested", mark: "interested", fit: "medium" },
  { key: "c", title: "Old", company: "Initech", url: "https://jobs.example/c", rankScore: 20, strengths: [], gaps: ["No Rust"], bucket: "ignored", mark: "ignored" },
  { key: "d", title: "Done", company: "Hooli", url: "https://jobs.example/d", rankScore: 70, strengths: [], gaps: [], bucket: "applied", applicationStatus: "applied" },
];

test("job filters keep the ones worth looking at and search across title, company and place", () => {
  assert.deepEqual(filterJobs(jobs, "open").map((job) => job.key), ["a", "b"]);
  assert.deepEqual(filterJobs(jobs, "ignored").map((job) => job.key), ["c"]);
  assert.deepEqual(filterJobs(jobs, "all", "remote").map((job) => job.key), ["a"]);
  assert.deepEqual(filterJobs(jobs, "all", "globex").map((job) => job.key), ["b"]);
});

test("the jobs list offers Apply and Autofill per row and the right mark actions", () => {
  const doc = document();
  const root = doc.createElement("section");
  renderJobs(root, { jobs, filter: "all" });
  const first = root.querySelector('[data-job-key="a"]');
  assert.ok(first.querySelector("a[target=_blank][rel]"), "the title links out safely");
  assert.ok(first.querySelector('[data-job-action="apply"]'));
  assert.ok(first.querySelector('[data-job-action="autofill"]'));
  assert.ok(first.querySelector('[data-job-action="interested"]'));
  assert.ok(first.textContent.includes("82 / 100"));
  const second = root.querySelector('[data-job-key="b"]');
  assert.equal(second.querySelector('[data-job-action="autofill"]'), null, "no link, no autofill");
  assert.ok(second.querySelector('[data-job-action="unmark"]'));
  const applied = root.querySelector('[data-job-key="d"]');
  assert.equal(applied.querySelector('[data-job-action="apply"]'), null);
  assert.ok(applied.textContent.includes("Applied"));
  assert.equal(root.querySelector('[data-job-filter="open"] .count').textContent, "2");
  renderJobs(root, { jobs: [] });
  assert.ok(root.textContent.includes("No jobs found yet"));
  assert.ok(root.querySelector('[data-action="scrape"]'));
  assert.equal(root.querySelector("[data-sample-job]"), null);
  renderJobs(root, {
    jobs: [],
    sample: { key: "sample:practice", title: "Staff Software Engineer", company: "Northstar Practice Labs", location: "Remote" },
  });
  assert.ok(root.querySelector("[data-sample-job]"));
  assert.ok(root.textContent.includes("Practice"));
  assert.equal(root.querySelector('[data-job-action="apply"]').textContent, "Practice apply");
});

test("applications show status, files, and next actions", () => {
  const doc = document();
  const root = doc.createElement("section");
  renderApplications(root, { applications: [
    { id: "app-1", date: "2026-09-02", company: "Acme", role: "Staff Engineer", status: "applied", open: true, cvFile: "cv/main_acme.pdf", coverLetterFile: "", archive: "documents/applications/Acme_Staff_Engineer", fit: "4", deadline: "" },
    { id: "app-2", date: "2026-08-01", company: "Globex", role: "Lead", status: "no_response", open: false, cvFile: "", coverLetterFile: "", archive: "" },
  ], preview: { path: "cv/main_acme.pdf", kind: "pdf", src: "/workspace-file?path=cv%2Fmain_acme.pdf" } });
  const rows = root.querySelectorAll(".app-row");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dataset.company, "Acme", "newest first");
  assert.ok(rows[0].querySelector('[data-file="cv/main_acme.pdf"]'));
  assert.ok(rows[0].querySelector('[data-reveal]'));
  assert.ok(rows[0].querySelector('[data-app-action="outcome"]'));
  assert.ok(rows[1].textContent.includes("No response"));
  assert.ok(root.querySelector(".file-preview iframe"));
  assert.equal(statusLabel("offer declined"), "Declined");
});

test("the checklist points at the next step and warns about missing tools", () => {
  const html = renderChecklist({
    next: "documents",
    steps: [
      { id: "setup", title: "Set up your profile", done: true, action: "setup", hint: "Done." },
      { id: "documents", title: "Add your CV", done: false, action: "documents", hint: "Optional." },
      { id: "scrape", title: "Find jobs", done: false, action: "scrape", hint: "" },
    ],
  }, { tools: [{ id: "lualatex", name: "TeX (lualatex)", installed: false, requiredFor: "Apply (PDF)" }, { id: "git", name: "Git", installed: false, requiredFor: "optional" }] });
  const doc = document();
  const root = doc.createElement("div");
  root.innerHTML = html;
  assert.equal(root.querySelectorAll("li.done").length, 1);
  assert.equal(root.querySelector("li.current strong").textContent, "Add your CV");
  assert.equal(root.querySelector('[data-checklist-action="documents"]').textContent, "Add files");
  assert.ok(root.querySelector(".tools-warning").textContent.includes("TeX (lualatex)"));
  assert.ok(!root.querySelector(".tools-warning").textContent.includes("Git"));
  assert.ok(root.querySelector("[data-open-tools]"));
});

test("the tools dialog lists each tool with how to get it", () => {
  const doc = document();
  const root = doc.createElement("div");
  renderTools(root, { tools: [
    { id: "bun", name: "Bun", purpose: "Runs searches.", requiredFor: "Find jobs", installed: false, install: "curl -fsSL https://bun.sh/install | bash", url: "https://bun.sh" },
    { id: "python", name: "Python 3", purpose: "Checks PDFs.", requiredFor: "Apply", installed: true },
  ] });
  const items = root.querySelectorAll("li");
  assert.equal(items[0].className, "missing");
  assert.ok(items[0].textContent.includes("bun.sh/install"));
  assert.ok(items[0].querySelector("a[target=_blank]"));
  assert.equal(items[1].className, "ok");
});
