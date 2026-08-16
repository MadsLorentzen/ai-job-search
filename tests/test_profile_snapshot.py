"""Tests for the Candidate Profile & Evidence Snapshot v0 adapter."""

import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from product.profile_snapshot import (
    SCHEMA_VERSION,
    ID_SEMANTICS,
    SnapshotValidationError,
    build_snapshot,
    main,
    validate_snapshot,
)


CLAUDE_TEMPLATE = """# Job Application Assistant for {name}

## Candidate Profile

### Identity
- **Name:** {name}
- **Location:** {location}
- **Languages:**

| Language | Level |
|----------|-------|
| {language} | {language_level} |

- **Status:** {status}

### Education
- **{degree}** ({education_dates}) - {institution}

### Professional Experience
- **{job_title}** ({employment_dates}) - **{company}** ({location})

### Technical Skills
- **Primary:** {skills}
- **Domain:** {domain}
- **Software:** {software}

### Publications
- {publication}

### Awards
- **{award}** - Industry Guild ({award_year})

### Deal-breakers
- {constraint}

## Workflow for New Job Applications
This section is methodology and must not be parsed as candidate evidence.
"""


CANDIDATE_TEMPLATE = """---
framework_version: 1.0.0
---

# Candidate Profile

## Identity
- **Name:** {name}
- **Location:** {location}
- **Phone:** {phone}
- **Email:** {email}
- **LinkedIn:** {linkedin}
- **GitHub:** {github}
- **Status:** {status}
- **Constraints:** {constraint}

### Languages

| Language | Level | Notes |
|----------|-------|-------|
| {language} | {language_level} | professional use |

## Education

| Degree | Period | Institution | Key Topics |
|--------|--------|-------------|------------|
| {degree} | {education_dates} | {institution} | Modelling |

## Professional Experience

### {job_title} - {company} ({employment_dates})
{location}
- Built a verified system.

## Independent Projects
- **Evidence Mapper:** Linked claims to source records.

## Technical Skills

### Programming & ML
- **Languages:** {skills}

### Domain Expertise
- {domain}

### Software & Tools
- {software}

## Publications
1. {publication}

## Awards
- {award} - Industry Guild ({award_year})
"""


CV_TEMPLATE = r"""\documentclass{{moderncv}}
\name{{{first_name}}}{{{last_name}}}
\address{{{location}}}{{}}{{}}
\phone[mobile]{{{phone}}}
\email{{{email}}}
\extrainfo{{\href{{{linkedin}}}{{LinkedIn}}, \href{{{github}}}{{GitHub}}}}

\begin{{document}}
\section{{Core Competencies}}
\begin{{itemize}}
\item \textbf{{Technical}}: {skills}
\item \textbf{{Domain}}: {domain}
\item \textbf{{Software}}: {software}
\end{{itemize}}

\section{{Professional Experience}}
\begin{{itemize}}
\item{{\cventry{{{employment_dates}}}{{{job_title}}}{{{company}}}{{{location}}}{{}}{{
\begin{{itemize}}
\item Built a verified system.
\end{{itemize}}}}}}
\end{{itemize}}

\section{{Education}}
\begin{{itemize}}
\item{{\cventry{{{education_dates}}}{{{degree}}}{{{institution}}}{{{location}}}{{}}{{Modelling.}}}}
\end{{itemize}}

\section{{Languages}}
\begin{{itemize}}
\item {language} ({language_level}).
\end{{itemize}}

\section{{Publications}}
\begin{{itemize}}
\item {publication}
\end{{itemize}}

\section{{Honors and Awards}}
\begin{{itemize}}
\item {award} - Industry Guild ({award_year}).
\end{{itemize}}
\end{{document}}
"""


