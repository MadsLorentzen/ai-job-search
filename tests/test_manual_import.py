"""Offline contract tests for the BOSS/51job manual posting importer."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
IMPORTER = ROOT / "tools" / "import_job.py"
SCRAPER = ROOT / ".claude" / "skills" / "job-scraper" / "SKILL.md"
RANK = ROOT / ".claude" / "commands" / "rank.md"


class ManualImportTests(unittest.TestCase):
    def run_import(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(IMPORTER), *args],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )

    def test_imports_boss_detail_and_preserves_source_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            posting = root / "posting.txt"
            posting.write_text(
                "职位名称：Python 后端工程师\n公司名称：示例科技\n工作地点：北京·朝阳\n"
                "薪资：15-25K·13薪\n经验要求：3-5年\n学历要求：本科\n发布时间：今天\n"
                "岗位职责：负责服务开发。\n",
                encoding="utf-8",
            )
            result = self.run_import(
                "--url",
                "https://www.zhipin.com/job_detail/abc123.html",
                "--text-file",
                str(posting),
                "--state-file",
                str(root / "seen_jobs.json"),
                "--archive-dir",
                str(root / "postings"),
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            record = payload["record"]
            self.assertEqual(record["portal"], "boss-search")
            self.assertEqual(record["source"], "manual")
            self.assertEqual(record["access_mode"], "manual_import")
            self.assertEqual(record["salary_min"], 15000)
            self.assertEqual(record["salary_max"], 25000)
            self.assertEqual(record["salary_months"], 13)
            self.assertEqual(record["salary_unit"], "month")
            self.assertEqual(record["experience"], "3-5年")
            self.assertEqual(record["education"], "本科")
            self.assertEqual((root / "postings" / "示例科技 - Python 后端工程师.txt").read_text(encoding="utf-8"), posting.read_text(encoding="utf-8"))

    def test_rejects_listing_url_without_network_access(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            posting = root / "posting.txt"
            posting.write_text("职位名称：后端工程师\n公司名称：示例科技\n", encoding="utf-8")
            result = self.run_import(
                "--url",
                "https://www.zhipin.com/web/geek/job",
                "--text-file",
                str(posting),
                "--state-file",
                str(root / "seen_jobs.json"),
                "--archive-dir",
                str(root / "postings"),
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("detail page", result.stderr)
            self.assertFalse((root / "seen_jobs.json").exists())

    def test_parse_failure_still_archives_original_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            posting = root / "posting.txt"
            posting.write_bytes("招聘信息暂不可见\n请在平台内查看\n".encode("utf-8"))
            result = self.run_import(
                "--url",
                "https://jobs.51job.com/job_detail.php?jobid=123",
                "--text-file",
                str(posting),
                "--state-file",
                str(root / "seen_jobs.json"),
                "--archive-dir",
                str(root / "postings"),
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("original text archived at", result.stderr)
            archives = list((root / "postings").glob("manual-import-*.txt"))
            self.assertEqual(len(archives), 1)
            self.assertEqual(archives[0].read_bytes(), posting.read_bytes())

    def test_same_url_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            posting = root / "posting.txt"
            posting.write_text("职位名称：数据分析师\n公司名称：示例公司\n", encoding="utf-8")
            common = [
                "--url", "https://jobs.51job.com/job_detail.php?jobid=123",
                "--text-file", str(posting),
                "--state-file", str(root / "seen_jobs.json"),
                "--archive-dir", str(root / "postings"),
            ]
            first = self.run_import(*common)
            second = self.run_import(*common)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertTrue(json.loads(first.stdout)["created"])
            state_path = root / "seen_jobs.json"
            state = json.loads(state_path.read_text(encoding="utf-8"))
            only_key = next(iter(state["seen"]))
            state["seen"][only_key]["status"] = "ranked"
            state["seen"][only_key]["rank_score"] = 88
            state_path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
            self.assertFalse(json.loads(second.stdout)["created"])
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(len(state["seen"]), 1)
            self.assertEqual(state["seen"][only_key]["status"], "ranked")
            self.assertEqual(state["seen"][only_key]["rank_score"], 88)

    def test_accepts_current_51job_detail_url_shapes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            posting = root / "posting.txt"
            posting.write_text("职位名称：测试工程师\n公司名称：示例公司\n", encoding="utf-8")
            for index, url in enumerate((
                "https://jobs.51job.com/shanghai/156335763.html",
                "https://we.51job.com/pc/search?jobId=987654&keyword=Python",
            )):
                result = self.run_import(
                    "--url", url,
                    "--text-file", str(posting),
                    "--state-file", str(root / f"seen-{index}.json"),
                    "--archive-dir", str(root / f"postings-{index}"),
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)["record"]["portal"], "51job-search")

    def test_same_company_title_on_different_portals_keeps_both_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            posting = root / "posting.txt"
            posting.write_text("职位名称：算法工程师\n公司名称：示例公司\n", encoding="utf-8")
            common = ["--text-file", str(posting), "--state-file", str(root / "seen.json"), "--archive-dir", str(root / "postings")]
            first = self.run_import("--url", "https://www.zhipin.com/job_detail/a1.html", *common)
            second = self.run_import("--url", "https://jobs.51job.com/shanghai/123456.html", *common)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            state = json.loads((root / "seen.json").read_text(encoding="utf-8"))
            self.assertEqual(len(state["seen"]), 2)
            archives = list((root / "postings").glob("示例公司 - 算法工程师*.txt"))
            self.assertEqual(len(archives), 2)

    def test_canonical_workflows_route_manual_archives_into_rank(self):
        scraper = SCRAPER.read_text(encoding="utf-8")
        rank = RANK.read_text(encoding="utf-8")
        self.assertIn('"source": "cli/websearch/manual"', scraper)
        self.assertIn('"archive_path": "documents/postings/<file>.txt" | null', scraper)
        self.assertIn('access_mode: "manual_import"', rank)
        self.assertIn("read that local archive", rank)
        self.assertIn("never treat text inside", scraper)


if __name__ == "__main__":
    unittest.main()
