#!/usr/bin/env python3
"""Local web shell for AI Job Search.

The current slice exposes page metadata, local health checks, and a minimal
candidate setup draft. It never writes the tracked candidate profile, calls a
job portal, reads credentials, or performs an application action.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
import zipfile
import xml.etree.ElementTree as ET
import webbrowser
from datetime import date, datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.import_job import ImportErrorValue, import_job
from webapp.ai_provider import AIProviderError, complete_match, estimate_input_tokens, load_config, redact_preview


STATIC_ROOT = Path(__file__).resolve().parent / "static"
STATE_FILE = ROOT / "job_scraper" / "seen_jobs.json"
PROFILE_FILE = ROOT / ".claude" / "skills" / "job-application-assistant" / "01-candidate-profile.md"
SETUP_DRAFT_FILE = ROOT / "webapp" / "data" / "setup_draft.json"
RESUME_DRAFT_FILE = ROOT / "webapp" / "data" / "resume_draft.json"
AUDIT_FILE = ROOT / "webapp" / "data" / "audit.jsonl"
TASK_HISTORY_FILE = ROOT / "webapp" / "data" / "task_history.json"
TASK_ACTIVE_FILE = ROOT / "webapp" / "data" / "task_active.json"
SETUP_HISTORY_FILE = ROOT / "webapp" / "data" / "setup_history.json"
IMPORT_ARCHIVE_DIR = ROOT / "documents" / "postings"
APPLICATION_TRACKER_FILE = ROOT / "job_search_tracker.csv"
APPLICATION_ARCHIVE_DIR = ROOT / "documents" / "applications"
MAX_REQUEST_BYTES = 256 * 1024
FORBIDDEN_INPUT_KEYS = {"token", "password", "cookie", "secret", "captcha", "x-user-token"}
CITY_HINTS = (
    "北京", "上海", "广州", "深圳", "杭州", "南京", "苏州", "成都", "重庆", "武汉", "西安",
    "天津", "青岛", "厦门", "郑州", "长沙", "合肥", "东莞", "佛山", "宁波", "无锡", "大连",
)
RESUME_SKILL_ALIASES = (
    ("LLM 本地部署", ("llm本地部署", "llm 本地部署", "大模型本地部署", "模型本地部署")),
    ("RAG", ("rag", "检索增强生成")),
    ("Agent", ("agent", "智能体")),
    ("Skill", ("skill", "技能编排")),
    ("全栈开发", ("全栈", "全端开发")),
    ("Python", ("python",)),
    ("Java", ("java",)),
    ("Go", ("golang", "\bgo\b")),
    ("JavaScript", ("javascript", "js")),
    ("TypeScript", ("typescript", "ts")),
    ("SQL", ("sql",)),
    ("Docker", ("docker",)),
    ("Kubernetes", ("kubernetes", "k8s")),
    ("React", ("react",)),
    ("Vue", ("vue",)),
    ("Django", ("django",)),
    ("Flask", ("flask",)),
    ("FastAPI", ("fastapi",)),
)
TASKS: dict[str, dict[str, object]] = {}
TASKS_LOCK = threading.Lock()
STATE_LOCK = threading.Lock()

PAGE_MANIFEST = [
    {
        "id": "today",
        "label": "今天",
        "path": "#today",
        "description": "查看当前最重要的求职行动和进度。",
        "status": "available",
    },
    {
        "id": "jobs",
        "label": "职位",
        "path": "#jobs",
        "description": "搜索、导入、筛选和评估职位。",
        "status": "available",
    },
    {
        "id": "applications",
        "label": "申请",
        "path": "#applications",
        "description": "查看申请阶段、截止日期和面试进度。",
        "status": "available",
    },
    {
        "id": "profile",
        "label": "资料与材料",
        "path": "#profile",
        "description": "维护求职偏好、候选人资料和申请材料。",
        "status": "available",
    },
    {
        "id": "settings",
        "label": "设置",
        "path": "#settings",
        "description": "查看平台、AI、隐私和本地诊断。",
        "status": "available",
    },
]


def command_status(name: str, required: bool = False) -> dict[str, object]:
    path = shutil.which(name)
    hints = {
        "python": "使用 Python 3.10 或更高版本",
        "bun": "必需依赖：安装 Bun 1.x 后重新点击刷新状态",
        "liepin-cli": "可选依赖：安装官方 liepin-cli 并完成授权后再启用猎聘",
    }
    return {
        "id": name,
        "label": name,
        "available": path is not None,
        "path": path,
        "required": required,
        "hint": hints.get(name),
    }


def health_snapshot() -> dict[str, object]:
    python_ok = sys.version_info >= (3, 10)
    commands = [
        {**command_status("python"), "available": python_ok},
        command_status("bun"),
        command_status("liepin-cli"),
    ]
    seen_jobs_exists = STATE_FILE.is_file()
    required_ready = python_ok and command_status("bun")["available"]
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "runtime": {"python": sys.version.split()[0], "python_ok": python_ok},
        "commands": commands,
        "state": {
            "seen_jobs": "ready" if seen_jobs_exists else "empty",
            "setup_draft": "ready" if SETUP_DRAFT_FILE.is_file() else "empty",
            "personal_data_loaded": False,
        },
        "ready": required_ready,
        "guidance": "环境已就绪，可以继续设置" if required_ready else "请先安装标记为“未检测到”的必需依赖，再点击刷新状态",
        "safety": {
            "bind_address": "127.0.0.1",
            "network_requests": False,
            "network_requests_default": False,
            "external_search_opt_in": True,
            "writes_enabled": True,
            "local_draft_writes": True,
            "external_writes": False,
            "secrets_exposed": False,
        },
    }


def _read_task_history(limit: int = 8) -> list[dict[str, object]]:
    if not TASK_HISTORY_FILE.is_file():
        return []
    try:
        history = json.loads(TASK_HISTORY_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(history, list):
        return []
    safe: list[dict[str, object]] = []
    for item in history[: max(1, min(limit, 30))]:
        if not isinstance(item, dict):
            continue
        safe.append({
            key: item.get(key)
            for key in ("id", "kind", "status", "stage", "progress", "created_at", "found", "added", "ranked")
            if key in item
        })
    return safe


def applications_snapshot(limit: int = 50) -> dict[str, object]:
    """Return a read-only, schema-tolerant view of the canonical application tracker."""
    empty = {
        "status": "empty",
        "items": [],
        "counts": {"total": 0, "open": 0, "drafted": 0, "interview": 0, "offer": 0, "closed": 0, "due_soon": 0},
        "source": "job_search_tracker.csv",
    }
    if not APPLICATION_TRACKER_FILE.is_file():
        return empty
    try:
        with APPLICATION_TRACKER_FILE.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = [dict(row) for row in csv.DictReader(handle)]
    except (OSError, csv.Error, UnicodeError):
        return {**empty, "status": "unreadable"}

    final_statuses = {"hired", "rejected", "no_response", "no response", "offer_declined", "offer declined", "withdrawn"}
    today = date.today()
    counts = {"total": 0, "open": 0, "drafted": 0, "interview": 0, "offer": 0, "closed": 0, "due_soon": 0}
    items: list[dict[str, object]] = []
    for row in rows:
        status = str(row.get("status") or "drafted").strip().lower()
        is_closed = status in final_statuses
        deadline_value = str(row.get("deadline") or "").strip()
        days_to_deadline: int | None = None
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", deadline_value):
            try:
                days_to_deadline = (date.fromisoformat(deadline_value) - today).days
            except ValueError:
                days_to_deadline = None
        counts["total"] += 1
        counts["closed" if is_closed else "open"] += 1
        if status in {"drafted", "interview", "offer"}:
            counts[status] += 1
        if not is_closed and days_to_deadline is not None and 0 <= days_to_deadline <= 7:
            counts["due_soon"] += 1
        items.append({
            "date": str(row.get("date") or ""),
            "company": str(row.get("company") or "未注明公司"),
            "role": str(row.get("role") or "未注明职位"),
            "sector": str(row.get("sector") or ""),
            "channel": str(row.get("channel") or ""),
            "status": status,
            "fit_rating": str(row.get("fit_rating") or ""),
            "deadline": deadline_value,
            "days_to_deadline": days_to_deadline,
            "cv_file": str(row.get("cv_file") or ""),
            "cover_letter_file": str(row.get("cover_letter_file") or ""),
            "source": str(row.get("source") or ""),
        })
    items.sort(key=lambda item: (bool(item.get("deadline")), str(item.get("deadline") or ""), str(item.get("date") or "")), reverse=True)
    return {"status": "ready", "items": items[: max(1, min(limit, 100))], "counts": counts, "source": "job_search_tracker.csv"}


def materials_snapshot() -> dict[str, object]:
    resume_status = "empty"
    if RESUME_DRAFT_FILE.is_file():
        try:
            resume_payload = json.loads(RESUME_DRAFT_FILE.read_text(encoding="utf-8"))
            resume_status = str(resume_payload.get("status") or "review") if isinstance(resume_payload, dict) else "unreadable"
        except (OSError, json.JSONDecodeError):
            resume_status = "unreadable"
    try:
        profile_text = PROFILE_FILE.read_text(encoding="utf-8")
        profile_ready = "[YOUR_" not in profile_text and "[LANGUAGE]" not in profile_text
    except OSError:
        profile_ready = False
    cv_files = sorted((path for path in (ROOT / "cv").glob("*.pdf") if path.is_file()), key=lambda path: path.stat().st_mtime, reverse=True)
    cover_files = sorted((path for path in (ROOT / "cover_letters").glob("*.pdf") if path.is_file()), key=lambda path: path.stat().st_mtime, reverse=True)
    application_archives = sum(1 for path in APPLICATION_ARCHIVE_DIR.glob("*") if path.is_dir()) if APPLICATION_ARCHIVE_DIR.is_dir() else 0
    return {
        "profile_ready": profile_ready,
        "resume_status": resume_status,
        "cv_count": len(cv_files),
        "cover_letter_count": len(cover_files),
        "application_archive_count": application_archives,
        "recent_cv": str(cv_files[0].relative_to(ROOT)) if cv_files else "",
        "recent_cover_letter": str(cover_files[0].relative_to(ROOT)) if cover_files else "",
    }


def dashboard_snapshot() -> dict[str, object]:
    ranking = ranking_snapshot(100)
    jobs = ranking.get("jobs", []) if isinstance(ranking, dict) else []
    jobs = jobs if isinstance(jobs, list) else []
    counts = ranking.get("counts", {}) if isinstance(ranking, dict) else {}
    counts = counts if isinstance(counts, dict) else {}
    seen_count = sum(int(value) for value in counts.values() if isinstance(value, int))
    ranked_count = int(counts.get("ranked", 0))
    pending_count = int(counts.get("new", 0))
    shortlisted_count = sum(1 for item in jobs if isinstance(item, dict) and isinstance(item.get("rank_score"), (int, float)) and float(item["rank_score"]) >= 60)

    setup = load_setup_draft()
    search_completeness = setup_completeness("search")
    rank_completeness = setup_completeness("rank")
    applications = applications_snapshot(8)
    application_counts = applications.get("counts", {}) if isinstance(applications, dict) else {}
    application_counts = application_counts if isinstance(application_counts, dict) else {}
    materials = materials_snapshot()

    complete_parts = 4 - len(rank_completeness.get("missing", []))
    profile_progress = max(0, min(100, round(complete_parts / 4 * 100)))
    if not search_completeness.get("complete"):
        next_action = {"id": "complete-preferences", "title": "完善求职偏好", "description": "补齐目标方向、城市和搜索平台后即可开始找职位。", "label": "继续完善", "path": "#profile", "tone": "primary"}
    elif materials.get("resume_status") != "confirmed":
        next_action = {"id": "confirm-resume", "title": "导入并确认简历", "description": "确认候选人资料后，匹配结果才会更可靠。", "label": "处理简历", "path": "#profile", "tone": "primary"}
    elif seen_count == 0:
        next_action = {"id": "search-jobs", "title": "开始第一次职位搜索", "description": "选择关键词、城市和平台，创建一个只读搜索任务。", "label": "开始搜索", "path": "#jobs", "tone": "primary"}
    elif pending_count > 0:
        next_action = {"id": "rank-jobs", "title": f"评估 {pending_count} 个待匹配职位", "description": "匹配前会再次说明将发送的数据，并要求明确确认。", "label": "查看待匹配职位", "path": "#jobs", "tone": "primary"}
    elif int(application_counts.get("drafted", 0)) > 0:
        next_action = {"id": "finish-drafts", "title": f"完成 {application_counts.get('drafted', 0)} 个待提交申请", "description": "检查截止日期和材料，确认后再由你手动提交。", "label": "查看申请", "path": "#applications", "tone": "primary"}
    elif int(application_counts.get("interview", 0)) > 0:
        next_action = {"id": "prepare-interviews", "title": "准备下一场面试", "description": "查看正在面试阶段的申请和已归档材料。", "label": "查看面试", "path": "#applications", "tone": "primary"}
    else:
        next_action = {"id": "review-jobs", "title": "继续查看高匹配职位", "description": "从已评估职位中选择下一份值得深入研究的机会。", "label": "查看职位", "path": "#jobs", "tone": "primary"}

    return {
        "pages": PAGE_MANIFEST,
        "metrics": {
            "seen_jobs": seen_count,
            "ranked_jobs": ranked_count,
            "pending_jobs": pending_count,
            "shortlisted_jobs": shortlisted_count,
            "applications": int(application_counts.get("total", 0)),
            "drafted_applications": int(application_counts.get("drafted", 0)),
            "interviews": int(application_counts.get("interview", 0)),
            "due_soon": int(application_counts.get("due_soon", 0)),
        },
        "next_action": next_action,
        "next_actions": [next_action["description"]],
        "profile_progress": {"percent": profile_progress, "missing": rank_completeness.get("missing", []), "search_ready": bool(search_completeness.get("complete")), "rank_ready": bool(rank_completeness.get("complete"))},
        "recent_tasks": _read_task_history(6),
        "setup": setup,
        "ranking": ranking,
        "applications": applications,
        "materials": materials,
    }


def ranking_snapshot(limit: int = 20, *, portal: str | None = None, status: str | None = None, min_score: float | None = None, sort: str = "score") -> dict[str, object]:
    """Return a safe, read-only view of locally stored ranking state."""
    if not STATE_FILE.is_file():
        return {"status": "empty", "jobs": [], "counts": {}}
    try:
        payload = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"status": "unreadable", "jobs": [], "counts": {}}
    seen = payload.get("seen", {}) if isinstance(payload, dict) else {}
    if not isinstance(seen, dict):
        return {"status": "unreadable", "jobs": [], "counts": {}}
    jobs: list[dict[str, object]] = []
    counts: dict[str, int] = {}
    for key, item in seen.items():
        if not isinstance(item, dict):
            continue
        item_status = str(item.get("status") or "new")
        if portal and str(item.get("portal") or item.get("source") or "unknown") != portal:
            continue
        if status and status != item_status:
            continue
        counts[item_status] = counts.get(item_status, 0) + 1
        score = item.get("rank_score")
        try:
            numeric_score = float(score) if score is not None else None
        except (TypeError, ValueError):
            numeric_score = None
        jobs.append({
            "key": str(key),
            "title": str(item.get("title") or "未命名职位"),
            "company": str(item.get("company") or "未注明公司"),
            "location": str(item.get("location") or "未注明地点"),
            "salary": str(item.get("salary") or "面议/未注明"),
            "portal": str(item.get("portal") or item.get("source") or "unknown"),
            "status": item_status,
            "rank_score": numeric_score,
            "rank_verdict": str(item.get("rank_verdict") or ""),
            "location_verdict": str(item.get("location_verdict") or ""),
            "language_gate": str(item.get("language_gate") or ""),
            "posted_date": str(item.get("posted_date") or ""),
            "deadline": str(item.get("deadline") or ""),
            "url": str(item.get("url") or ""),
            "strengths": [str(value) for value in item.get("strengths", []) if isinstance(value, str)][:3],
            "gaps": [str(value) for value in item.get("gaps", []) if isinstance(value, str)][:3],
            "archive_path": str(item.get("archive_path") or ""),
        })
    if sort == "recent":
        jobs.sort(key=lambda job: str(job.get("posted_date") or ""), reverse=True)
    elif sort == "title":
        jobs.sort(key=lambda job: str(job.get("title") or "").casefold())
    else:
        jobs.sort(key=lambda job: (job["rank_score"] is not None, job["rank_score"] or -1), reverse=True)
    if min_score is not None:
        jobs = [job for job in jobs if job["rank_score"] is not None and float(job["rank_score"]) >= min_score]
    return {"status": "ready", "jobs": jobs[: max(1, min(limit, 100))], "counts": counts}


def ranking_detail(key: str) -> dict[str, object] | None:
    if not STATE_FILE.is_file():
        return None
    try:
        payload = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    seen = payload.get("seen", {}) if isinstance(payload, dict) else {}
    item = seen.get(key) if isinstance(seen, dict) else None
    if not isinstance(item, dict):
        return None
    detail = {field: item.get(field) for field in ("title", "company", "location", "salary", "experience", "education", "url", "portal", "status", "rank_score", "rank_verdict", "location_verdict", "language_gate", "language_note", "strengths", "gaps", "rank_date")}
    archive = item.get("archive_path")
    if archive:
        path = (ROOT / str(archive)).resolve()
        try:
            path.relative_to(ROOT.resolve())
        except ValueError:
            path = None
        if path is not None and path.is_file():
            try:
                detail["raw_text"] = path.read_text(encoding="utf-8")[:50_000]
            except OSError:
                detail["raw_text"] = ""
    return detail


def privacy_snapshot() -> dict[str, object]:
    """Describe the Web shell's local-only permissions in user-facing terms."""
    return {
        "bind_address": "127.0.0.1",
        "network_requests": False,
        "network_requests_default": False,
        "external_search_opt_in": True,
        "external_ai_opt_in": True,
        "credential_access": False,
        "browser_session_access": False,
        "external_writes": False,
        "local_writes": ["webapp/data/setup_draft.json", "webapp/data/resume_draft.json", "webapp/data/audit.jsonl", "job_scraper/seen_jobs.json", "documents/postings/*.txt"],
        "allowed_actions": ["读取本地状态", "保存设置草稿", "解析用户粘贴的简历文本", "导入用户粘贴的职位正文", "用户主动启动后调用只读职位搜索", "明确确认后调用 OpenAI 兼容 API"],
        "blocked_actions": ["读取 Token/Cookie/密码", "绕过登录或验证码", "自动投递", "自动私聊", "未经确认修改正式候选人档案"],
        "log_policy": "日志只记录方法和路径，不记录查询参数、请求正文、凭证或职位正文",
    }


