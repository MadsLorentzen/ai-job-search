"""Every seen_jobs.json reference in the scrape/rank/notion-sync/upskill specs names the full path.

Step 0 reads `job_scraper/seen_jobs.json`, but later steps (notably Step 4,
where the file is written) used the bare filename. An agent following Step 4
literally can create `seen_jobs.json` in the repo root. The ignore rules only
cover `**/job_scraper/seen_jobs.json`, so a root-level copy is untracked-by-rule
only by accident: it shows up in `git status`, gets swept into a commit, and
publishes the user's scrape history. Pinning the full path in the spec keeps
the read path, the write path and the ignore rule pointing at the same file.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# /scrape writes the file; the others read it. A bare name in a reader spec is the
# same trap: an agent asked to "read seen_jobs.json" looks in the repo root first.
SPECS = [
    ROOT / ".claude" / "skills" / "job-scraper" / "SKILL.md",
    ROOT / ".claude" / "commands" / "rank.md",
    ROOT / ".claude" / "commands" / "notion-sync.md",
    ROOT / ".claude" / "skills" / "upskill" / "SKILL.md",
]
BARE = re.compile(r"(?<!job_scraper/)(?<![\w/.-])seen_jobs\.json")


class ScrapeSeenJobsPathSpec(unittest.TestCase):
    def test_no_bare_seen_jobs_reference(self):
        for spec in SPECS:
            with self.subTest(spec=spec.relative_to(ROOT).as_posix()):
                offenders = [
                    f"line {i}: {line.strip()[:90]}"
                    for i, line in enumerate(spec.read_text(encoding="utf-8").splitlines(), 1)
                    if BARE.search(line)
                ]
                self.assertEqual(offenders, [], "use job_scraper/seen_jobs.json everywhere in the spec")


if __name__ == "__main__":
    unittest.main()
