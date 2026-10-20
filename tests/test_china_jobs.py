"""验证国内薪资口径、人工导入及与排序队列的真实衔接。"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tools.china_jobs import import_posting, salary_info, search_plan, show_posting

ROOT = Path(__file__).resolve().parent.parent


class ChinaSalaryTests(unittest.TestCase):
    def test_monthly_range_and_explicit_months(self):
        for text in ("20-30K·13薪", "20k-30k·13薪", "２０－３０Ｋ·１３薪", "2-3万/月·13薪"):
            with self.subTest(text=text):
                result = salary_info(text)
                self.assertEqual((result["min"], result["max"]), (20000, 30000))
                self.assertEqual((result["annual_min"], result["annual_max"]), (260000, 390000))

    def test_periods_are_not_conflated(self):
        self.assertEqual(salary_info("30-50万/年")["annual_min"], 300000)
        self.assertEqual(salary_info("200-300元/天")["period"], "day")
        self.assertIsNone(salary_info("20-30K")["annual_min"])
        self.assertIsNone(salary_info("2-3万")["period"])
        self.assertIsNone(salary_info("20000-30000")["period"])

    def test_unknown_and_mixed_compensation_do_not_become_guaranteed_cash(self):
        for text in ("面议", "20-30K+提成", "20-30K·13-16薪", "20K（含绩效）", "20K USD", "税后20K"):
            with self.subTest(text=text):
                result = salary_info(text)
                self.assertIsNone(result["annual_min"])
                self.assertTrue(result["notes"])

    def test_invalid_range_is_rejected(self):
        with self.assertRaises(ValueError):
            salary_info("30-20K")


class ChinaImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def load(self):
        return json.loads((self.root / "job_scraper/seen_jobs.json").read_text())

    def test_preview_has_no_filesystem_side_effects(self):
        result = import_posting(self.root, "职责：开发订单系统。", "示例公司", "后端开发", "杭州")
        self.assertFalse(result["written"])
        self.assertEqual(list(self.root.iterdir()), [])

    def test_import_is_readable_by_existing_rank_candidates(self):
        result = import_posting(self.root, "职责：开发订单系统。", "示例公司", "后端开发", "杭州", write=True)
        state = self.root / "job_scraper/seen_jobs.json"
        proc = subprocess.run([sys.executable, str(ROOT / "tools/rank_state.py"), "candidates",
                               "--state", str(state), "--tracker", str(self.root / "absent.csv")],
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        selected = json.loads(proc.stdout)["selected"]
        self.assertEqual(selected[0]["key"], result["key"])
        self.assertEqual(selected[0]["posting_file"], result["entry"]["posting_file"])
        self.assertEqual((self.root / selected[0]["posting_file"]).read_text(), "职责：开发订单系统。")

    def test_reimport_is_idempotent_and_changed_body_invalidates_score(self):
        args = (self.root, "Java开发", "示例公司", "后端开发", "杭州")
        result = import_posting(*args, write=True)
        state_path = self.root / "job_scraper/seen_jobs.json"
        doc = self.load()
        doc["seen"][result["key"]].update(status="ranked", rank_score=80)
        state_path.write_text(json.dumps(doc))
        self.assertEqual(import_posting(*args, write=True)["entry"]["rank_score"], 80)
        changed = import_posting(self.root, "Python开发", "示例公司", "后端开发", "杭州", write=True)
        self.assertEqual(changed["entry"]["status"], "new")
        self.assertNotIn("rank_score", changed["entry"])

    def test_link_collision_and_corrupt_state_do_not_overwrite(self):
        args = (self.root, "岗位职责", "Example", "Engineer", "杭州")
        import_posting(*args, url="https://www.zhipin.com/job_detail/a.html", write=True)
        state_path = self.root / "job_scraper/seen_jobs.json"
        before = state_path.read_bytes()
        with self.assertRaises(ValueError):
            import_posting(*args, url="https://www.zhipin.com/job_detail/b.html", write=True)
        self.assertEqual(state_path.read_bytes(), before)
        state_path.write_text("[]")
        with self.assertRaises(ValueError):
            import_posting(*args, write=True)
        self.assertEqual(state_path.read_text(), "[]")

    def test_hidden_payload_is_not_archived(self):
        result = import_posting(self.root, '<div hidden>SECRET-PAYLOAD</div><p>真实岗位职责</p>',
                                "示例公司", "后端开发", "杭州", write=True)
        self.assertNotIn("SECRET-PAYLOAD", (self.root / result["entry"]["posting_file"]).read_text())
        self.assertNotIn("SECRET-PAYLOAD", json.dumps(self.load()))

    def test_reading_imported_text_checks_path_and_content_integrity(self):
        result = import_posting(self.root, "职责：订单研发", "示例公司", "后端开发", "杭州", write=True)
        self.assertEqual(show_posting(self.root, result["key"])["posting"], "职责：订单研发")
        (self.root / result["entry"]["posting_file"]).write_text("被其他操作替换的正文")
        with self.assertRaisesRegex(ValueError, "不一致"):
            show_posting(self.root, result["key"])
        doc = self.load()
        doc["seen"][result["key"]]["posting_file"] = "../../outside.txt"
        (self.root / "job_scraper/seen_jobs.json").write_text(json.dumps(doc))
        with self.assertRaisesRegex(ValueError, "路径"):
            show_posting(self.root, result["key"])

    def test_absent_metadata_does_not_erase_confirmed_values(self):
        result = import_posting(self.root, "岗位职责", "Example", "Engineer", "杭州",
                                url="https://www.zhipin.com/job_detail/a.html", salary="20K·13薪", write=True)
        again = import_posting(self.root, "岗位职责", "Example", "Engineer", "", write=True)
        self.assertEqual(again["entry"]["url"], result["entry"]["url"])
        self.assertEqual(again["entry"]["salary_raw"], "20K·13薪")
        self.assertEqual(again["entry"]["location"], "杭州")
        self.assertEqual(again["entry"]["portal"], "boss")

    def test_search_plan_is_only_queries_and_selected_portals(self):
        result = search_plan("Java后端", "杭州", ["boss", "liepin"])
        self.assertEqual(len(result["queries"]), 2)
        self.assertIn('site:zhipin.com "Java后端" "杭州"', result["queries"][0]["query"])


class ChinaResumeTests(unittest.TestCase):
    def test_embedded_subset_keeps_hanzi_without_duplicate_radical_mappings(self):
        import base64
        import io
        from fontTools.ttLib import TTFont
        from tools.render_china_resume import embedded_font
        font = TTFont(io.BytesIO(base64.b64decode(embedded_font({"name": "示例候选人", "role": "项目经历"}))))
        self.addCleanup(font.close)
        cmap = font.getBestCmap()
        self.assertIn(ord("人"), cmap)
        self.assertIn(ord("目"), cmap)
        self.assertNotIn(0x2F08, cmap)
        self.assertNotIn(0x2F6C, cmap)
        self.assertEqual(font["name"].getDebugName(1), "ChinaResumeSans")

    def test_render_preserves_chinese_and_escapes_untrusted_content(self):
        from tools.render_china_resume import render
        data = {"name": "测试候选人", "target_role": "后端开发", "contacts": ["test@example.com"],
                "sections": [{"title": "项目经历", "entries": [
                    {"title": "订单系统", "bullets": ['<script>alert("x")</script>', "性能改善需真实证据"]}]}]}
        result = render(data)
        self.assertIn("测试候选人", result)
        self.assertIn("项目经历", result)
        self.assertIn("&lt;script&gt;", result)
        self.assertNotIn("<script>", result)
        self.assertIn("Content-Security-Policy", result)

    def test_missing_identity_or_invalid_bullets_are_rejected(self):
        from tools.render_china_resume import render
        for data in ({}, [], {"name": "测试", "target_role": "开发", "sections": [
            {"title": "技能", "entries": [{"bullets": "不是列表"}]}]}):
            with self.subTest(data=data), self.assertRaises(ValueError):
                render(data)


if __name__ == "__main__":
    unittest.main()