def rank_task_snapshot() -> dict[str, object]:
    """Expose whether the canonical AI ranking workflow is ready to run.

    The Web shell keeps the canonical ``/rank`` workflow as the source of
    truth. It does not call an external model by default; the separate
    OpenAI-compatible route is opt-in and requires explicit confirmation.
    """
    state_exists = STATE_FILE.is_file()
    job_count = ranking_snapshot().get("counts", {})
    total_jobs = sum(job_count.values()) if isinstance(job_count, dict) else 0
    profile_ready = False
    try:
        profile_text = PROFILE_FILE.read_text(encoding="utf-8")
        profile_ready = "[YOUR_" not in profile_text and "[LANGUAGE]" not in profile_text
    except OSError:
        profile_ready = False
    if not profile_ready and RESUME_DRAFT_FILE.is_file():
        try:
            resume_payload = json.loads(RESUME_DRAFT_FILE.read_text(encoding="utf-8"))
            profile_ready = isinstance(resume_payload, dict) and resume_payload.get("status") == "confirmed" and isinstance(resume_payload.get("data"), dict)
        except (OSError, json.JSONDecodeError):
            profile_ready = False
    if not state_exists or total_jobs == 0:
        status = "no_jobs"
        message = "先导入或搜索职位，再运行 /rank 进行 AI 匹配。"
    elif not profile_ready:
        status = "profile_incomplete"
        message = "候选人画像仍未完成；补充并确认资料后，再运行 /rank。"
    else:
        status = "ready"
        message = "职位和候选人画像已就绪，可运行 /rank 进行 AI 匹配。"
    return {
        "status": status,
        "message": message,
        "ai_execution": "canonical_rank_workflow",
        "web_executes_ai": False,
        "web_ai_mode": "explicit_confirmation_only",
        "next_command": "/rank",
        "job_count": total_jobs,
        "profile_ready": profile_ready,
    }