DEFAULTS = {
    "name": "José Østergaard",
    "first_name": "José",
    "last_name": "Østergaard",
    "location": "Malmö, Sweden",
    "phone": "+46 70 123 45 67",
    "email": "jose@example.test",
    "linkedin": "https://linkedin.example/jose",
    "github": "https://github.example/jose",
    "status": "Employed",
    "language": "Dansk",
    "language_level": "Native",
    "degree": "MSc in Geophysics",
    "education_dates": "2014-09 - 2016-06",
    "institution": "Københavns Universitet",
    "job_title": "Data Engineer",
    "employment_dates": "2020-01 - 2024-03-31",
    "company": "Acme Energy",
    "skills": "Python",
    "domain": "Geophysics",
    "software": "Git",
    "publication": "Østergaard (2021). Bølgeanalyse. Nordic Journal.",
    "award": "Best Applied Model",
    "award_year": "2022",
    "constraint": "No relocation",
}


class SnapshotFixture:
    def __init__(self, test_case, **overrides):
        self.test_case = test_case
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        values = {**DEFAULTS, **overrides}
        self.write_sources(values, values, values)

    def write_sources(self, claude_values, candidate_values, cv_values):
        candidate_dir = self.root / ".claude/skills/job-application-assistant"
        candidate_dir.mkdir(parents=True, exist_ok=True)
        cv_dir = self.root / "cv"
        cv_dir.mkdir(parents=True, exist_ok=True)
        (self.root / "CLAUDE.md").write_text(
            CLAUDE_TEMPLATE.format(**claude_values), encoding="utf-8"
        )
        (candidate_dir / "01-candidate-profile.md").write_text(
            CANDIDATE_TEMPLATE.format(**candidate_values), encoding="utf-8"
        )
        (cv_dir / "main_example.tex").write_text(
            CV_TEMPLATE.format(**cv_values), encoding="utf-8"
        )

    def cleanup(self):
        self.tempdir.cleanup()

    def write_employment_roles(self, claude_roles, candidate_roles, cv_roles):
        def role_values(role):
            return {
                "title": role["title"],
                "dates": role["dates"],
                "employer": role.get("employer", "Acme Energy"),
                "location": role.get("location", "Malmö, Sweden"),
                "details": role.get("details", ["Built a verified system."]),
            }

        claude_lines = [
            "# Assistant",
            "",
            "## Candidate Profile",
            "",
            "### Identity",
            "- **Name:** José Østergaard",
            "",
            "### Professional Experience",
        ]
        for raw_role in claude_roles:
            role = role_values(raw_role)
            claude_lines.append(
                f"- **{role['title']}** ({role['dates']}) - "
                f"**{role['employer']}** ({role['location']})"
            )

        candidate_lines = [
            "# Candidate Profile",
            "",
            "## Identity",
            "- **Name:** José Østergaard",
            "",
            "## Professional Experience",
        ]
        for raw_role in candidate_roles:
            role = role_values(raw_role)
            candidate_lines.extend(
                [
                    "",
                    f"### {role['title']} - {role['employer']} ({role['dates']})",
                    role["location"],
                    *(f"- {detail}" for detail in role["details"]),
                ]
            )

        cv_lines = [
            r"\documentclass{moderncv}",
            r"\name{José}{Østergaard}",
            r"\begin{document}",
            r"\section{Professional Experience}",
            r"\begin{itemize}",
        ]
        for raw_role in cv_roles:
            role = role_values(raw_role)
            details = "\n".join(rf"\item {detail}" for detail in role["details"])
            cv_lines.extend(
                [
                    rf"\item{{\cventry{{{role['dates']}}}{{{role['title']}}}"
                    rf"{{{role['employer']}}}{{{role['location']}}}{{}}{{",
                    r"\begin{itemize}",
                    details,
                    r"\end{itemize}}}}",
                ]
            )
        cv_lines.extend([r"\end{itemize}", r"\end{document}"])

        self.write_sources(DEFAULTS, DEFAULTS, DEFAULTS)
        (self.root / "CLAUDE.md").write_text(
            "\n".join(claude_lines) + "\n", encoding="utf-8"
        )
        candidate_path = self.root / ".claude/skills/job-application-assistant/01-candidate-profile.md"
        candidate_path.write_text(
            "\n".join(candidate_lines) + "\n", encoding="utf-8"
        )
        (self.root / "cv/main_example.tex").write_text(
            "\n".join(cv_lines) + "\n", encoding="utf-8"
        )


class CandidateProfileSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.fixture = SnapshotFixture(self)

    def tearDown(self):
        self.fixture.cleanup()

    def test_consistent_populated_profile_is_valid_and_corroborated(self):
        snapshot = build_snapshot(self.fixture.root)

        validate_snapshot(snapshot)
        self.assertEqual(snapshot["schema_version"], SCHEMA_VERSION)
        self.assertEqual(snapshot["id_semantics"], ID_SEMANTICS)
        self.assertEqual(snapshot["summary"]["source_count"], 3)
        self.assertEqual(snapshot["summary"]["conflict_count"], 0)
        self.assertTrue(
            all(
                claim["source"]["line_end"] >= claim["source"]["line_start"]
                for claim in snapshot["claims"]
            )
        )
        fields = {(claim["category"], claim["field"]) for claim in snapshot["claims"]}
        for required in {
            ("identity", "name"),
            ("contact", "email"),
            ("location", "location"),
            ("identity", "employment_status"),
            ("employment", "job_title"),
            ("education", "qualification"),
            ("languages", "language"),
            ("skills", "technical_skill"),
            ("skills", "domain_skill"),
            ("skills", "software_or_tool"),
            ("projects", "name"),
            ("publications", "publication"),
            ("awards", "award"),
            ("constraints", "constraint"),
        }:
            self.assertIn(required, fields)
        self.assertGreater(snapshot["summary"]["corroboration_count"], 0)

    def test_untouched_placeholder_profile_marks_claims_without_conflicts(self):
        placeholders = {
            **DEFAULTS,
            "name": "[YOUR_NAME]",
            "first_name": "[First]",
            "last_name": "[Last]",
            "location": "[YOUR_LOCATION]",
            "phone": "[YOUR_PHONE]",
            "email": "[YOUR_EMAIL]",
            "linkedin": "[YOUR_LINKEDIN_URL]",
            "github": "[YOUR_GITHUB_URL]",
            "status": "[YOUR_EMPLOYMENT_STATUS]",
            "language": "[LANGUAGE]",
            "language_level": "[LEVEL]",
            "degree": "[DEGREE]",
            "education_dates": "[YEAR_START]-[YEAR_END]",
            "institution": "[INSTITUTION]",
            "job_title": "[JOB_TITLE]",
            "employment_dates": "[START]-[END]",
            "company": "[COMPANY]",
            "skills": "[YOUR_PRIMARY_SKILLS]",
            "domain": "[YOUR_DOMAIN_EXPERTISE]",
            "software": "[YOUR_TOOLS]",
            "publication": "[PUBLICATION]",
            "award": "[AWARD]",
            "award_year": "[YEAR]",
            "constraint": "[CONSTRAINT]",
        }
        self.fixture.write_sources(placeholders, placeholders, placeholders)

        snapshot = build_snapshot(self.fixture.root)

        self.assertGreater(snapshot["summary"]["placeholder_claim_count"], 0)
        self.assertEqual(snapshot["summary"]["conflict_count"], 0)
        name_claims = [
            claim for claim in snapshot["claims"]
            if claim["category"] == "identity" and claim["field"] == "name"
        ]
        self.assertTrue(name_claims)
        self.assertTrue(all(claim["placeholder"] for claim in name_claims))
        language_claims = [
            claim for claim in snapshot["claims"] if claim["category"] == "languages"
        ]
        self.assertTrue(language_claims)
        self.assertTrue(all(claim["placeholder"] for claim in language_claims))

    def test_conflicting_employment_dates_are_returned_not_resolved(self):
        cv_values = {**DEFAULTS, "employment_dates": "2020-01 - 2024-04-30"}
        self.fixture.write_sources(DEFAULTS, DEFAULTS, cv_values)

        snapshot = build_snapshot(self.fixture.root)
        conflicts = [
            conflict for conflict in snapshot["conflicts"]
            if conflict["category"] == "employment" and conflict["field"] == "date_range"
        ]

        self.assertEqual(len(conflicts), 1)
        self.assertEqual(
            {variant["value"] for variant in conflicts[0]["variants"]},
            {"2020-01 - 2024-03-31", "2020-01 - 2024-04-30"},
        )
        self.assertTrue(
            all(variant["provenance"] for variant in conflicts[0]["variants"])
        )

    def test_conflicting_job_titles_are_returned_not_resolved(self):
        cv_values = {**DEFAULTS, "job_title": "Senior Data Engineer"}
        self.fixture.write_sources(DEFAULTS, DEFAULTS, cv_values)

        snapshot = build_snapshot(self.fixture.root)
        conflicts = [
            conflict for conflict in snapshot["conflicts"]
            if conflict["category"] == "employment" and conflict["field"] == "job_title"
        ]

        self.assertEqual(len(conflicts), 1)
        self.assertEqual(
            {variant["value"] for variant in conflicts[0]["variants"]},
            {"Data Engineer", "Senior Data Engineer"},
        )

    def test_fact_in_only_one_source_remains_a_single_provenanced_claim(self):
        snapshot = build_snapshot(self.fixture.root)
        project_claims = [
            claim for claim in snapshot["claims"]
            if claim["category"] == "projects" and claim["field"] == "name"
        ]

        self.assertEqual(len(project_claims), 1)
        source_files = {claim["source"]["file"] for claim in project_claims}
        self.assertEqual(
            source_files,
            {
                ".claude/skills/job-application-assistant/01-candidate-profile.md",
            },
        )

    def test_unicode_content_is_preserved(self):
        snapshot = build_snapshot(self.fixture.root)
        values = [claim["value"] for claim in snapshot["claims"]]

        self.assertIn("José Østergaard", values)
        self.assertIn("Københavns Universitet", values)
        self.assertIn("Dansk", values)

    def test_exact_dates_are_preserved(self):
        exact = "2020-01-15 - 2024-03-31"
        values = {**DEFAULTS, "employment_dates": exact}
        self.fixture.write_sources(values, values, values)

        snapshot = build_snapshot(self.fixture.root)
        date_claims = [
            claim for claim in snapshot["claims"]
            if claim["category"] == "employment" and claim["field"] == "date_range"
        ]

        self.assertTrue(date_claims)
        self.assertEqual({claim["value"] for claim in date_claims}, {exact})

    def test_missing_optional_sections_do_not_fail(self):
        sparse_claude = """# Assistant\n\n## Candidate Profile\n\n### Identity\n- **Name:** Ada Lovelace\n"""
        sparse_candidate = """# Candidate Profile\n\n## Identity\n- **Name:** Ada Lovelace\n"""
        sparse_cv = r"""\documentclass{moderncv}\name{Ada}{Lovelace}\begin{document}\end{document}"""
        (self.fixture.root / "CLAUDE.md").write_text(sparse_claude, encoding="utf-8")
        candidate_path = self.fixture.root / ".claude/skills/job-application-assistant/01-candidate-profile.md"
        candidate_path.write_text(sparse_candidate, encoding="utf-8")
        (self.fixture.root / "cv/main_example.tex").write_text(sparse_cv, encoding="utf-8")

        snapshot = build_snapshot(self.fixture.root)

        self.assertEqual(snapshot["summary"]["conflict_count"], 0)
        self.assertEqual(
            {claim["value"] for claim in snapshot["claims"] if claim["field"] == "name"},
            {"Ada Lovelace"},
        )

    def test_claim_ids_are_deterministic_and_sources_are_not_modified(self):
        source_paths = [
            self.fixture.root / "CLAUDE.md",
            self.fixture.root / ".claude/skills/job-application-assistant/01-candidate-profile.md",
            self.fixture.root / "cv/main_example.tex",
        ]
        before = {path: path.read_bytes() for path in source_paths}

        first = build_snapshot(self.fixture.root)
        second = build_snapshot(self.fixture.root)

        self.assertEqual(
            [claim["id"] for claim in first["claims"]],
            [claim["id"] for claim in second["claims"]],
        )
        self.assertEqual(before, {path: path.read_bytes() for path in source_paths})

    def test_cli_emits_machine_readable_json(self):
        output = io.StringIO()
        with redirect_stdout(output):
            exit_code = main(["--root", str(self.fixture.root), "--compact"])

        self.assertEqual(exit_code, 0)
        snapshot = json.loads(output.getvalue())
        self.assertEqual(snapshot["schema_version"], SCHEMA_VERSION)

    def test_two_roles_at_same_employer_link_in_same_order(self):
        roles = [
            {"title": "Engineer", "dates": "2020-01 - 2022-03"},
            {"title": "Senior Engineer", "dates": "2022-04 - 2024-03"},
        ]
        self.fixture.write_employment_roles(roles, roles, roles)

        snapshot = build_snapshot(self.fixture.root)
        employment_claims = [
            claim for claim in snapshot["claims"]
            if claim["category"] == "employment"
        ]

        self.assertEqual(len({claim["record_id"] for claim in employment_claims}), 2)
        self.assertFalse(
            [group for group in snapshot["conflicts"] if group["category"] == "employment"]
        )

    def test_two_roles_at_same_employer_link_when_source_order_differs(self):
        roles = [
            {"title": "Engineer", "dates": "2020-01 - 2022-03"},
            {"title": "Senior Engineer", "dates": "2022-04 - 2024-03"},
        ]
        self.fixture.write_employment_roles(roles, list(reversed(roles)), roles)

        snapshot = build_snapshot(self.fixture.root)
        employment_claims = [
            claim for claim in snapshot["claims"]
            if claim["category"] == "employment"
        ]

        self.assertEqual(len({claim["record_id"] for claim in employment_claims}), 2)
        self.assertFalse(
            [group for group in snapshot["conflicts"] if group["category"] == "employment"]
        )

    def test_genuinely_ambiguous_repeated_employment_is_not_linked(self):
        claude_roles = [
            {"title": "Engineer", "dates": "2020 - 2021"},
            {"title": "Engineer", "dates": "2022 - 2023"},
        ]
        candidate_roles = [{"title": "Engineer", "dates": "2019 - 2020"}]
        self.fixture.write_employment_roles(claude_roles, candidate_roles, [])

        snapshot = build_snapshot(self.fixture.root)
        employment_claims = [
            claim for claim in snapshot["claims"]
            if claim["category"] == "employment"
        ]

        self.assertEqual(len({claim["record_id"] for claim in employment_claims}), 3)
        self.assertFalse(
            [group for group in snapshot["conflicts"] if group["category"] == "employment"]
        )
        self.assertFalse(
            [group for group in snapshot["corroborations"] if group["category"] == "employment"]
        )

    def test_responsibilities_retain_parent_employment_record_id(self):
        claude_role = {"title": "Engineer", "dates": "2020 - 2024", "details": []}
        candidate_role = {
            **claude_role,
            "details": ["Built the platform.", "Mentored two engineers."],
        }
        cv_role = {
            **claude_role,
            "details": ["Built the platform.", "Reduced latency by 40%."],
        }
        self.fixture.write_employment_roles(
            [claude_role], [candidate_role], [cv_role]
        )

        snapshot = build_snapshot(self.fixture.root)
        employment_claims = [
            claim for claim in snapshot["claims"]
            if claim["category"] == "employment"
        ]
        responsibility_claims = [
            claim for claim in employment_claims
            if claim["field"] == "responsibility_or_achievement"
        ]

        self.assertGreaterEqual(len(responsibility_claims), 3)
        self.assertEqual(len({claim["record_id"] for claim in employment_claims}), 1)
        self.assertFalse(
            [
                group for group in snapshot["conflicts"]
                if group["field"] == "responsibility_or_achievement"
            ]
        )

    def test_claim_ids_survive_unrelated_line_insertion(self):
        before = build_snapshot(self.fixture.root)
        claude_path = self.fixture.root / "CLAUDE.md"
        claude_path.write_text(
            "<!-- unrelated note -->\n" + claude_path.read_text(encoding="utf-8"),
            encoding="utf-8",
        )

        after = build_snapshot(self.fixture.root)
        before_ids = {
            claim["id"] for claim in before["claims"]
            if claim["source"]["file"] == "CLAUDE.md"
        }
        after_ids = {
            claim["id"] for claim in after["claims"]
            if claim["source"]["file"] == "CLAUDE.md"
        }
        before_record_ids = {
            claim["record_id"] for claim in before["claims"]
            if claim["source"]["file"] == "CLAUDE.md"
        }
        after_record_ids = {
            claim["record_id"] for claim in after["claims"]
            if claim["source"]["file"] == "CLAUDE.md"
        }

        self.assertEqual(before_ids, after_ids)
        self.assertEqual(before_record_ids, after_record_ids)
        self.assertNotEqual(before["sources"], after["sources"])

    def test_legitimate_bracketed_text_is_not_a_placeholder(self):
        values = {**DEFAULTS, "status": "Available [after notice period]"}
        self.fixture.write_sources(values, values, values)

        snapshot = build_snapshot(self.fixture.root)
        status_claims = [
            claim for claim in snapshot["claims"]
            if claim["field"] == "employment_status"
        ]

        self.assertTrue(status_claims)
        self.assertTrue(all(not claim["placeholder"] for claim in status_claims))

    def test_validator_rejects_malformed_summary_and_groups(self):
        snapshot = build_snapshot(self.fixture.root)
        invalid_snapshots = []

        wrong_summary = copy.deepcopy(snapshot)
        wrong_summary["summary"]["claim_count"] += 1
        invalid_snapshots.append(("summary count", wrong_summary))

        duplicate_source = copy.deepcopy(snapshot)
        duplicate_source["sources"].append(copy.deepcopy(duplicate_source["sources"][0]))
        duplicate_source["summary"]["source_count"] += 1
        invalid_snapshots.append(("duplicate source", duplicate_source))

        extra_corroboration_variant = copy.deepcopy(snapshot)
        extra_corroboration_variant["corroborations"][0]["variants"].append(
            copy.deepcopy(extra_corroboration_variant["corroborations"][0]["variants"][0])
        )
        invalid_snapshots.append(("corroboration variants", extra_corroboration_variant))

        wrong_group_field = copy.deepcopy(snapshot)
        wrong_group_field["corroborations"][0]["field"] = "wrong_field"
        invalid_snapshots.append(("group field", wrong_group_field))

        wrong_group_concept = copy.deepcopy(snapshot)
        alternate_concept = next(
            claim["concept_id"] for claim in wrong_group_concept["claims"]
            if claim["concept_id"] != wrong_group_concept["corroborations"][0]["concept_id"]
        )
        wrong_group_concept["corroborations"][0]["concept_id"] = alternate_concept
        invalid_snapshots.append(("group concept", wrong_group_concept))

        empty_provenance = copy.deepcopy(snapshot)
        empty_provenance["corroborations"][0]["variants"][0]["provenance"] = []
        invalid_snapshots.append(("empty provenance", empty_provenance))

        for label, invalid in invalid_snapshots:
            with self.subTest(label=label):
                with self.assertRaises(SnapshotValidationError):
                    validate_snapshot(invalid)

    def test_validator_rejects_conflict_with_only_one_variant(self):
        cv_values = {**DEFAULTS, "employment_dates": "2020-01 - 2024-04-30"}
        self.fixture.write_sources(DEFAULTS, DEFAULTS, cv_values)
        snapshot = build_snapshot(self.fixture.root)
        invalid = copy.deepcopy(snapshot)
        invalid["conflicts"][0]["variants"] = invalid["conflicts"][0]["variants"][:1]

        with self.assertRaises(SnapshotValidationError):
            validate_snapshot(invalid)


if __name__ == "__main__":
    unittest.main()
