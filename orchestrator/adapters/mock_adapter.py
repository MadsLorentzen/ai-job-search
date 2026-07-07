from __future__ import annotations

import json
from typing import Any

from orchestrator.adapters.base import BaseAdapter


class MockAdapter(BaseAdapter):
    """Deterministic adapter used by tests and local dry runs."""

    backend_name = "mock"

    def send_chat(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        stop: list[str] | None = None,
    ) -> dict[str, Any]:
        prompt = "\n\n".join(message.get("content", "") for message in messages)
        return {"text": self._response_for(prompt), "usage": {"mock": True}}

    def single_shot(self, prompt: str, max_tokens: int, temperature: float) -> str:
        return self._response_for(prompt)

    def _response_for(self, prompt: str) -> str:
        lower = prompt.lower()
        if "extract company" in lower or "parse the job posting" in lower:
            return json.dumps(
                {
                    "company": "TestCompany",
                    "role": "TestRole",
                    "department": "Engineering",
                    "location": "Remote",
                    "language": "English",
                }
            )
        if "produce two files" in lower or "cv_tex" in lower:
            return json.dumps(
                {
                    "cv_filename": "cv/main_TestCompany.tex",
                    "cover_letter_filename": "cover_letters/cover_TestCompany_TestRole.tex",
                    "cv_tex": (
                        "\\documentclass{article}\n"
                        "\\begin{document}\n"
                        "Test Candidate\\\\\n"
                        "built ML models to improve retention\n"
                        "\\end{document}\n"
                    ),
                    "cover_letter_tex": (
                        "\\documentclass{article}\n"
                        "\\begin{document}\n"
                        "Dear Hiring Manager, I am excited about TestRole at TestCompany.\n"
                        "\\end{document}\n"
                    ),
                }
            )
        if "evaluate how well" in lower or "overall_score" in lower:
            return json.dumps(
                {
                    "skills_match": ["Python", "machine learning"],
                    "skills_gaps": ["Kubernetes"],
                    "experience_match": ["Built ML workflows in Python"],
                    "behavioral_fit": "Analytical and collaborative; moderate alignment.",
                    "salary_benchmark": None,
                    "overall_score": 74,
                    "recommendation": "moderate",
                }
            )
        if "hiring-manager proxy" in lower or "part a" in lower:
            return (
                "PART_A_JSON_START\n"
                "[{\"file\":\"cv/main_TestCompany.tex\","
                "\"old_string\":\"built ML models to improve retention\","
                "\"new_string\":\"developed ML pipelines for customer retention\","
                "\"reason\":\"Match the posting's wording more directly.\"}]\n"
                "PART_A_JSON_END\n\n"
                "## Missed keywords/requirements\n"
                "- Kubernetes remains a gap.\n\n"
                "## Company/department-specific angles\n"
                "- Connect Python workflow experience to the engineering team.\n\n"
                "## Action-oriented reframing\n"
                "- Prefer concrete verbs in the CV.\n\n"
                "## Tone and style issues\n"
                "- Tone is concise and factual.\n"
            )
        return json.dumps({"status": "ok"})