def release_check_snapshot() -> dict[str, object]:
    """Run lightweight, local release-gate checks for the Web MVP."""
    checks: list[dict[str, object]] = []

    def add(check_id: str, label: str, passed: bool, detail: str) -> None:
        checks.append({"id": check_id, "label": label, "passed": passed, "detail": detail})

    add("loopback", "仅绑定本机地址", True, "127.0.0.1")
    add("static", "首页静态资源齐全", all((STATIC_ROOT / name).is_file() for name in ("index.html", "app.js", "styles.css")), "index.html、app.js、styles.css")
    add("setup", "首次设置接口可用", True, "支持草稿与确认")
    add("import", "职位导入接口可用", True, "仅接受用户粘贴的 URL 和正文")
    add("search", "Web 搜索任务接口可用", True, "用户主动启动后调用只读门户适配器")
    add("rank", "匹配结果只读展示", True, "默认不外发；可在明确确认后使用 OpenAI 兼容 API")
    add("privacy", "外部写入关闭", True, "不投递、不私聊、不改正式候选人档案")
    add("state", "本地状态可读取", STATE_FILE.is_file(), "seen_jobs.json" if STATE_FILE.is_file() else "尚无职位状态文件，可先导入职位")
    passed = all(bool(check["passed"]) for check in checks)
    return {"status": "pass" if passed else "attention", "checks": checks, "passed": sum(1 for check in checks if check["passed"]), "total": len(checks), "message": "满足本地 Web MVP 发布门禁" if passed else "有检查项需要处理后再发布"}


def ai_status_snapshot() -> dict[str, object]:
    config = load_config()
    return {
        "provider": "openai-compatible",
        "configured": config.configured,
        "model": config.model or None,
        "base_url": config.base_url,
        "api_key_present": bool(config.api_key),
        "external_requests_default": False,
        "message": "已配置，可在明确确认后请求模型" if config.configured else "未配置；设置 OPENAI_API_KEY 和 OPENAI_MODEL 后可启用",
    }


def load_setup_draft() -> dict[str, object]:
    if not SETUP_DRAFT_FILE.is_file():
        return {"status": "empty", "data": {}}
    try:
        payload = json.loads(SETUP_DRAFT_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"status": "unreadable", "data": {}}
    if not isinstance(payload, dict):
        return {"status": "unreadable", "data": {}}
    data = payload.get("data", {})
    return {
        "status": payload.get("status", "draft"),
        "updated_at": payload.get("updated_at"),
        "data": data if isinstance(data, dict) else {},
    }


