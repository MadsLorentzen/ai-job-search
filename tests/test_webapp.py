"""Offline contract tests for the local Web MVP shell."""

from __future__ import annotations

import json
import base64
import io
import threading
import tempfile
import unittest
import zipfile
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import webapp.server as web_server
from webapp.ai_provider import OpenAICompatibleConfig, build_request, extract_completion_result, load_config, redact_preview
from webapp.server import AppHandler, PAGE_MANIFEST, ai_status_snapshot, applications_snapshot, dashboard_snapshot, extract_resume_fields, extract_resume_file, health_snapshot, materials_snapshot, parse_goal_text, privacy_snapshot, rank_task_snapshot, ranking_snapshot, release_check_snapshot, run_server


class WebAppContractTests(unittest.TestCase):
    @staticmethod
    def _json(response):
        return json.loads(response.read().decode("utf-8"))

    def test_page_manifest_contains_the_five_task_oriented_entries(self):
        ids = [page["id"] for page in PAGE_MANIFEST]
        self.assertEqual(ids, ["today", "jobs", "applications", "profile", "settings"])
        self.assertEqual(PAGE_MANIFEST[0]["path"], "#today")
        self.assertEqual(len({page["path"] for page in PAGE_MANIFEST}), 5)
        self.assertTrue(all(page["description"] for page in PAGE_MANIFEST))

    def test_health_snapshot_is_local_and_does_not_expose_secrets(self):
        health = health_snapshot()
        self.assertEqual(health["safety"]["bind_address"], "127.0.0.1")
        self.assertFalse(health["safety"]["network_requests"])
        self.assertTrue(health["safety"]["writes_enabled"])
        self.assertTrue(health["safety"]["local_draft_writes"])
        self.assertFalse(health["safety"]["external_writes"])
        self.assertFalse(health["safety"]["secrets_exposed"])
        serialized = json.dumps(health, ensure_ascii=False)
        self.assertNotIn("LIEPIN_USER_TOKEN", serialized)

    def test_privacy_snapshot_declares_local_only_permissions(self):
        privacy = privacy_snapshot()
        self.assertEqual(privacy["bind_address"], "127.0.0.1")
        self.assertFalse(privacy["network_requests"])
        self.assertFalse(privacy["credential_access"])
        self.assertFalse(privacy["external_writes"])
        self.assertTrue(any("保存设置草稿" in item for item in privacy["allowed_actions"]))

    def test_rank_task_snapshot_never_claims_web_ai_execution(self):
        task = rank_task_snapshot()
        self.assertIn(task["status"], {"no_jobs", "profile_incomplete", "ready"})
        self.assertFalse(task["web_executes_ai"])
        self.assertEqual(task["web_ai_mode"], "explicit_confirmation_only")
        self.assertEqual(task["ai_execution"], "canonical_rank_workflow")
        self.assertEqual(task["next_command"], "/rank")

    def test_release_check_reports_local_mvp_gate(self):
        check = release_check_snapshot()
        self.assertIn(check["status"], {"pass", "attention"})
        self.assertEqual(check["total"], 8)
        self.assertEqual(check["passed"], sum(1 for item in check["checks"] if item["passed"]))
        self.assertTrue(any(item["id"] == "privacy" and item["passed"] for item in check["checks"]))

    def test_openai_compatible_config_never_exposes_key_and_builds_chat_payload(self):
        config = load_config({"OPENAI_BASE_URL": "https://example.test/v1/", "OPENAI_MODEL": "demo-model", "OPENAI_API_KEY": "secret-key"})
        self.assertTrue(config.configured)
        self.assertEqual(config.base_url, "https://example.test/v1")
        status = ai_status_snapshot()
        self.assertIn("provider", status)
        self.assertNotIn("secret-key", json.dumps(status))
        payload = json.loads(build_request(config, [{"role": "user", "content": "hello"}]).decode("utf-8"))
        self.assertEqual(payload["model"], "demo-model")
        self.assertEqual(payload["response_format"]["type"], "json_object")

    def test_ai_match_requires_explicit_external_confirmation(self):
        connection = self._start_test_server()
        body = json.dumps({"job_text": "Python 后端工程师", "candidate_text": "Python、FastAPI"}, ensure_ascii=False).encode("utf-8")
        connection.request("POST", "/api/ai/match", body, {"Content-Type": "application/json"})
        response = connection.getresponse()
        payload = self._json(response)
        self.assertEqual(response.status, 428)
        self.assertEqual(payload["code"], "EXTERNAL_CONFIRMATION_REQUIRED")
        self.assertTrue(payload["preview"]["external_request"])

    def test_ai_completion_result_is_validated_to_rank_schema(self):
        payload = {"choices": [{"message": {"content": json.dumps({"technical": 80, "experience": 70, "behavioral": 60, "career": 90, "location_verdict": "PASS", "language_gate": "PASS", "strengths": ["Python"], "gaps": ["行业经验"], "summary": "匹配良好"})}}]}
        result = extract_completion_result(payload)
        self.assertEqual(result["overall"], 78)
        self.assertEqual(result["strengths"], ["Python"])

    def test_ai_match_confirmation_calls_provider_and_returns_result(self):
        connection = self._start_test_server()
        expected = {"overall": 88, "technical": 90, "experience": 80, "behavioral": 85, "career": 90, "location_verdict": "PASS", "language_gate": "PASS", "strengths": ["Python"], "gaps": [], "summary": "匹配良好"}
        body = json.dumps({"job_text": "Python 后端工程师", "candidate_text": "Python、FastAPI", "confirm_external": True}, ensure_ascii=False).encode("utf-8")
        with patch.object(web_server, "complete_match", return_value=expected) as mocked:
            connection.request("POST", "/api/ai/match", body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            payload = self._json(response)
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["match"]["overall"], 88)
        mocked.assert_called_once()

    def test_static_shell_contains_task_workbench_and_accessible_consent(self):
        html = (web_server.STATIC_ROOT / "index.html").read_text(encoding="utf-8")
        javascript = (web_server.STATIC_ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn('id="start-ai-match"', html)
        self.assertIn('id="search-form"', html)
        self.assertIn('id="start-rank-task"', html)
        self.assertIn('id="ai-match-status"', html)
        self.assertIn('id="ai-match-result"', html)
        self.assertIn('id="mobile-nav"', html)
        self.assertIn('id="consent-dialog"', html)
        self.assertIn('id="job-detail"', html)
        self.assertNotIn("workspace-tab", html)
        self.assertNotIn("window.confirm", javascript)

    def test_dashboard_has_safe_empty_state(self):
        dashboard = dashboard_snapshot()
        self.assertIn("metrics", dashboard)
        self.assertIn("next_action", dashboard)
        self.assertIn("profile_progress", dashboard)
        self.assertIn("applications", dashboard)
        self.assertIn("materials", dashboard)
        self.assertIn(dashboard["next_action"]["path"], {"#profile", "#jobs", "#applications"})
        self.assertIsInstance(dashboard["pages"], list)

    def test_application_and_material_snapshots_are_read_only_and_schema_tolerant(self):
        with tempfile.TemporaryDirectory() as directory:
            original_tracker = web_server.APPLICATION_TRACKER_FILE
            original_resume = web_server.RESUME_DRAFT_FILE
            original_profile = web_server.PROFILE_FILE
            web_server.APPLICATION_TRACKER_FILE = Path(directory) / "job_search_tracker.csv"
            web_server.RESUME_DRAFT_FILE = Path(directory) / "resume.json"
            web_server.PROFILE_FILE = Path(directory) / "profile.md"
            self.addCleanup(setattr, web_server, "APPLICATION_TRACKER_FILE", original_tracker)
            self.addCleanup(setattr, web_server, "RESUME_DRAFT_FILE", original_resume)
            self.addCleanup(setattr, web_server, "PROFILE_FILE", original_profile)
            web_server.APPLICATION_TRACKER_FILE.write_text("date,company,role,status,fit_rating,deadline\n2026-09-01,示例公司,AI 工程师,interview,82,2026-09-06\n", encoding="utf-8")
            web_server.RESUME_DRAFT_FILE.write_text(json.dumps({"status": "confirmed", "data": {"fields": {"skills": ["Python"]}}}), encoding="utf-8")
            web_server.PROFILE_FILE.write_text("Name: Candidate\nLanguages: Chinese\n", encoding="utf-8")
            applications = applications_snapshot()
            materials = materials_snapshot()
            self.assertEqual(applications["status"], "ready")
            self.assertEqual(applications["counts"]["interview"], 1)
            self.assertEqual(applications["items"][0]["company"], "示例公司")
            self.assertEqual(materials["resume_status"], "confirmed")
            self.assertTrue(materials["profile_ready"])

    def test_server_rejects_non_loopback_bind(self):
        with self.assertRaises(ValueError):
            run_server("0.0.0.0", 8765, open_browser=False)

    def test_http_api_and_static_shell_are_available(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), AppHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def stop_server() -> None:
            server.shutdown()
            thread.join(2)
            server.server_close()

        self.addCleanup(stop_server)
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        for path, content_type in (("/api/pages", "application/json"), ("/api/health", "application/json"), ("/api/privacy", "application/json"), ("/api/applications", "application/json"), ("/api/materials", "application/json"), ("/api/rank/status", "application/json"), ("/api/release-check", "application/json"), ("/api/ai/status", "application/json"), ("/", "text/html")):
            connection.request("GET", path)
            response = connection.getresponse()
            body = response.read().decode("utf-8")
            self.assertEqual(response.status, 200)
            self.assertIn(content_type, response.getheader("Content-Type", ""))
            self.assertEqual(response.getheader("X-Content-Type-Options"), "nosniff")
            self.assertEqual(response.getheader("Referrer-Policy"), "no-referrer")
            self.assertTrue(body)
        connection.request("GET", "/static/../server.py")
        response = connection.getresponse()
        response.read()
        self.assertEqual(response.status, 404)
        connection.close()

    def _start_test_server(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), AppHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def stop_server() -> None:
            server.shutdown()
            thread.join(2)
            server.server_close()

        self.addCleanup(stop_server)
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        self.addCleanup(connection.close)
        return connection

    def test_setup_api_round_trip_is_local_and_persists_only_allowed_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            original = web_server.SETUP_DRAFT_FILE
            web_server.SETUP_DRAFT_FILE = Path(directory) / "setup_draft.json"
            self.addCleanup(setattr, web_server, "SETUP_DRAFT_FILE", original)
            connection = self._start_test_server()

            connection.request("GET", "/api/setup")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(self._json(response)["setup"]["status"], "empty")

            payload = {
                "goal": "北京 Python 后端，20K 以上",
                "cities": ["北京", "上海"],
                "salary_min": 20000,
                "work_mode": ["hybrid", "remote"],
                "platforms": ["zhaopin-search", "boss-search"],
            }
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            connection.request("POST", "/api/setup/draft", body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            saved = self._json(response)
            self.assertEqual(response.status, 200)
            self.assertEqual(saved["setup"]["status"], "draft")
            self.assertEqual(saved["setup"]["data"], payload)
            self.assertTrue(web_server.SETUP_DRAFT_FILE.is_file())

            connection.request("POST", "/api/setup/confirm", body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            confirmed = self._json(response)
            self.assertEqual(response.status, 200)
            self.assertEqual(confirmed["setup"]["status"], "confirmed")

    def test_setup_api_rejects_credentials_unknown_fields_and_wrong_content_type(self):
        with tempfile.TemporaryDirectory() as directory:
            original = web_server.SETUP_DRAFT_FILE
            web_server.SETUP_DRAFT_FILE = Path(directory) / "setup_draft.json"
            self.addCleanup(setattr, web_server, "SETUP_DRAFT_FILE", original)
            connection = self._start_test_server()
            valid = {"goal": "数据工程", "cities": ["北京"], "work_mode": ["onsite"], "platforms": ["zhaopin-search"]}

            for invalid in ({**valid, "token": "should-not-be-accepted"}, {**valid, "unexpected": True}):
                body = json.dumps(invalid).encode("utf-8")
                connection.request("POST", "/api/setup/draft", body, {"Content-Type": "application/json"})
                response = connection.getresponse()
                payload = self._json(response)
                self.assertEqual(response.status, 400)
                self.assertEqual(payload["code"], "BAD_INPUT")
                self.assertFalse(web_server.SETUP_DRAFT_FILE.exists())

            body = json.dumps(valid).encode("utf-8")
            connection.request("POST", "/api/setup/draft", body, {"Content-Type": "text/plain"})
            response = connection.getresponse()
            self.assertEqual(response.status, 400)
            self.assertEqual(self._json(response)["code"], "BAD_INPUT")

    def test_setup_api_rejects_oversized_body_and_invalid_values(self):
        with tempfile.TemporaryDirectory() as directory:
            original = web_server.SETUP_DRAFT_FILE
            web_server.SETUP_DRAFT_FILE = Path(directory) / "setup_draft.json"
            self.addCleanup(setattr, web_server, "SETUP_DRAFT_FILE", original)
            connection = self._start_test_server()

            oversized = json.dumps({"goal": "x" * web_server.MAX_REQUEST_BYTES}).encode("utf-8")
            connection.request("POST", "/api/setup/draft", oversized, {"Content-Type": "application/json"})
            response = connection.getresponse()
            self.assertEqual(response.status, 400)
            self.assertEqual(self._json(response)["code"], "BAD_INPUT")

            invalid = {"goal": "", "cities": [], "salary_min": -1, "work_mode": ["unknown"], "platforms": []}
            body = json.dumps(invalid).encode("utf-8")
            connection.request("POST", "/api/setup/draft", body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            payload = self._json(response)
            self.assertEqual(response.status, 400)
            self.assertGreaterEqual(len(payload["fields"]), 4)
            self.assertFalse(web_server.SETUP_DRAFT_FILE.exists())

    def test_goal_parser_extracts_reviewable_hints_without_writing_state(self):
        parsed, errors = parse_goal_text("北京，Python 后端或数据工程，20K 以上，可接受混合办公")
        self.assertEqual(errors, [])
        self.assertEqual(parsed["raw"], "北京，Python 后端或数据工程，20K 以上，可接受混合办公")
        self.assertEqual(parsed["fields"]["cities"], ["北京"])
        self.assertEqual(parsed["fields"]["roles"], ["Python 后端", "数据工程"])
        self.assertEqual(parsed["fields"]["salary_min"], 20000)
        self.assertEqual(parsed["fields"]["work_mode"], ["hybrid"])
        self.assertEqual(parsed["confidence"], "high")

    def test_goal_parser_marks_missing_or_ambiguous_values_as_pending(self):
        parsed, errors = parse_goal_text("想找数据分析")
        self.assertEqual(errors, [])
        self.assertEqual(parsed["fields"]["roles"], ["数据分析"])
        self.assertIn("请确认目标城市", parsed["pending"])
        self.assertIn("请确认办公方式", parsed["pending"])

    def test_goal_parser_endpoint_is_read_only_and_rejects_extra_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            original = web_server.SETUP_DRAFT_FILE
            web_server.SETUP_DRAFT_FILE = Path(directory) / "setup_draft.json"
            self.addCleanup(setattr, web_server, "SETUP_DRAFT_FILE", original)
            connection = self._start_test_server()
            body = json.dumps({"text": "上海 Java 开发 2万-3万 远程"}, ensure_ascii=False).encode("utf-8")
            connection.request("POST", "/api/setup/parse", body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            payload = self._json(response)
            self.assertEqual(response.status, 200)
            self.assertEqual(payload["parsed"]["fields"]["salary_min"], 20000)
            self.assertEqual(payload["parsed"]["fields"]["salary_max"], 30000)
            self.assertFalse(web_server.SETUP_DRAFT_FILE.exists())

            invalid = json.dumps({"text": "数据工程", "token": "nope"}).encode("utf-8")
            connection.request("POST", "/api/setup/parse", invalid, {"Content-Type": "application/json"})
            response = connection.getresponse()
            self.assertEqual(response.status, 400)

    def test_resume_text_extraction_is_conservative_and_does_not_touch_profile(self):
        text = """张三\nzhangsan@example.com\n13812345678\n\n技术技能\nPython、FastAPI、SQL、Docker\n\n教育经历\n北京大学 硕士 2020-2023\n\n工作经历\n2023-至今 数据工程师"""
        parsed, errors = extract_resume_fields(text, "resume.txt")
        self.assertEqual(errors, [])
        self.assertEqual(parsed["fields"]["name"], "张三")
        self.assertEqual(parsed["fields"]["email"], "zhangsan@example.com")
        self.assertIn("Python", parsed["fields"]["skills"])
        self.assertEqual(parsed["confidence"], "high")

    def test_resume_parser_extracts_chinese_skills_years_languages_and_targets(self):
        text = """王五\nwangwu@example.com\n\n求职意向：AI应用开发\n期望城市：杭州\n期望薪资：22K起\n接受混合办公\n\n6 年工作经验\n核心技能：全栈开发/LLM本地部署/RAG/AGENT/SKILL\n语言能力：CET4\n本科\n"""
        parsed, errors = extract_resume_fields(text, "resume.md")
        self.assertEqual(errors, [])
        fields = parsed["fields"]
        self.assertEqual(fields["work_years"], 6)
        self.assertEqual(fields["languages"], ["CET-4"])
        self.assertTrue({"全栈开发", "LLM 本地部署", "RAG", "Agent", "Skill"}.issubset(set(fields["skills"])))
        self.assertEqual(fields["target_cities"], ["杭州"])
        self.assertEqual(fields["salary_min"], 22000)
        self.assertEqual(fields["work_mode"], ["hybrid"])

    def test_docx_resume_file_parser_extracts_text_locally(self):
        xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>张三</w:t></w:r></w:p><w:p><w:r><w:t>Python CET4</w:t></w:r></w:p></w:body></w:document>'
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("word/document.xml", xml)
        parsed, errors = extract_resume_file(base64.b64encode(stream.getvalue()).decode("ascii"), "resume.docx")
        self.assertEqual(errors, [])
        self.assertEqual(parsed["fields"]["name"], "张三")
        self.assertIn("Python", parsed["fields"]["skills"])

    def test_profile_mapping_requires_confirmed_draft_and_only_replaces_placeholders(self):
        with tempfile.TemporaryDirectory() as directory:
            original_profile = web_server.PROFILE_FILE
            original_resume = web_server.RESUME_DRAFT_FILE
            web_server.PROFILE_FILE = Path(directory) / "profile.md"
            web_server.RESUME_DRAFT_FILE = Path(directory) / "resume_draft.json"
            self.addCleanup(setattr, web_server, "PROFILE_FILE", original_profile)
            self.addCleanup(setattr, web_server, "RESUME_DRAFT_FILE", original_resume)
            web_server.PROFILE_FILE.write_text("Name: [YOUR_NAME]\nEmail: [YOUR_EMAIL]\nSkills: [OTHER_SKILLS]\n", encoding="utf-8")
            web_server.RESUME_DRAFT_FILE.write_text(json.dumps({"status": "confirmed", "data": {"fields": {"name": "张三", "email": "z@example.com", "skills": ["Python"]}}}), encoding="utf-8")
            preview, errors = web_server.profile_mapping_preview()
            self.assertEqual(errors, [])
            self.assertEqual(len(preview["changes"]), 3)
            result, errors = web_server.apply_profile_mapping()
            self.assertEqual(errors, [])
            self.assertIn("张三", web_server.PROFILE_FILE.read_text(encoding="utf-8"))
            self.assertTrue(Path(result["backup"]).is_file())

    def test_rank_endpoint_supports_filters(self):
        with tempfile.TemporaryDirectory() as directory:
            original = web_server.STATE_FILE
            web_server.STATE_FILE = Path(directory) / "seen_jobs.json"
            self.addCleanup(setattr, web_server, "STATE_FILE", original)
            web_server.STATE_FILE.write_text(json.dumps({"seen": {"a": {"title": "低", "portal": "zhaopin-search", "status": "ranked", "rank_score": 55}, "b": {"title": "高", "portal": "liepin-search", "status": "ranked", "rank_score": 85}}}), encoding="utf-8")
            snapshot = ranking_snapshot(100, portal="liepin-search", min_score=80)
            self.assertEqual([item["title"] for item in snapshot["jobs"]], ["高"])

    def test_ai_preview_masks_contact_values_and_never_uses_url_data(self):
        preview = redact_preview("张三 zhang@example.com 13812345678")
        self.assertNotIn("zhang@example.com", preview)
        self.assertNotIn("13812345678", preview)
        self.assertIn("邮箱已脱敏", preview)

    def test_setup_completeness_and_templates_are_local(self):
        with tempfile.TemporaryDirectory() as directory:
            original = web_server.SETUP_DRAFT_FILE
            web_server.SETUP_DRAFT_FILE = Path(directory) / "setup.json"
            self.addCleanup(setattr, web_server, "SETUP_DRAFT_FILE", original)
            self.assertFalse(web_server.setup_completeness("search")["complete"])
            self.assertGreaterEqual(len(web_server.setup_templates()["templates"]), 2)

    def test_search_start_rejects_unsupported_platform_without_network(self):
        connection = self._start_test_server()
        body = json.dumps({"query": "AI 应用开发", "cities": ["杭州"], "platforms": ["unknown"]}).encode("utf-8")
        connection.request("POST", "/api/search/start", body, {"Content-Type": "application/json"})
        response = connection.getresponse()
        self.assertEqual(response.status, 400)
        self.assertEqual(self._json(response)["code"], "BAD_INPUT")

    def test_search_start_creates_task_and_task_can_be_read(self):
        with patch.object(web_server, "subprocess") as subprocess_module:
            completed = type("Completed", (), {"returncode": 0, "stdout": json.dumps({"results": [{"id": "1", "title": "AI 工程师", "company": "示例", "url": "https://example.com/job/1", "portal": "zhaopin-search"}]}), "stderr": ""})()
            subprocess_module.run.return_value = completed
            with tempfile.TemporaryDirectory() as directory:
                original = web_server.STATE_FILE
                web_server.STATE_FILE = Path(directory) / "seen_jobs.json"
                self.addCleanup(setattr, web_server, "STATE_FILE", original)
                connection = self._start_test_server()
                body = json.dumps({"query": "AI 应用开发", "cities": ["杭州"], "platforms": ["zhaopin-search"], "limit": 3}).encode("utf-8")
                connection.request("POST", "/api/search/start", body, {"Content-Type": "application/json"})
                response = connection.getresponse()
                self.assertEqual(response.status, 202)
                task = self._json(response)["task"]
                task_id = task["id"]
                for _ in range(20):
                    connection.request("GET", f"/api/tasks/{task_id}")
                    result = self._json(connection.getresponse())["task"]
                    if result["status"] in {"completed", "failed", "cancelled"}:
                        break
                self.assertEqual(result["status"], "completed")
                self.assertEqual(result["found"], 1)
                self.assertTrue(web_server.STATE_FILE.is_file())

    def test_rank_run_requires_external_confirmation(self):
        connection = self._start_test_server()
        body = json.dumps({"confirm_external": False}).encode("utf-8")
        connection.request("POST", "/api/rank/run", body, {"Content-Type": "application/json"})
        response = connection.getresponse()
        self.assertEqual(response.status, 428)
        self.assertEqual(self._json(response)["code"], "EXTERNAL_CONFIRMATION_REQUIRED")

    def test_rank_run_persists_confirmed_ai_result_to_seen_jobs(self):
        with tempfile.TemporaryDirectory() as directory:
            original_state = web_server.STATE_FILE
            original_resume = web_server.RESUME_DRAFT_FILE
            web_server.STATE_FILE = Path(directory) / "seen_jobs.json"
            web_server.RESUME_DRAFT_FILE = Path(directory) / "resume_draft.json"
            self.addCleanup(setattr, web_server, "STATE_FILE", original_state)
            self.addCleanup(setattr, web_server, "RESUME_DRAFT_FILE", original_resume)
            web_server.STATE_FILE.write_text(json.dumps({"seen": {"job": {"title": "AI 工程师", "company": "示例", "url": "https://example.com/job/1", "status": "new"}}}), encoding="utf-8")
            web_server.RESUME_DRAFT_FILE.write_text(json.dumps({"status": "confirmed", "data": {"fields": {"skills": ["Python"]}}}), encoding="utf-8")
            expected = {"overall": 86, "technical": 88, "experience": 82, "behavioral": 84, "career": 90, "location_verdict": "PASS", "language_gate": "PASS", "strengths": ["Python"], "gaps": [], "summary": "匹配"}
            connection = self._start_test_server()
            with patch.object(web_server, "complete_match", return_value=expected):
                body = json.dumps({"confirm_external": True, "limit": 1}).encode("utf-8")
                connection.request("POST", "/api/rank/run", body, {"Content-Type": "application/json"})
                response = connection.getresponse()
                self.assertEqual(response.status, 202)
                task_id = self._json(response)["task"]["id"]
                for _ in range(20):
                    connection.request("GET", f"/api/tasks/{task_id}")
                    task = self._json(connection.getresponse())["task"]
                    if task["status"] in {"completed", "failed", "cancelled"}:
                        break
            state = json.loads(web_server.STATE_FILE.read_text(encoding="utf-8"))
            self.assertEqual(task["status"], "completed")
            self.assertEqual(state["seen"]["job"]["rank_score"], 86)
            self.assertEqual(state["seen"]["job"]["status"], "ranked")

    def test_resume_endpoint_requires_text_and_only_confirms_local_review_data(self):
        with tempfile.TemporaryDirectory() as directory:
            original = web_server.RESUME_DRAFT_FILE
            web_server.RESUME_DRAFT_FILE = Path(directory) / "resume_draft.json"
            self.addCleanup(setattr, web_server, "RESUME_DRAFT_FILE", original)
            connection = self._start_test_server()
            body = json.dumps({"filename": "resume.txt", "text": "李四\nlisi@example.com\nPython\n"}, ensure_ascii=False).encode("utf-8")
            connection.request("POST", "/api/resume/parse", body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            payload = self._json(response)
            self.assertEqual(response.status, 200)
            self.assertEqual(payload["resume"]["status"], "review")
            self.assertFalse(web_server.RESUME_DRAFT_FILE.exists())

            connection.request("POST", "/api/resume/confirm", body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(self._json(response)["resume"]["status"], "confirmed")
            self.assertTrue(web_server.RESUME_DRAFT_FILE.is_file())

            invalid = json.dumps({"filename": "resume.pdf", "text": "李四"}).encode("utf-8")
            connection.request("POST", "/api/resume/parse", invalid, {"Content-Type": "application/json"})
            response = connection.getresponse()
            self.assertEqual(response.status, 400)

    def test_ranking_snapshot_is_safe_sorted_and_read_only(self):
        with tempfile.TemporaryDirectory() as directory:
            original = web_server.STATE_FILE
            web_server.STATE_FILE = Path(directory) / "seen_jobs.json"
            self.addCleanup(setattr, web_server, "STATE_FILE", original)
            web_server.STATE_FILE.write_text(json.dumps({"seen": {
                "a": {"title": "低分职位", "company": "甲", "rank_score": 52, "status": "ranked", "url": "https://example.com/a", "strengths": ["Python"]},
                "b": {"title": "新职位", "company": "乙", "status": "new", "url": "https://example.com/b"},
                "c": {"title": "高分职位", "company": "丙", "rank_score": 88, "status": "ranked", "url": "https://example.com/c", "gaps": ["经验待确认"]},
            }}, ensure_ascii=False), encoding="utf-8")
            snapshot = ranking_snapshot()
            self.assertEqual(snapshot["status"], "ready")
            self.assertEqual([job["title"] for job in snapshot["jobs"]], ["高分职位", "低分职位", "新职位"])
            self.assertEqual(snapshot["counts"]["ranked"], 2)
            self.assertEqual(snapshot["jobs"][0]["strengths"], [])
            self.assertEqual(snapshot["jobs"][1]["strengths"], ["Python"])

    def test_import_job_endpoint_uses_local_importer_and_returns_record(self):
        with tempfile.TemporaryDirectory() as directory:
            original_state = web_server.STATE_FILE
            original_archive = web_server.IMPORT_ARCHIVE_DIR
            web_server.STATE_FILE = Path(directory) / "seen_jobs.json"
            web_server.IMPORT_ARCHIVE_DIR = Path(directory) / "postings"
            self.addCleanup(setattr, web_server, "STATE_FILE", original_state)
            self.addCleanup(setattr, web_server, "IMPORT_ARCHIVE_DIR", original_archive)
            connection = self._start_test_server()
            payload = {"url": "https://www.zhipin.com/job_detail/abc123", "portal": "auto", "text": "职位名称：Python 后端工程师\n公司名称：示例科技\n工作地点：北京\n薪资：20-30K"}
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            connection.request("POST", "/api/import/job", body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            result = self._json(response)
            self.assertEqual(response.status, 200)
            self.assertEqual(result["import"]["record"]["portal"], "boss-search")
            self.assertTrue(Path(result["import"]["archive_path"]).is_file())
            state = json.loads(web_server.STATE_FILE.read_text(encoding="utf-8"))
            self.assertEqual(len(state["seen"]), 1)

    def test_import_job_endpoint_rejects_listing_urls_and_extra_fields(self):
        connection = self._start_test_server()
        for payload in (
            {"url": "https://www.zhipin.com/web/geek/job", "text": "职位名称：后端"},
            {"url": "https://www.zhipin.com/job_detail/abc123", "text": "职位名称：后端", "token": "nope"},
        ):
            body = json.dumps(payload).encode("utf-8")
            connection.request("POST", "/api/import/job", body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            self.assertEqual(response.status, 400)


if __name__ == "__main__":
    unittest.main()
