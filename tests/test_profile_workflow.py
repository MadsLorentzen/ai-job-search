import json
import tempfile
import unittest
from pathlib import Path

from app.profile.extract import build_source_documents, discover_documents, extract_cv_facts
from app.profile.models import (
    ApprovalPlan,
    ProfileCategory,
    ProfileDocument,
    ProfileProposal,
    ProfileSource,
    parse_approval_command,
)
from app.profile.workflow import apply_approved_updates, propose_profile_updates
from tests.test_app_foundations import FakeProvider


class ProfileWorkflowTests(unittest.TestCase):
    def test_document_discovery_and_cv_fact_extraction_are_deterministic(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "documents" / "cv").mkdir(parents=True)
            (root / "documents" / "README.md").write_text("ignore", encoding="utf-8")
            source = root / "documents" / "cv" / "resume.tex"
            source.write_text("\\cventry{2020--2024}{Data Engineer}{Acme}{}{}{}", encoding="utf-8")
            paths = discover_documents(root / "documents")
            self.assertEqual(paths, [source])
            self.assertEqual(len(extract_cv_facts(source.read_text())), 1)

    def test_profile_proposals_never_promote_inferred_history(self):
        provider = FakeProvider([
            json.dumps([
                {
                    "field": "experience",
                    "category": "historical_fact",
                    "current_value": "",
                    "proposed_value": "Invented role",
                    "source": "model_inference",
                    "reasoning": "inferred",
                    "confidence": 0.99,
                },
                {
                    "field": "target_roles",
                    "category": "application_preference",
                    "current_value": "",
                    "proposed_value": "Data Engineer",
                    "source": "CLAUDE.md",
                    "reasoning": "preference",
                    "confidence": 0.9,
                },
            ])
        ])
        documents = [
            ProfileDocument("cv/main_example.tex", "historical", ProfileSource.MASTER_CV, ProfileCategory.HISTORICAL_FACT),
            ProfileDocument("CLAUDE.md", "preferences", ProfileSource.PREFERENCES, ProfileCategory.APPLICATION_PREFERENCE),
        ]
        plan = propose_profile_updates(provider, documents)
        self.assertEqual(len(plan.proposals), 1)
        self.assertEqual(plan.proposals[0].field, "target_roles")

    def test_approval_controls_support_all_select_edit_and_reject(self):
        self.assertEqual(parse_approval_command("A", 3), {1: None, 2: None, 3: None})
        self.assertEqual(parse_approval_command("1, 3", 3), {1: None, 3: None})
        self.assertEqual(parse_approval_command("E 2=Updated value", 3), {2: "Updated value"})
        self.assertEqual(parse_approval_command("R", 3), {})

    def test_apply_updates_calls_writer_only_for_approved_items(self):
        plan = ApprovalPlan([
            ProfileProposal(1, "target_roles", ProfileCategory.APPLICATION_PREFERENCE, "", "Data", "CLAUDE.md", "", 0.9),
            ProfileProposal(2, "experience", ProfileCategory.HISTORICAL_FACT, "", "Role", "master_cv", "", 0.9),
        ])
        applied = []
        apply_approved_updates(plan, {1: "Edited Data"}, lambda proposal, value: applied.append((proposal.item_id, value)))
        self.assertEqual(applied, [(1, "Edited Data")])

    def test_build_source_documents_includes_preference_and_master_cv(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "cv").mkdir()
            (root / "documents").mkdir()
            (root / "cv" / "main_example.tex").write_text("cv", encoding="utf-8")
            (root / "CLAUDE.md").write_text("preferences", encoding="utf-8")
            documents = build_source_documents(root)
            self.assertEqual([document.source for document in documents], [ProfileSource.MASTER_CV, ProfileSource.PREFERENCES])


if __name__ == "__main__":
    unittest.main()