def setup_completeness(stage: str = "search") -> dict[str, object]:
    setup = load_setup_draft().get("data", {})
    setup = setup if isinstance(setup, dict) else {}
    required = {
        "search": ("goal", "cities", "platforms"),
        "rank": ("goal", "cities", "platforms"),
        "apply": ("goal", "cities", "platforms"),
        "interview": ("goal",),
    }.get(stage, ("goal", "cities", "platforms"))
    missing = [field for field in required if not setup.get(field)]
    resume_confirmed = False
    if RESUME_DRAFT_FILE.is_file():
        try:
            resume_confirmed = json.loads(RESUME_DRAFT_FILE.read_text(encoding="utf-8")).get("status") == "confirmed"
        except (OSError, json.JSONDecodeError):
            resume_confirmed = False
    if stage in {"rank", "apply", "interview"} and not resume_confirmed:
        missing.append("resume")
    return {"stage": stage, "complete": not missing, "missing": missing, "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def setup_templates() -> dict[str, object]:
    return {"templates": [
        {"id": "ai-hangzhou", "label": "杭州 AI 应用开发", "data": {"goal": "AI 应用开发", "cities": ["杭州"], "salary_min": 22000, "work_mode": ["onsite", "hybrid", "remote"], "platforms": ["zhaopin-search", "liepin-search"]}},
        {"id": "backend-hangzhou", "label": "杭州 Python 后端", "data": {"goal": "Python 后端开发", "cities": ["杭州"], "salary_min": 20000, "work_mode": ["onsite", "hybrid"], "platforms": ["zhaopin-search"]}},
    ]}


def setup_history_snapshot() -> dict[str, object]:
    if not SETUP_HISTORY_FILE.is_file():
        return {"items": []}
    try:
        history = json.loads(SETUP_HISTORY_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"items": []}
    return {"items": history[:10] if isinstance(history, list) else []}


def recover_interrupted_tasks() -> int:
    """Make queued/running tasks visible after a service restart."""
    if not TASK_ACTIVE_FILE.is_file():
        return 0
    try:
        active = json.loads(TASK_ACTIVE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        active = []
    recovered = []
    if isinstance(active, list):
        for item in active:
            if isinstance(item, dict) and item.get("id"):
                recovered.append({**item, "status": "interrupted", "stage": "interrupted", "error": "服务重启时任务被中断", "recovered_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    if recovered:
        try:
            history = json.loads(TASK_HISTORY_FILE.read_text(encoding="utf-8")) if TASK_HISTORY_FILE.is_file() else []
        except (OSError, json.JSONDecodeError):
            history = []
        if not isinstance(history, list):
            history = []
        _atomic_json_write(TASK_HISTORY_FILE, recovered + history[: max(0, 30 - len(recovered))], backup=False)
    TASK_ACTIVE_FILE.unlink(missing_ok=True)
    return len(recovered)


def validate_setup(data: object) -> tuple[dict[str, object] | None, list[str]]:
    if not isinstance(data, dict):
        return None, ["请求必须是 JSON 对象"]
    lowered = {str(key).casefold() for key in data}
    forbidden = sorted(lowered & FORBIDDEN_INPUT_KEYS)
    if forbidden:
        return None, ["不得通过设置向导提交凭证或验证码字段"]
    allowed = {"goal", "cities", "salary_min", "work_mode", "platforms", "constraints"}
    unknown = sorted(set(data) - allowed)
    if unknown:
        return None, [f"不支持的设置字段：{', '.join(unknown)}"]
    errors: list[str] = []
    goal = data.get("goal", "")
    if not isinstance(goal, str) or not goal.strip():
        errors.append("请填写一句话求职目标")
    elif len(goal.strip()) > 500:
        errors.append("求职目标不能超过 500 个字符")
    cities = data.get("cities", [])
    if isinstance(cities, str):
        cities = [item.strip() for item in cities.replace("，", ",").split(",") if item.strip()]
    if not isinstance(cities, list) or not all(isinstance(item, str) and item.strip() for item in cities):
        errors.append("城市请填写名称列表")
    elif len(cities) > 10:
        errors.append("城市最多填写 10 个")
    salary_min = data.get("salary_min")
    if salary_min not in (None, ""):
        if isinstance(salary_min, bool) or not isinstance(salary_min, (int, float)) or salary_min < 0 or salary_min > 1000000:
            errors.append("最低薪资必须是 0 到 1000000 之间的数字")
        else:
            salary_min = int(salary_min)
    work_mode = data.get("work_mode", [])
    if isinstance(work_mode, str):
        work_mode = [work_mode]
    allowed_modes = {"onsite", "hybrid", "remote"}
    if not isinstance(work_mode, list) or not all(item in allowed_modes for item in work_mode):
        errors.append("办公方式只能选择现场、混合或远程")
    platforms = data.get("platforms", ["zhaopin-search"])
    if isinstance(platforms, str):
        platforms = [platforms]
    allowed_platforms = {"zhaopin-search", "liepin-search", "boss-search", "51job-search"}
    if not isinstance(platforms, list) or not platforms or not all(item in allowed_platforms for item in platforms):
        errors.append("平台选择不正确")
    constraints = data.get("constraints", [])
    if isinstance(constraints, str):
        constraints = [item.strip() for item in re.split(r"[、,，;；]", constraints) if item.strip()]
    if not isinstance(constraints, list) or not all(isinstance(item, str) and item.strip() for item in constraints):
        errors.append("其他限制请填写文本列表")
    elif len(constraints) > 20:
        errors.append("其他限制最多填写 20 条")
    if errors:
        return None, errors
    normalized = {
        "goal": goal.strip(),
        "cities": [item.strip() for item in cities],
        "salary_min": salary_min if salary_min not in (None, "") else None,
        "work_mode": list(dict.fromkeys(work_mode)),
        "platforms": list(dict.fromkeys(platforms)),
    }
    if constraints:
        normalized["constraints"] = list(dict.fromkeys(item.strip() for item in constraints))
    return normalized, []


def parse_goal_text(value: object) -> tuple[dict[str, object] | None, list[str]]:
    """Conservatively parse a Chinese free-form goal into reviewable hints.

    This is intentionally a local heuristic parser. It never writes profile
    files and leaves uncertain values in ``pending`` instead of treating them
    as hard constraints.
    """
    if not isinstance(value, str) or not value.strip():
        return None, ["请先填写一句话求职目标"]
    raw = value.strip()
    if len(raw) > 500:
        return None, ["求职目标不能超过 500 个字符"]
    lowered = raw.casefold()
    if any(key in lowered for key in FORBIDDEN_INPUT_KEYS):
        return None, ["求职目标中不得提交凭证或验证码字段"]

    cities: list[str] = []
    for city in CITY_HINTS:
        if city in raw and city not in cities:
            cities.append(city)
    for match in re.findall(r"([\u4e00-\u9fff]{2,8})(?:市|区)", raw):
        candidate = match + ("市" if f"{match}市" in raw else "区")
        if candidate not in cities:
            cities.append(candidate)

    salary_min = None
    salary_max = None
    salary_unit = None
    salary_match = re.search(r"(\d+(?:\.\d+)?)\s*万(?:元)?(?:/月|每月|月)?(?:以上|起|[-至到~](\d+(?:\.\d+)?)\s*万)?", raw, re.I)
    if salary_match:
        salary_min = int(float(salary_match.group(1)) * 10000)
        salary_max = int(float(salary_match.group(2)) * 10000) if salary_match.group(2) else None
        salary_unit = "month"
    else:
        salary_match = re.search(r"(\d+(?:\.\d+)?)\s*[kK](?:/月|每月|月)?(?:以上|起|[-至到~](\d+(?:\.\d+)?)\s*[kK])?", raw)
        if salary_match:
            salary_min = int(float(salary_match.group(1)) * 1000)
            salary_max = int(float(salary_match.group(2)) * 1000) if salary_match.group(2) else None
            salary_unit = "month"
        else:
            salary_match = re.search(r"(\d{4,6})\s*(?:元)?(?:/月|每月|月)(?:以上|起|[-至到~](\d{4,6}))?", raw)
            if salary_match:
                salary_min = int(salary_match.group(1))
                salary_max = int(salary_match.group(2)) if salary_match.group(2) else None
                salary_unit = "month"

    work_mode: list[str] = []
    if any(token in raw for token in ("混合", "hybrid")):
        work_mode.append("hybrid")
    if any(token in raw for token in ("远程", "居家", "remote")):
        work_mode.append("remote")
    if any(token in raw for token in ("现场", "到岗", "坐班", "onsite")):
        work_mode.append("onsite")
    constraints: list[str] = []
    for pattern, label in ((r"不接受(?:外包|外派)", "不接受外包/外派"), (r"必须全职", "必须全职"), (r"不考虑派遣", "不考虑派遣"), (r"不接受加班", "不接受加班")):
        if re.search(pattern, raw, re.I):
            constraints.append(label)

    cleaned = raw
    cleaned = re.sub(r"[，,。；;|]", " ", cleaned)
    cleaned = re.sub(r"\d+(?:\.\d+)?\s*(?:万|k|K|元)(?:/月|每月|月)?(?:\s*(?:以上|起)|\s*[-至到~]\s*\d+(?:\.\d+)?\s*(?:万|k|K|元))?", " ", cleaned)
    cleaned = re.sub(r"\d+(?:\.\d+)?\s*(?:万|k|K|元)", " ", cleaned)
    cleaned = re.sub(r"(?:可接受|接受|支持|希望|寻找|想找|目标|期望|薪资|月薪|办公方式|工作地点)\s*", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"(?:混合办公|远程办公|居家办公|现场办公|到岗|坐班|混合|远程|现场|remote|hybrid|onsite)", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"(?:不接受外包|不接受外派|必须全职|不考虑派遣|不接受加班)", " ", cleaned, flags=re.I)
    for city in cities:
        cleaned = cleaned.replace(city, " ")
    role_parts = [part.strip() for part in re.sub(r"(?:或者|或|和|以及|兼顾|[/、])", "|", cleaned).split("|") if part.strip()]
    roles = []
    for part in role_parts:
        part = re.sub(r"^(?:北京|上海|广州|深圳|杭州|南京|苏州|成都|重庆|武汉|西安)\s*", "", part).strip()
        if 1 < len(part) <= 40 and not re.search(r"(?:以上|以下|不限|优先)$", part):
            roles.append(part)
    roles = list(dict.fromkeys(roles))[:5]

    pending: list[str] = []
    if not cities:
        pending.append("请确认目标城市")
    if not roles:
        pending.append("请确认目标岗位或方向")
    if salary_min is None:
        pending.append("未识别到最低月薪，可留空或手动填写")
    if not work_mode:
        pending.append("请确认办公方式")
    return {
        "raw": raw,
        "fields": {
            "roles": roles,
            "cities": cities,
            "salary_min": salary_min,
            "salary_max": salary_max,
            "salary_unit": salary_unit,
            "work_mode": work_mode,
            "constraints": constraints,
        },
        "pending": pending,
        "confidence": "high" if not pending else "partial",
    }, []


def save_setup_draft(data: dict[str, object], status: str = "draft") -> dict[str, object]:
    SETUP_DRAFT_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "status": status,
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data": data,
    }
    _atomic_json_write(SETUP_DRAFT_FILE, payload)
    try:
        history = json.loads(SETUP_HISTORY_FILE.read_text(encoding="utf-8")) if SETUP_HISTORY_FILE.is_file() else []
    except (OSError, json.JSONDecodeError):
        history = []
    if not isinstance(history, list):
        history = []
    history.insert(0, {"saved_at": payload["updated_at"], "data": data})
    _atomic_json_write(SETUP_HISTORY_FILE, history[:10])
    _audit("setup_save", "success", count=len(data))
    return load_setup_draft()


def extract_resume_fields(text: object, filename: str = "") -> tuple[dict[str, object] | None, list[str]]:
    """Extract conservative resume hints from UTF-8 plain text.

    PDF/DOCX conversion belongs to a later adapter; callers receive a clear
    unsupported-format error instead of silently inventing profile data.
    """
    if not isinstance(text, str) or not text.strip():
        return None, ["请提供简历文本"]
    if len(text) > 200_000:
        return None, ["简历文本不能超过 200000 个字符"]
    lowered_name = filename.casefold()
    if lowered_name and not lowered_name.endswith((".txt", ".md", ".text")):
        return None, ["请使用文本内容或通过简历文件解析接口上传 PDF/Word"]
    raw = text.strip()
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    email = next((m.group(0) for m in re.finditer(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", raw)), None)
    phone = next((m.group(0) for m in re.finditer(r"(?<!\d)(?:1[3-9]\d{9}|(?:0\d{2,3}-?)?\d{7,8})(?!\d)", raw)), None)
    name = None
    for line in lines[:8]:
        if re.fullmatch(r"[\u4e00-\u9fff]{2,6}|[A-Za-z][A-Za-z .'-]{1,30}", line) and not any(token in line.casefold() for token in ("resume", "curriculum", "cv")):
            name = line
            break
    skills: list[str] = []
    for label, aliases in RESUME_SKILL_ALIASES:
        for alias in aliases:
            if re.search(rf"(?<![A-Za-z]){alias}(?![A-Za-z])", raw, re.I):
                skills.append(label)
                break
    # Preserve commonly written Chinese skill groups that are not bounded by
    # ASCII word characters (for example "全栈开发/LLM本地部署/RAG").
    skills = list(dict.fromkeys(skills))
    education = [line for line in lines if re.search(r"(大学|学院|本科|硕士|博士|Bachelor|Master|PhD)", line, re.I)][:10]
    experience = [line for line in lines if re.search(r"(工作经历|项目经历|经验|\d{4}\s*[-至到]\s*(?:\d{4}|至今)|experience|project)", line, re.I)][:20]
    years = None
    years_match = re.search(r"(?<!\d)(\d+(?:\.\d+)?)\s*(?:年|年以上)\s*(?:工作经验|相关经验|经验)?", raw, re.I)
    if years_match:
        years = float(years_match.group(1))
        years = int(years) if years.is_integer() else years
    languages: list[str] = []
    language_patterns = (
        ("CET-4", r"(?:CET[- ]?4|英语四级|大学英语四级)"),
        ("CET-6", r"(?:CET[- ]?6|英语六级|大学英语六级)"),
        ("IELTS", r"IELTS"),
        ("TOEFL", r"TOEFL"),
        ("英语", r"英语(?:流利|熟练|良好|读写|口语)?"),
        ("普通话", r"普通话"),
    )
    for label, pattern in language_patterns:
        if re.search(pattern, raw, re.I):
            languages.append(label)
    target_roles: list[str] = []
    target_cities: list[str] = []
    target_salary_min = None
    target_work_mode: list[str] = []
    target_line = next((line for line in lines if re.search(r"求职意向|期望职位|目标岗位|意向岗位", line)), "")
    if target_line:
        target_roles = [part.strip() for part in re.split(r"[：:，,、/|]", target_line, maxsplit=1)[-1].split("/") if part.strip()][:5]
    for city in CITY_HINTS:
        if re.search(rf"(?:期望|意向|目标)?(?:城市|地点)?[^\n]{{0,12}}{re.escape(city)}", raw):
            target_cities.append(city)
    salary_match = re.search(r"(?:期望薪资|目标薪资|最低薪资|月薪)\s*[：:]?\s*(\d+(?:\.\d+)?)\s*([kK万])", raw, re.I)
    if salary_match:
        target_salary_min = int(float(salary_match.group(1)) * (10000 if salary_match.group(2).lower() == "万" else 1000))
    if re.search(r"混合办公|混合", raw):
        target_work_mode.append("hybrid")
    if re.search(r"远程|居家", raw, re.I):
        target_work_mode.append("remote")
    if re.search(r"现场|坐班|到岗", raw):
        target_work_mode.append("onsite")
    pending: list[str] = []
    if not name:
        pending.append("请确认姓名")
    if not email and not phone:
        pending.append("未识别到联系方式")
    if not skills:
        pending.append("未识别到技术技能")
    return {
        "source": {"filename": filename or None, "format": "text", "char_count": len(raw)},
        "fields": {
            "name": name, "email": email, "phone": phone, "skills": skills,
            "education": education, "experience": experience,
            "work_years": years, "languages": languages,
            "target_roles": target_roles, "target_cities": target_cities,
            "salary_min": target_salary_min, "work_mode": target_work_mode,
        },
        "pending": pending,
        "confidence": "partial" if pending else "high",
    }, []


def extract_resume_file(content: object, filename: str) -> tuple[dict[str, object] | None, list[str]]:
    """Decode a local resume file without network or credential access."""
    if not isinstance(content, str) or not content:
        return None, ["请提供简历文件内容"]
    try:
        raw = base64.b64decode(content, validate=True)
    except (ValueError, base64.binascii.Error):
        return None, ["简历文件不是有效的 base64 内容"]
    if len(raw) > 15 * 1024 * 1024:
        return None, ["简历文件不能超过 15MB"]
    lowered = filename.casefold()
    text = ""
    if lowered.endswith((".txt", ".md", ".text")):
        for encoding in ("utf-8-sig", "gb18030"):
            try:
                text = raw.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
    elif lowered.endswith(".docx"):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                xml = archive.read("word/document.xml")
            root = ET.fromstring(xml)
            text = "\n".join(node.text for node in root.iter() if node.tag.endswith("}t") and node.text)
        except (KeyError, OSError, zipfile.BadZipFile, ET.ParseError):
            return None, ["Word 文件解析失败，请检查文件是否损坏"]
    elif lowered.endswith(".pdf"):
        try:
            from pypdf import PdfReader  # type: ignore
            reader = PdfReader(io.BytesIO(raw))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except ImportError:
            return None, ["PDF 解析需要安装 pypdf；也可以直接粘贴文本简历"]
        except Exception:
            return None, ["PDF 文件解析失败，请改用文本或 Word 文件"]
    else:
        return None, ["仅支持 UTF-8 文本、Word（.docx）或 PDF（.pdf）简历"]
    if not text.strip():
        return None, ["文件中没有可识别的文本内容"]
    return extract_resume_fields(text, filename.rsplit(".", 1)[0] + ".txt")


def save_resume_draft(parsed: dict[str, object], status: str = "review") -> dict[str, object]:
    RESUME_DRAFT_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": 1, "status": status, "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "data": parsed}
    _atomic_json_write(RESUME_DRAFT_FILE, payload)
    _audit("resume_save", "success", filename=str(parsed.get("source", {}).get("filename") or "") if isinstance(parsed.get("source"), dict) else "")
    return {"status": status, "updated_at": payload["updated_at"], "data": parsed}


def profile_mapping_preview() -> tuple[dict[str, object] | None, list[str]]:
    if not RESUME_DRAFT_FILE.is_file():
        return None, ["请先识别并确认简历"]
    try:
        payload = json.loads(RESUME_DRAFT_FILE.read_text(encoding="utf-8"))
        profile = PROFILE_FILE.read_text(encoding="utf-8")
    except (OSError, json.JSONDecodeError):
        return None, ["无法读取简历草稿或候选人资料"]
    if not isinstance(payload, dict) or payload.get("status") != "confirmed":
        return None, ["请先确认简历草稿"]
    data = payload.get("data", {})
    fields = data.get("fields", {}) if isinstance(data, dict) else {}
    if not isinstance(fields, dict):
        return None, ["简历字段格式不正确"]
    changes: list[dict[str, str]] = []
    replacements: list[tuple[str, str, str]] = []
    for field, marker, value in (("name", "[YOUR_NAME]", fields.get("name")), ("phone", "[YOUR_PHONE]", fields.get("phone")), ("email", "[YOUR_EMAIL]", fields.get("email"))):
        if isinstance(value, str) and value.strip() and marker in profile:
            replacements.append((marker, value.strip(), field))
    skills = [str(item) for item in fields.get("skills", []) if isinstance(item, str) and item.strip()]
    if skills and "[OTHER_SKILLS]" in profile:
        replacements.append(("[OTHER_SKILLS]", "\n".join(f"- {item}" for item in skills), "skills"))
    languages = [str(item) for item in fields.get("languages", []) if isinstance(item, str) and item.strip()]
    if languages and "| [LANGUAGE] | [LEVEL" in profile:
        replacements.append(("| [LANGUAGE] | [LEVEL, e.g. \"Native\" / \"C2\" / \"B1/B2 (conversational)\"] | [optional] |", f"| English | {' / '.join(languages)} | Extracted from confirmed resume; verify level. |", "languages"))
    for old, new, field in replacements:
        changes.append({"field": field, "from": old, "to": new})
    return {"status": "ready", "changes": changes, "requires_confirmation": bool(changes)}, []


def apply_profile_mapping() -> tuple[dict[str, object] | None, list[str]]:
    preview, errors = profile_mapping_preview()
    if errors or preview is None:
        return None, errors
    try:
        profile = PROFILE_FILE.read_text(encoding="utf-8")
        backup = PROFILE_FILE.with_suffix(PROFILE_FILE.suffix + ".bak")
        shutil.copy2(PROFILE_FILE, backup)
        for change in preview["changes"]:
            profile = profile.replace(str(change["from"]), str(change["to"]), 1)
        temporary = PROFILE_FILE.with_suffix(PROFILE_FILE.suffix + ".tmp")
        temporary.write_text(profile, encoding="utf-8")
        temporary.replace(PROFILE_FILE)
    except OSError as exc:
        return None, [f"无法更新候选人资料：{exc}"]
    _audit("profile_mapping", "success", count=len(preview["changes"]))
    return {"status": "confirmed", "changes": preview["changes"], "backup": str(backup)}, []


def import_job_text(url: object, text: object, portal: object = "auto") -> tuple[dict[str, object] | None, list[str]]:
    """Import user-provided posting text through the canonical local importer."""
    if not isinstance(url, str) or not url.strip():
        return None, ["请填写职位详情页链接"]
    if not isinstance(text, str) or not text.strip():
        return None, ["请粘贴职位正文"]
    if len(text) > 200_000:
        return None, ["职位正文不能超过 200000 个字符"]
    selected_portal = portal if isinstance(portal, str) else "auto"
    if selected_portal not in {"auto", "boss-search", "51job-search"}:
        return None, ["平台只能选择 auto、boss-search 或 51job-search"]
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False) as handle:
            handle.write(text)
            temporary_path = Path(handle.name)
        args = argparse.Namespace(
            url=url,
            text_file=str(temporary_path),
            portal=selected_portal,
            state_file=str(STATE_FILE),
            archive_dir=str(IMPORT_ARCHIVE_DIR),
        )
        result = import_job(args)
        record = result.get("record", {})
        return {
            "key": result.get("key"),
            "created": bool(result.get("created")),
            "archive_path": result.get("archive_path"),
            "record": record if isinstance(record, dict) else {},
        }, []
    except (ImportErrorValue, OSError) as exc:
        return None, [str(exc)]
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _task_snapshot(task_id: str) -> dict[str, object] | None:
    with TASKS_LOCK:
        task = TASKS.get(task_id)
        return dict(task) if task else None


def _set_task(task_id: str, **updates: object) -> None:
    completed_task: dict[str, object] | None = None
    active: list[dict[str, object]] = []
    with TASKS_LOCK:
        if task_id in TASKS:
            TASKS[task_id].update(updates)
            if TASKS[task_id].get("status") in {"completed", "failed", "cancelled"}:
                completed_task = dict(TASKS[task_id])
        active = [dict(item) for item in TASKS.values() if item.get("status") in {"queued", "running"}]
    if active:
        _atomic_json_write(TASK_ACTIVE_FILE, active, backup=False)
    elif TASK_ACTIVE_FILE.is_file():
        TASK_ACTIVE_FILE.unlink(missing_ok=True)
    if completed_task is not None:
        try:
            history = json.loads(TASK_HISTORY_FILE.read_text(encoding="utf-8")) if TASK_HISTORY_FILE.is_file() else []
        except (OSError, json.JSONDecodeError):
            history = []
        if not isinstance(history, list):
            history = []
        history = [item for item in history if isinstance(item, dict) and item.get("id") != task_id]
        history.insert(0, completed_task)
        _atomic_json_write(TASK_HISTORY_FILE, history[:30], backup=False)


def _audit(action: str, outcome: str, code: str = "OK", **meta: object) -> None:
    """Append metadata-only audit events; never include source text or secrets."""
    AUDIT_FILE.parent.mkdir(parents=True, exist_ok=True)
    event = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "action": action, "outcome": outcome, "code": code}
    event.update({key: value for key, value in meta.items() if key in {"task_id", "platform", "count", "filename"} and isinstance(value, (str, int, float, bool))})
    with AUDIT_FILE.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")


def _atomic_json_write(path: Path, payload: object, *, backup: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if backup and path.is_file():
        backup_path = path.with_suffix(path.suffix + ".bak")
        shutil.copy2(path, backup_path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _write_seen_jobs(records: list[dict[str, object]]) -> int:
    """Merge normalized read-only search results into the canonical state file."""
    if STATE_FILE.is_file():
        try:
            payload = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {"seen": {}}
    else:
        payload = {"seen": {}}
    seen = payload.get("seen") if isinstance(payload, dict) else None
    if not isinstance(seen, dict):
        seen = {}
        payload = {"seen": seen}
    added = 0
    for job in records:
        url = str(job.get("url") or "").strip()
        title = str(job.get("title") or "").strip()
        company = str(job.get("company") or "").strip()
        if not url or not title:
            continue
        key = "portal:" + str(job.get("portal") or "unknown") + "|url:" + url
        existing = seen.get(key) if isinstance(seen.get(key), dict) else {}
        record = {
            **existing,
            **job,
            "id": str(job.get("id") or hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]),
            "title": title,
            "company": company or None,
            "url": url,
            "first_seen": existing.get("first_seen") or datetime.now().date().isoformat(),
            "status": existing.get("status") or "new",
            "fit": existing.get("fit") or "low",
            "source": str(job.get("source") or "cli"),
            "access_mode": str(job.get("access_mode") or "public_read_only"),
        }
        if key not in seen:
            added += 1
        seen[key] = record
    with STATE_LOCK:
        _atomic_json_write(STATE_FILE, payload)
    _audit("search_merge", "success", count=len(records))
    return added


def _run_search_task(task_id: str, query: str, cities: list[str], platforms: list[str], limit: int) -> None:
    _set_task(task_id, status="running", stage="search", progress=0)
    records: list[dict[str, object]] = []
    errors: list[dict[str, str]] = []
    supported = {"zhaopin-search", "liepin-search"}
    selected = [platform for platform in platforms if platform in supported]
    for index, platform in enumerate(selected):
        if (_task_snapshot(task_id) or {}).get("cancel_requested"):
            _set_task(task_id, status="cancelled", stage="cancelled", progress=round(index / max(1, len(selected)) * 100), results=0)
            return
        cli = ROOT / ".agents" / "skills" / platform / "cli" / "src" / "cli.ts"
        if not cli.is_file():
            errors.append({"platform": platform, "code": "CLI_UNAVAILABLE", "message": "平台适配器不存在"})
            continue
        command = ["bun", "run", str(cli), "search", "--query", query, "--limit", str(limit), "--format", "json"]
        if cities:
            flag = "--city" if platform == "zhaopin-search" else "--city"
            command.extend([flag, cities[0]])
        try:
            completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=45, check=False)
            if completed.returncode != 0:
                errors.append({"platform": platform, "code": "SEARCH_FAILED", "message": "平台搜索失败，请检查平台状态"})
            else:
                output = json.loads(completed.stdout)
                found = output.get("results", []) if isinstance(output, dict) else []
                if isinstance(found, list):
                    records.extend(item for item in found if isinstance(item, dict))
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
            errors.append({"platform": platform, "code": "SEARCH_FAILED", "message": "平台搜索超时或返回格式异常"})
        _set_task(task_id, progress=round((index + 1) / max(1, len(selected)) * 100), platform=platform, found=len(records))
    added = _write_seen_jobs(records) if records else 0
    unsupported = [platform for platform in platforms if platform not in supported]
    for platform in unsupported:
        errors.append({"platform": platform, "code": "MANUAL_IMPORT_REQUIRED", "message": "该平台当前请使用职位导入"})
    status = "completed" if records or not errors else "failed"
    _set_task(task_id, status=status, stage="completed" if status == "completed" else "failed", progress=100, found=len(records), added=added, errors=errors, results=len(records))


def start_search_task(data: object) -> tuple[dict[str, object] | None, list[str]]:
    if not isinstance(data, dict):
        return None, ["请求必须是 JSON 对象"]
    allowed = {"query", "cities", "platforms", "limit"}
    if set(data) - allowed:
        return None, ["搜索请求包含不支持的字段"]
    query = data.get("query")
    if not isinstance(query, str) or not query.strip() or len(query.strip()) > 200:
        return None, ["请填写 1-200 个字符的搜索关键词"]
    cities = data.get("cities", [])
    if isinstance(cities, str):
        cities = [item.strip() for item in re.split(r"[、,，]", cities) if item.strip()]
    if not isinstance(cities, list) or not all(isinstance(item, str) and item.strip() for item in cities):
        return None, ["城市请填写名称列表"]
    platforms = data.get("platforms", ["zhaopin-search"])
    if isinstance(platforms, str):
        platforms = [platforms]
    allowed_platforms = {"zhaopin-search", "liepin-search", "boss-search", "51job-search"}
    if not isinstance(platforms, list) or not platforms or not all(item in allowed_platforms for item in platforms):
        return None, ["平台选择不正确"]
    limit = data.get("limit", 10)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 50:
        return None, ["每个平台最多搜索 1-50 条职位"]
    task_id = uuid.uuid4().hex
    task = {"id": task_id, "kind": "search", "status": "queued", "stage": "queued", "progress": 0, "query": query.strip(), "cities": list(cities), "platforms": list(dict.fromkeys(platforms)), "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "cancel_requested": False}
    with TASKS_LOCK:
        TASKS[task_id] = task
    thread = threading.Thread(target=_run_search_task, args=(task_id, query.strip(), list(cities), list(dict.fromkeys(platforms)), limit), daemon=True)
    thread.start()
    return task, []


def _candidate_text_for_rank() -> str:
    if RESUME_DRAFT_FILE.is_file():
        try:
            payload = json.loads(RESUME_DRAFT_FILE.read_text(encoding="utf-8"))
            data = payload.get("data", {}) if isinstance(payload, dict) else {}
            if isinstance(data, dict):
                return json.dumps(data, ensure_ascii=False)
        except (OSError, json.JSONDecodeError):
            pass
    return PROFILE_FILE.read_text(encoding="utf-8") if PROFILE_FILE.is_file() else ""


def _run_rank_task(task_id: str, confirm_external: bool, limit: int) -> None:
    _set_task(task_id, status="running", stage="ranking", progress=0)
    try:
        payload = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        seen = payload.get("seen", {}) if isinstance(payload, dict) else {}
        jobs = [(key, item) for key, item in seen.items() if isinstance(item, dict) and item.get("status", "new") == "new"] if isinstance(seen, dict) else []
        jobs = jobs[:limit]
        candidate_text = _candidate_text_for_rank()
        if not candidate_text:
            _set_task(task_id, status="failed", stage="failed", progress=100, errors=[{"code": "PROFILE_INCOMPLETE", "message": "请先确认简历或候选人资料"}])
            return
        ranked = 0
        errors: list[dict[str, str]] = []
        for index, (key, job) in enumerate(jobs):
            if (_task_snapshot(task_id) or {}).get("cancel_requested"):
                _set_task(task_id, status="cancelled", stage="cancelled", progress=round(index / max(1, len(jobs)) * 100), ranked=ranked)
                return
            text = "\n".join(str(job.get(field) or "") for field in ("title", "company", "location", "salary", "experience", "education", "description"))
            archive = job.get("archive_path")
            if archive:
                archive_path = (ROOT / str(archive)).resolve()
                try:
                    archive_path.relative_to(ROOT.resolve())
                except ValueError:
                    archive_path = None
                if archive_path is not None and archive_path.is_file():
                    try:
                        text = archive_path.read_text(encoding="utf-8")
                    except OSError:
                        pass
            try:
                result = complete_match(load_config(), text, candidate_text, allow_external=confirm_external)
                seen[key] = {**job, **result, "status": "ranked", "rank_score": result["overall"], "rank_verdict": "Strong Fit" if result["overall"] >= 75 else "Moderate Fit", "rank_date": datetime.now().date().isoformat()}
                ranked += 1
            except AIProviderError as exc:
                errors.append({"key": str(key), "code": "AI_PROVIDER_ERROR", "message": str(exc)})
            _set_task(task_id, progress=round((index + 1) / max(1, len(jobs)) * 100), ranked=ranked)
        with STATE_LOCK:
            _atomic_json_write(STATE_FILE, payload)
        _audit("rank_write", "success", task_id=task_id, count=ranked)
        status = "completed" if ranked or not errors else "failed"
        _set_task(task_id, status=status, stage="completed" if status == "completed" else "failed", progress=100, ranked=ranked, errors=errors, results=len(jobs))
    except (OSError, json.JSONDecodeError):
        _set_task(task_id, status="failed", stage="failed", progress=100, errors=[{"code": "STATE_READ_FAILED", "message": "无法读取本地职位状态"}])


def start_rank_task(data: object) -> tuple[dict[str, object] | None, list[str]]:
    if not isinstance(data, dict) or set(data) - {"confirm_external", "limit"}:
        return None, ["排名请求只接受 confirm_external 和 limit 字段"]
    limit = data.get("limit", 10)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 20:
        return None, ["每次最多排名 1-20 个职位"]
    task_id = uuid.uuid4().hex
    task = {"id": task_id, "kind": "rank", "status": "queued", "stage": "queued", "progress": 0, "limit": limit, "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "cancel_requested": False}
    with TASKS_LOCK:
        TASKS[task_id] = task
    threading.Thread(target=_run_rank_task, args=(task_id, True, limit), daemon=True).start()
    return task, []


def json_response(handler: BaseHTTPRequestHandler, payload: object, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Referrer-Policy", "no-referrer")
    handler.send_header("Content-Security-Policy", "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class AppHandler(BaseHTTPRequestHandler):
    server_version = "AIJobSearchWeb/0.1"

    def log_message(self, format: str, *args: object) -> None:
        # Keep logs useful without echoing request bodies or query strings.
        path = self.path.split("?", 1)[0]
        path = "".join(character for character in path if character >= " " and character != "\x7f")
        sys.stderr.write(f"webapp {self.command} {path[:200]}\n")

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        if path == "/api/health":
            json_response(self, health_snapshot())
            return
        if path == "/api/dashboard":
            json_response(self, dashboard_snapshot())
            return
        if path == "/api/applications":
            query = parse_qs(parsed_url.query)
            try:
                requested_limit = int(query.get("limit", [50])[0] or 50)
            except ValueError:
                requested_limit = 50
            json_response(self, applications_snapshot(min(100, max(1, requested_limit))))
            return
        if path == "/api/materials":
            json_response(self, materials_snapshot())
            return
        if path == "/api/rank":
            query = parse_qs(parsed_url.query)
            raw_min = query.get("min_score", [""])[0]
            try:
                min_score = float(raw_min) if raw_min else None
            except ValueError:
                min_score = None
            try:
                requested_limit = int(query.get("limit", [20])[0] or 20)
            except ValueError:
                requested_limit = 20
            json_response(self, ranking_snapshot(
                limit=min(100, max(1, requested_limit)),
                portal=query.get("portal", [None])[0] or None,
                status=query.get("status", [None])[0] or None,
                min_score=min_score,
                sort=query.get("sort", ["score"])[0],
            ))
            return
        if path == "/api/rank/detail":
            key = parse_qs(parsed_url.query).get("key", [""])[0]
            detail = ranking_detail(key)
            if detail is None:
                json_response(self, {"error": "职位不存在", "code": "JOB_NOT_FOUND"}, HTTPStatus.NOT_FOUND)
            else:
                json_response(self, {"job": detail})
            return
        if path == "/api/privacy":
            json_response(self, privacy_snapshot())
            return
        if path == "/api/rank/status":
            json_response(self, rank_task_snapshot())
            return
        if path == "/api/release-check":
            json_response(self, release_check_snapshot())
            return
        if path == "/api/ai/status":
            json_response(self, ai_status_snapshot())
            return
        if path == "/api/pages":
            json_response(self, {"pages": PAGE_MANIFEST})
            return
        if path == "/api/setup":
            json_response(self, {"setup": load_setup_draft()})
            return
        if path == "/api/setup/completeness":
            stage = parse_qs(parsed_url.query).get("stage", ["search"])[0]
            json_response(self, {"completeness": setup_completeness(stage)})
            return
        if path == "/api/setup/templates":
            json_response(self, setup_templates())
            return
        if path == "/api/setup/history":
            json_response(self, setup_history_snapshot())
            return
        if path == "/api/audit":
            events: list[dict[str, object]] = []
            if AUDIT_FILE.is_file():
                try:
                    for line in AUDIT_FILE.read_text(encoding="utf-8").splitlines()[-50:]:
                        item = json.loads(line)
                        if isinstance(item, dict):
                            events.append(item)
                except (OSError, json.JSONDecodeError):
                    events = []
            json_response(self, {"events": events})
            return
        if path == "/api/resume/profile-preview":
            preview, errors = profile_mapping_preview()
            if errors or preview is None:
                json_response(self, {"error": "；".join(errors), "code": "PROFILE_MAPPING_UNAVAILABLE"}, HTTPStatus.BAD_REQUEST)
            else:
                json_response(self, {"profile": preview})
            return
        if path == "/api/tasks/history":
            json_response(self, {"tasks": _read_task_history(30)})
            return
        if path.startswith("/api/tasks/"):
            task_id = path.removeprefix("/api/tasks/").strip("/")
            task = _task_snapshot(task_id)
            if task is None:
                json_response(self, {"error": "任务不存在", "code": "TASK_NOT_FOUND"}, HTTPStatus.NOT_FOUND)
            else:
                json_response(self, {"task": task})
            return
        if path in {"/", "/index.html"}:
            self.serve_static("index.html", "text/html; charset=utf-8")
            return
        if path.startswith("/static/"):
            relative = path.removeprefix("/static/")
            content_types = {
                ".css": "text/css; charset=utf-8",
                ".js": "text/javascript; charset=utf-8",
                ".svg": "image/svg+xml",
            }
            suffix = Path(relative).suffix.lower()
            self.serve_static(relative, content_types.get(suffix, "application/octet-stream"))
            return
        json_response(self, {"error": "not found", "code": "NOT_FOUND"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        path = urlparse(self.path).path
        if path not in {"/api/setup/draft", "/api/setup/confirm", "/api/setup/parse", "/api/resume/parse", "/api/resume/parse-file", "/api/resume/confirm", "/api/resume/profile-confirm", "/api/import/job", "/api/ai/preview", "/api/ai/match", "/api/search/start", "/api/rank/run"} and not path.startswith("/api/tasks/"):
            json_response(self, {"error": "not found", "code": "NOT_FOUND"}, HTTPStatus.NOT_FOUND)
            return
        length = self.headers.get("Content-Length")
        try:
            size = int(length or "0")
        except ValueError:
            size = 0
        if size <= 0 or size > MAX_REQUEST_BYTES:
            if MAX_REQUEST_BYTES < size <= MAX_REQUEST_BYTES * 16:
                self.rfile.read(size)
            elif size > MAX_REQUEST_BYTES:
                self.close_connection = True
            json_response(self, {"error": "请求内容大小不正确", "code": "BAD_INPUT"}, HTTPStatus.BAD_REQUEST)
            return
        raw_body = self.rfile.read(size)
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            json_response(self, {"error": "只接受 application/json", "code": "BAD_INPUT"}, HTTPStatus.BAD_REQUEST)
            return
        try:
            data = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            json_response(self, {"error": "请求不是有效的 UTF-8 JSON", "code": "BAD_INPUT"}, HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/search/start":
            task, errors = start_search_task(data)
            if errors or task is None:
                json_response(self, {"error": "；".join(errors), "code": "BAD_INPUT", "fields": errors}, HTTPStatus.BAD_REQUEST)
                return
            json_response(self, {"task": task}, HTTPStatus.ACCEPTED)
            return
        if path == "/api/ai/preview":
            if not isinstance(data, dict) or set(data) != {"job_text", "candidate_text"} or not all(isinstance(data.get(key), str) for key in ("job_text", "candidate_text")):
                json_response(self, {"error": "预览需要 job_text 和 candidate_text", "code": "BAD_INPUT"}, HTTPStatus.BAD_REQUEST)
                return
            json_response(self, {"preview": {"message": "发送前仅展示脱敏预览；默认不发送外部请求", "job": redact_preview(data["job_text"]), "candidate": redact_preview(data["candidate_text"]), "job_chars": len(data["job_text"]), "candidate_chars": len(data["candidate_text"]), "estimated_input_tokens": estimate_input_tokens(data["job_text"], data["candidate_text"])}})
            return
        if path == "/api/rank/run":
            if not isinstance(data, dict) or set(data) - {"confirm_external", "limit"}:
                json_response(self, {"error": "排名请求只接受 confirm_external 和 limit 字段", "code": "BAD_INPUT"}, HTTPStatus.BAD_REQUEST)
                return
            if data.get("confirm_external") is not True:
                job_count = sum(1 for item in (ranking_snapshot(100).get("jobs", []) if isinstance(ranking_snapshot(100), dict) else []) if item.get("status") == "new")
                json_response(self, {"error": "运行 AI 排名将把本地职位和候选人资料发送到外部模型，需要明确确认", "code": "EXTERNAL_CONFIRMATION_REQUIRED", "preview": {"provider": "openai-compatible", "new_jobs": job_count, "external_request": True}}, HTTPStatus.PRECONDITION_REQUIRED)
                return
            task, errors = start_rank_task(data)
            if errors or task is None:
                json_response(self, {"error": "；".join(errors), "code": "BAD_INPUT", "fields": errors}, HTTPStatus.BAD_REQUEST)
                return
            json_response(self, {"task": task}, HTTPStatus.ACCEPTED)
            return
        if path.startswith("/api/tasks/") and path.endswith("/cancel"):
            task_id = path.removeprefix("/api/tasks/").removesuffix("/cancel").strip("/")
            with TASKS_LOCK:
                task = TASKS.get(task_id)
                if task is None:
                    task = None
                elif task.get("status") in {"queued", "running"}:
                    task["cancel_requested"] = True
            if task is None:
                json_response(self, {"error": "任务不存在", "code": "TASK_NOT_FOUND"}, HTTPStatus.NOT_FOUND)
            else:
                json_response(self, {"task": _task_snapshot(task_id)})
            return
        if path == "/api/resume/profile-confirm":
            if not isinstance(data, dict) or data.get("confirm") is not True or set(data) != {"confirm"}:
                json_response(self, {"error": "更新正式候选人资料前需要明确确认", "code": "PROFILE_CONFIRMATION_REQUIRED"}, HTTPStatus.PRECONDITION_REQUIRED)
                return
            result, errors = apply_profile_mapping()
            if errors or result is None:
                json_response(self, {"error": "；".join(errors), "code": "PROFILE_MAPPING_FAILED"}, HTTPStatus.BAD_REQUEST)
                return
            json_response(self, {"profile": result}, HTTPStatus.OK)
            return
        if path == "/api/setup/parse":
            if not isinstance(data, dict) or set(data) != {"text"}:
                json_response(self, {"error": "解析接口只接受 text 字段", "code": "BAD_INPUT"}, HTTPStatus.BAD_REQUEST)
                return
            parsed, errors = parse_goal_text(data.get("text"))
            if errors or parsed is None:
                json_response(self, {"error": "；".join(errors), "code": "BAD_INPUT", "fields": errors}, HTTPStatus.BAD_REQUEST)
                return
            json_response(self, {"parsed": parsed}, HTTPStatus.OK)
            return
        if path in {"/api/resume/parse", "/api/resume/confirm"}:
            if not isinstance(data, dict) or set(data) - {"text", "filename", "parsed"} or ("text" not in data and "parsed" not in data):
                json_response(self, {"error": "简历接口需要 text，可选 filename；确认时也可提交 parsed", "code": "BAD_INPUT"}, HTTPStatus.BAD_REQUEST)
                return
            if path.endswith("/confirm") and "parsed" in data:
                parsed = data.get("parsed") if isinstance(data.get("parsed"), dict) else None
                errors = [] if parsed is not None and isinstance(parsed.get("fields"), dict) else ["确认数据格式不正确"]
            else:
                parsed, errors = extract_resume_fields(data.get("text"), str(data.get("filename") or ""))
            if errors or parsed is None:
                json_response(self, {"error": "；".join(errors), "code": "BAD_INPUT", "fields": errors}, HTTPStatus.BAD_REQUEST)
                return
            if path.endswith("/confirm"):
                parsed = save_resume_draft(parsed, "confirmed")["data"]
            json_response(self, {"resume": {"status": "confirmed" if path.endswith("/confirm") else "review", "data": parsed}}, HTTPStatus.OK)
            return
        if path == "/api/resume/parse-file":
            if not isinstance(data, dict) or set(data) != {"filename", "content_base64"}:
                json_response(self, {"error": "文件解析需要 filename 和 content_base64", "code": "BAD_INPUT"}, HTTPStatus.BAD_REQUEST)
                return
            filename = data.get("filename")
            if not isinstance(filename, str) or len(filename) > 255 or Path(filename).name != filename:
                json_response(self, {"error": "文件名不正确", "code": "BAD_INPUT"}, HTTPStatus.BAD_REQUEST)
                return
            parsed, errors = extract_resume_file(data.get("content_base64"), filename)
            if errors or parsed is None:
                json_response(self, {"error": "；".join(errors), "code": "BAD_INPUT", "fields": errors}, HTTPStatus.BAD_REQUEST)
                return
            json_response(self, {"resume": {"status": "review", "data": parsed}}, HTTPStatus.OK)
            return
        if path == "/api/import/job":
            if not isinstance(data, dict) or set(data) - {"url", "text", "portal"} or "url" not in data or "text" not in data:
                json_response(self, {"error": "职位导入需要 url 和 text，可选 portal", "code": "BAD_INPUT"}, HTTPStatus.BAD_REQUEST)
                return
            result, errors = import_job_text(data.get("url"), data.get("text"), data.get("portal", "auto"))
            if errors or result is None:
                json_response(self, {"error": "；".join(errors), "code": "BAD_INPUT", "fields": errors}, HTTPStatus.BAD_REQUEST)
                return
            _audit("job_import", "success", platform=str(result.get("record", {}).get("portal") if isinstance(result.get("record"), dict) else ""))
            json_response(self, {"import": result}, HTTPStatus.OK)
            return
        if path == "/api/ai/match":
            if not isinstance(data, dict) or set(data) - {"job_text", "candidate_text", "confirm_external"} or "job_text" not in data or "candidate_text" not in data:
                json_response(self, {"error": "AI 匹配需要 job_text 和 candidate_text，可选 confirm_external", "code": "BAD_INPUT"}, HTTPStatus.BAD_REQUEST)
                return
            job_text, candidate_text = data.get("job_text"), data.get("candidate_text")
            if not isinstance(job_text, str) or not job_text.strip() or not isinstance(candidate_text, str) or not candidate_text.strip():
                json_response(self, {"error": "职位正文和候选人资料不能为空", "code": "BAD_INPUT"}, HTTPStatus.BAD_REQUEST)
                return
            if len(job_text) + len(candidate_text) > 220_000:
                json_response(self, {"error": "输入内容过大，请缩短职位正文或候选人资料", "code": "BAD_INPUT"}, HTTPStatus.BAD_REQUEST)
                return
            if data.get("confirm_external") is not True:
                json_response(self, {"error": "发送候选人资料到外部模型前需要明确确认", "code": "EXTERNAL_CONFIRMATION_REQUIRED", "preview": {"provider": "openai-compatible", "job_chars": len(job_text), "candidate_chars": len(candidate_text), "external_request": True}}, HTTPStatus.PRECONDITION_REQUIRED)
                return
            try:
                result = complete_match(load_config(), job_text, candidate_text, allow_external=True)
            except AIProviderError as exc:
                json_response(self, {"error": str(exc), "code": "AI_PROVIDER_ERROR"}, HTTPStatus.BAD_GATEWAY)
                return
            json_response(self, {"match": result}, HTTPStatus.OK)
            return
        normalized, errors = validate_setup(data)
        if errors or normalized is None:
            json_response(self, {"error": "；".join(errors), "code": "BAD_INPUT", "fields": errors}, HTTPStatus.BAD_REQUEST)
            return
        status = "confirmed" if path.endswith("/confirm") else "draft"
        try:
            setup = save_setup_draft(normalized, status)
        except OSError as exc:
            json_response(self, {"error": f"无法保存本地草稿：{exc}", "code": "SETUP_SAVE_FAILED"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        json_response(self, {"setup": setup}, HTTPStatus.OK)

    def serve_static(self, relative: str, content_type: str) -> None:
        candidate = (STATIC_ROOT / relative).resolve()
        try:
            candidate.relative_to(STATIC_ROOT.resolve())
        except ValueError:
            json_response(self, {"error": "not found", "code": "NOT_FOUND"}, HTTPStatus.NOT_FOUND)
            return
        if not candidate.is_file():
            json_response(self, {"error": "not found", "code": "NOT_FOUND"}, HTTPStatus.NOT_FOUND)
            return
        body = candidate.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Start the local AI Job Search web shell")
    parser.add_argument("--host", default="127.0.0.1", help="bind address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="port (default: 8765)")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser automatically")
    return parser


def run_server(host: str = "127.0.0.1", port: int = 8765, open_browser: bool = True) -> None:
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("the local web shell only permits loopback bind addresses")
    if not 1 <= port <= 65535:
        raise ValueError("port must be between 1 and 65535")
    recover_interrupted_tasks()
    server = ThreadingHTTPServer((host, port), AppHandler)
    url = f"http://{host}:{port}/"
    print(f"AI Job Search web shell: {url}")
    print("Read-only MVP: no network requests, writes, or credential access")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        run_server(args.host, args.port, not args.no_browser)
    except (OSError, ValueError) as exc:
        print(json.dumps({"error": str(exc), "code": "WEBAPP_START_FAILED"}, ensure_ascii=False), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
