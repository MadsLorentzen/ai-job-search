from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from product.job_understanding_cli import main
from product.job_understanding_providers import (
    DeterministicFakeProvider,
    JobUnderstandingProviderError,
    ProviderCallAudit,
)


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "job_understanding" / "job-snapshot.json"


def candidate() -> dict:
    return {
        "schema_version": "job-understanding-candidate.v0",
        "items": [
            {
                "proposal_id": "cli-proposal-1",
                "category": "requirements",
                "kind": "required",
                "quote": "Python is required.",
                "certainty": "explicit",
            }
        ],
        "suggestions": [],
        "ambiguous_statements": [],
        "warnings": [],
    }


class AuditedFakeProvider(DeterministicFakeProvider):
    provider_id = "openai"
    model_id = "gpt-5.4-mini"
    model_version = "gpt-5.4-mini-2026-03-17"

    def __init__(self):
        super().__init__(candidate(), response_id="resp_cli")
        self.last_audit = ProviderCallAudit(
            provider_id=self.provider_id,
            model_id=self.model_id,
            model_version=self.model_version,
            provider_response_id="resp_cli",
            started_at="2026-08-16T12:00:00Z",
            elapsed_ms=100,
            attempt_count=1,
            input_tokens=10,
            output_tokens=20,
            total_tokens=30,
        )


class FailingProvider:
    provider_id = "openai"
    model_id = "gpt-5.4-mini"
    model_version = "gpt-5.4-mini-2026-03-17"
    last_audit = None

    def extract(self, request):
        raise JobUnderstandingProviderError("bounded provider failure")


class JobUnderstandingCliTests(unittest.TestCase):
    def invoke(self, provider, path=FIXTURE):
        stdout = io.StringIO()
        stderr = io.StringIO()
        with patch(
            "product.job_understanding_cli.OpenAIJobUnderstandingProvider",
            return_value=provider,
        ), redirect_stdout(stdout), redirect_stderr(stderr):
            code = main(
                [
                    "extract",
                    str(path),
                    "--provider",
                    "openai",
                    "--request-id",
                    "cli-request",
                    "--category",
                    "requirements",
                ]
            )
        return code, stdout.getvalue(), stderr.getvalue()

    def test_success_keeps_result_on_stdout_and_bounded_audit_on_stderr(self):
        code, stdout, stderr = self.invoke(AuditedFakeProvider())
        self.assertEqual(code, 0)
        result = json.loads(stdout)
        audit = json.loads(stderr)["provider_audit"]
        self.assertEqual(result["status"], "READY")
        self.assertEqual(audit["total_tokens"], 30)
        self.assertNotIn("Python is required", stderr)

    def test_provider_failure_is_nonzero_without_source_or_traceback(self):
        code, stdout, stderr = self.invoke(FailingProvider())
        self.assertEqual(code, 2)
        self.assertEqual(stdout, "")
        error = json.loads(stderr)
        self.assertEqual(error["error"], "provider_error")
        self.assertNotIn("Python is required", stderr)
        self.assertNotIn("Traceback", stderr)

    def test_malformed_input_is_nonzero_and_does_not_echo_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "job.json"
            path.write_text("{private malformed", encoding="utf-8")
            code, stdout, stderr = self.invoke(AuditedFakeProvider(), path)
        self.assertEqual(code, 4)
        self.assertEqual(stdout, "")
        self.assertNotIn("private malformed", stderr)

    def test_validation_failure_does_not_echo_provider_assertion_text(self):
        invalid = candidate()
        invalid["items"][0]["proposal_id"] = "private-provider-assertion"
        invalid["suggestions"] = [
            {
                "proposal_id": "private-provider-assertion",
                "text": "do not log this",
                "reason": "do not log this either",
                "quote": "Python is required.",
            }
        ]
        code, stdout, stderr = self.invoke(DeterministicFakeProvider(invalid))
        self.assertEqual(code, 3)
        self.assertEqual(stdout, "")
        self.assertNotIn("private-provider-assertion", stderr)
        self.assertNotIn("do not log this", stderr)


if __name__ == "__main__":
    unittest.main()
