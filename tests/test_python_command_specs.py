"""Guard: workflow specs run their Python tools through a resolved interpreter.

Every code block these specs hand to Bash used to spell the interpreter literally -
`python3 tools/rank_state.py` here, `python salary_lookup.py` there. Neither
spelling is portable: on a stock Windows python.org install `python3` is the
Microsoft Store App execution alias, which exits 49 in a non-interactive shell
with no output at all (#669), while a distro without `python-is-python3` has no
bare `python`. The specs now resolve the interpreter once and call `"$PY" ...`.

Nothing enforced that, so the next edit reintroducing `python3 ` in a command
block would have gone unnoticed. `lint_skills.py` reads frontmatter, not command
bodies, and the changelog guard does not read the specs either. This does.

Only lines that actually invoke Python are checked. Prose that mentions a
spelling (`command -v python3` in SETUP.md, the probe itself) is left alone, as
are the `Bash(python3 tools/...)` permission entries, which must keep naming
every spelling the user might have resolved to.
"""
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

SPECS = [
    ".claude/commands/rank.md",
    ".claude/commands/apply.md",
    ".claude/skills/job-scraper/SKILL.md",
    ".claude/skills/job-application-assistant/09-web-research.md",
]

# A line that runs Python: the interpreter at the start of a command, optionally
# after another command in a `cd ... && ...` chain or behind the probe's own
# quoting. It deliberately does not match `"$PY"`, which is the fixed form.
BARE_INTERPRETER = re.compile(
    r"""(?:^|[;&|]\s*|\$\(\{|echo\s)("?)(python3|python)\1\s+\S"""
)

# The probe names all three candidates inside a quoted string; that line, and the
# `for` loop it builds, must never be flagged.
PROBE = 'PY="$(for c in python3 python py; do'


def python_invocations(text: str):
    """Yield (lineno, line) for every line that runs a literal interpreter."""
    for lineno, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith(("#", PROBE, "$PY=")):
            continue
        if BARE_INTERPRETER.search(line):
            yield lineno, line


class SpecPythonInterpreterTest(unittest.TestCase):
    def test_specs_exist(self):
        for spec in SPECS:
            self.assertTrue((REPO / spec).is_file(), f"missing spec {spec}")

    def test_specs_run_python_through_the_resolved_interpreter(self):
        problems = []
        for spec in SPECS:
            text = (REPO / spec).read_text(encoding="utf-8")
            for lineno, line in python_invocations(text):
                problems.append(f"{spec}:{lineno}: {line.strip()}")
        self.assertEqual(
            problems,
            [],
            "workflow specs must invoke Python as `\"$PY\" ...`, resolved by the\n"
            "python3 -> python -> py probe, so a Windows Store alias or a missing\n"
            "python-is-python3 cannot turn a tool call into a silent exit 49:\n"
            + "\n".join(problems),
        )

    def test_specs_define_py_before_first_use(self):
        """A `"$PY"` with no probe above it expands to empty and runs nothing."""
        for spec in SPECS:
            text = (REPO / spec).read_text(encoding="utf-8")
            self.assertIn('PY="$(for c in', text, f"{spec} never resolves PY")
            body = "\n".join(
                line for line in text.splitlines() if not line.startswith("allowed-tools:")
            )
            probe_at = body.index('PY="$(for c in')
            first_use = body.index('"$PY"')
            self.assertLess(
                probe_at, first_use, f"{spec} uses $PY before the probe defines it"
            )


if __name__ == "__main__":
    unittest.main()