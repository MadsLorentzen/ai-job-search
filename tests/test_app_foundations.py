import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.core.security import SecurityError, sanitize_slug, validate_path_boundary
from app.llm.context import ContextBudgetPolicy, ContextDocument
from app.llm.exceptions import ContextLimitExceededError, SchemaValidationError
from app.llm.provider import LLMRequest, LLMResponse, StructuredOutputError, generate_structured
from app.llm.ollama import OllamaProvider
from app.llm.validation import (
    build_repair_prompt,
    extract_json_payload,
    validate_dict_schema,
)
from app.state.journal import TransactionalJournal
from app.state.machine import StateMachine
from app.state.models import (
    ApplicationStatus,
    WorkflowStage,
    WorkflowState,
)


class FakeProvider:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = 0

    def generate(self, request):
        response = self.responses[self.calls]
        self.calls += 1
        return LLMResponse(text=response, model="test-model")

    def health_check(self):
        return True

    def list_models(self):
        return ["test-model"]


class FoundationTests(unittest.TestCase):
    def test_slug_and_boundary(self):
        self.assertEqual(sanitize_slug("Senior Data/Engineer"), "senior_data_engineer")
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            self.assertEqual(validate_path_boundary(base / "state.json", base), base / "state.json")
            with self.assertRaises(SecurityError):
                validate_path_boundary(base / ".." / "outside.json", base)

    def test_state_machine_requires_human_approval_stage(self):
        machine = StateMachine(WorkflowState(job_id="job-1"))
        for stage in (
            WorkflowStage.NORMALIZED,
            WorkflowStage.FILTERED,
            WorkflowStage.RANKED,
            WorkflowStage.SHORTLISTED,
            WorkflowStage.ANALYZING,
            WorkflowStage.DRAFTING,
            WorkflowStage.REVIEWING,
            WorkflowStage.READY_FOR_APPROVAL,
        ):
            machine.transition_to(stage)
        self.assertEqual(machine.state.stage, WorkflowStage.READY_FOR_APPROVAL)
        machine.transition_to(WorkflowStage.COMPILING)
        self.assertEqual(machine.state.status, ApplicationStatus.RUNNING)

    def test_journal_round_trips_state_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = TransactionalJournal(Path(directory))
            state = WorkflowState(job_id="job-1", stage=WorkflowStage.RANKED)
            path = journal.save_state(state)
            loaded = journal.load_state("job-1")
            self.assertEqual(path.name, "job-1.json")
            self.assertEqual(loaded.stage, WorkflowStage.RANKED)
            self.assertFalse(path.with_name(f".{path.name}.tmp").exists())
            self.assertEqual(json.loads(path.read_text())["job_id"], "job-1")

    def test_structured_output_repairs_once(self):
        provider = FakeProvider(["not json", '{"score": 72}'])
        request = LLMRequest(system_prompt="system", user_prompt="user")

        result = generate_structured(
            provider,
            request,
            lambda text: json.loads(text),
            lambda original, error: LLMRequest(
                system_prompt=original.system_prompt,
                user_prompt=f"Return JSON only. Validation error: {error}",
            ),
        )

        self.assertEqual(result["score"], 72)
        self.assertEqual(provider.calls, 2)

    def test_structured_output_stops_after_failed_repair(self):
        provider = FakeProvider(["not json", "still not json"])
        with self.assertRaises(StructuredOutputError):
            generate_structured(
                provider,
                LLMRequest(system_prompt="system", user_prompt="user"),
                lambda text: json.loads(text),
                lambda original, error: original,
            )
        self.assertEqual(provider.calls, 2)

    @patch("app.llm.ollama.urlopen")
    def test_ollama_provider_maps_generate_response(self, mock_urlopen):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return b'{"response":"hello"}'

        mock_urlopen.return_value = Response()
        response = OllamaProvider(model="test-model").generate(
            LLMRequest(system_prompt="system", user_prompt="user", max_tokens=12)
        )
        self.assertEqual(response.text, "hello")
        self.assertEqual(response.model, "test-model")
        sent_payload = json.loads(mock_urlopen.call_args.args[0].data)
        self.assertFalse(sent_payload["stream"])
        self.assertEqual(sent_payload["options"]["num_predict"], 12)

    def test_extract_json_from_markdown_block(self):
        raw = 'Here is the response:\n```json\n{"status": "pass"}\n```\nHope that helps!'
        self.assertEqual(extract_json_payload(raw), '{"status": "pass"}')

    def test_schema_validation_reports_missing_key_and_type(self):
        valid, errors = validate_dict_schema(
            {"job_id": "123", "score": "ninety"},
            required_keys=["job_id", "score", "title"],
            field_types={"score": int},
        )
        self.assertFalse(valid)
        self.assertIn("Missing required field: 'title'", errors)
        self.assertIn("Field 'score' must be of type int, got str", errors)

    def test_repair_prompt_contains_validation_context(self):
        prompt = build_repair_prompt('{"name": "test"}', ["Missing required field: 'title'"])
        self.assertIn("Missing required field: 'title'", prompt)
        self.assertIn("Original raw output:", prompt)

    def test_context_budget_truncates_optional_documents(self):
        policy = ContextBudgetPolicy(max_characters=100)
        fitted, manifest = policy.fit(
            [
                ContextDocument("profile", "A" * 40, required=True),
                ContextDocument("history", "B" * 40, priority=1),
                ContextDocument("archive", "C" * 50, priority=2),
            ]
        )
        self.assertEqual(len(fitted), 2)
        self.assertLessEqual(manifest.total_characters, 100)
        self.assertIn("profile", manifest.included_documents)
        self.assertIn("history", manifest.included_documents)
        self.assertIn("archive", manifest.truncated_documents)

    def test_context_budget_rejects_oversized_required_documents(self):
        with self.assertRaises(ContextLimitExceededError):
            ContextBudgetPolicy(max_characters=50).fit(
                [ContextDocument("profile", "A" * 60, required=True)]
            )

    def test_validation_errors_are_typed(self):
        self.assertTrue(issubclass(SchemaValidationError, Exception))


if __name__ == "__main__":
    unittest.main()