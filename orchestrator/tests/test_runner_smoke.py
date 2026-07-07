from pathlib import Path

from orchestrator.runner import main
from orchestrator.utils import apply_structured_edits


def test_apply_structured_edits_applies_unique_replacement():
    files = {"cv/main_TestCompany.tex": "built ML models to improve retention"}
    edits = [
        {
            "file": "cv/main_TestCompany.tex",
            "old_string": "built ML models to improve retention",
            "new_string": "developed ML pipelines for customer retention",
            "reason": "stronger wording",
        }
    ]

    result = apply_structured_edits(files, edits)

    assert not result.failures
    assert "developed ML pipelines" in result.files["cv/main_TestCompany.tex"]


def test_apply_structured_edits_rejects_non_unique_replacement():
    files = {"cv/main_TestCompany.tex": "repeat repeat"}
    edits = [
        {
            "file": "cv/main_TestCompany.tex",
            "old_string": "repeat",
            "new_string": "changed",
            "reason": "ambiguous",
        }
    ]

    result = apply_structured_edits(files, edits)

    assert result.failures
    assert result.files["cv/main_TestCompany.tex"] == "repeat repeat"


def test_runner_apply_mock_smoke_creates_files(tmp_path):
    fixture_dir = Path("orchestrator/tests/fixtures")
    exit_code = main(
        [
            "apply",
            "--job-text-file",
            str(fixture_dir / "example_job.md"),
            "--profile",
            str(fixture_dir / "example_profile.md"),
            "--backend",
            "mock",
            "--output-dir",
            str(tmp_path),
            "--skip-compile",
            "--yes",
        ]
    )

    assert exit_code == 0
    cv_path = tmp_path / "cv" / "main_TestCompany.tex"
    cover_path = tmp_path / "cover_letters" / "cover_TestCompany_TestRole.tex"
    report_path = tmp_path / "orchestrator_apply_report.md"
    assert cv_path.exists()
    assert cover_path.exists()
    assert report_path.exists()
    assert "developed ML pipelines for customer retention" in cv_path.read_text(encoding="utf-8")
    assert "Verification Checklist" in report_path.read_text(encoding="utf-8")
