import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


class MigratedPolicyTests(unittest.TestCase):
    def read(self, relative):
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_profile_policy_preserves_source_precedence(self):
        text = self.read("app/policies/profile_schema.md")
        for phrase in (
            "master CV",
            "CLAUDE.md",
            "must never overwrite",
            "requires_confirmation: true",
        ):
            self.assertIn(phrase, text)

    def test_evaluation_policy_preserves_weights_and_gates(self):
        text = self.read("app/policies/evaluation.md")
        for phrase in ("Technical skills: 30%", "Experience match: 25%", "Behavioral/culture fit: 15%", "Career alignment and motivation: 30%", "Language gate"):
            self.assertIn(phrase, text)

    def test_document_policy_preserves_toolchain(self):
        text = self.read("app/policies/document_templates.md")
        for phrase in ("lualatex", "xelatex", "pdfinfo", "pdftotext", "exactly two pages", "exactly one page"):
            self.assertIn(phrase, text)

    def test_writing_policy_preserves_grounding_rules(self):
        text = self.read("app/policies/writing.md")
        for phrase in ("active voice", "Do not use em-dashes", "never hidden", "master CV"):
            self.assertIn(phrase, text)


if __name__ == "__main__":
    unittest.main()