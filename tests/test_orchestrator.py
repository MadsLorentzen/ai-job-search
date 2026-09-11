import json
import tempfile
import unittest
from pathlib import Path

from app.applications.drafting import ApplicationContext
from app.orchestrator.apply import ApplicationOrchestrator
from app.state.journal import TransactionalJournal
from app.state.models import ApplicationStatus, WorkflowStage
from tests.test_app_foundations import FakeProvider


class OrchestratorTests(unittest.TestCase):
    def test_run_persists_approved_workflow_without_external_submission(self):
        provider = FakeProvider(
            [
                json.dumps({
                    "technical_score": 80,
                    "experience_score": 80,
                    "behavioral_score": 80,
                    "career_score": 80,
                }),
                json.dumps({"cv_source": "CV", "cover_letter_source": "Letter"}),
                json.dumps({
                    "approved": True,
                    "issues": [],
                    "fabrication_flags": [],
                    "ats_issues": [],
                    "missing_requirements": [],
                    "recommendations": [],
                }),
            ]
        )
        with tempfile.TemporaryDirectory() as directory:
            journal = TransactionalJournal(Path(directory))
            orchestrator = ApplicationOrchestrator(provider, journal)
            run = orchestrator.run(
                "job-1",
                ApplicationContext("posting", "profile"),
                approve_fit=lambda fit: True,
                approve_final=lambda result: True,
            )
            self.assertEqual(run.state.stage, WorkflowStage.ARCHIVED)
            self.assertEqual(run.state.status, ApplicationStatus.COMPLETED)
            self.assertEqual(journal.load_state("job-1").stage, WorkflowStage.ARCHIVED)

    def test_fit_rejection_does_not_archive(self):
        provider = FakeProvider([
            json.dumps({
                "technical_score": 20,
                "experience_score": 20,
                "behavioral_score": 20,
                "career_score": 20,
            })
        ])
        with tempfile.TemporaryDirectory() as directory:
            run = ApplicationOrchestrator(provider, TransactionalJournal(Path(directory))).run(
                "job-2",
                ApplicationContext("posting", "profile"),
                approve_fit=lambda fit: False,
                approve_final=lambda result: True,
            )
            self.assertEqual(run.state.status, ApplicationStatus.FAILED)
            self.assertNotEqual(run.state.stage, WorkflowStage.ARCHIVED)


if __name__ == "__main__":
    unittest.main()