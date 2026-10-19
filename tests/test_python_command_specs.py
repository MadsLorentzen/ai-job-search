"""Guard: the workflow specs settle on `python3`, with one Windows note each.

The specs used to split between spellings: `/apply` ran bare `python ...`
while `/rank`, `/scrape` and `09-web-research` ran `python3 ...` (#669).
Neither literal is safe everywhere - on a stock Windows python.org install
`python3` is the Microsoft Store App execution alias, which prints nothing and
exits 49 in a non-interactive shell, while a distro without `python-is-python3`
has no bare `python` - so the specs now all use `python3` and each carries a
single Windows note at its first use pointing at the allowed `python`
fallback. `.claude/settings.json` keeps granting both spellings, so the note's
fallback stays permitted without any settings or guard change.

Nothing enforced either half. A later edit could reintroduce a bare `python
tools/...` line, or a second Windows note, without any test noticing;
`lint_skills.py` reads frontmatter, not command bodies, and the changelog
guard does not read the specs either. This does.

Only line-leading interpreter tokens are checked - lines that actually run
Python from a code block. Prose that mentions a spelling mid-sentence (the
setup hint, the permission list) is left alone, as are the
`Bash(python ...)`/`Bash(python3 ...)` permission entries, which must keep
naming every spelling a user's machine might actually expose.
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

WINDOWS_NOTE = "> **Windows:** on a stock python.org install, `python3`"

# A line that starts by running an interpreter: the token at line start,
# optionally behind list indentation. `python3` is the settled spelling and
# never flagged; `python` (bare) and any `"$PY"`/probe reintroduction are.
LINE_INTERPRETER = re.compile(r"""^\s*(python3|python|"\$PY"|PY=)""")


def command_lines(text):
    """Yield (lineno, line) for every line-leading interpreter invocation."""
    for lineno, line in enumerate(text.splitlines(), 1):
        m = LINE_INTERPRETER.match(line)
        if m and m.group(1) != "python3":
            yield lineno, line, m.group(1)


class SpecPythonSpellingTest(unittest.TestCase):
    def test_specs_exist(self):
        for spec in SPECS:
            self.assertTrue((REPO / spec).is_file(), f"missing spec {spec}")

    def test_every_command_invokes_python3(self):
        problems = []
        for spec in SPECS:
            text = (REPO / spec).read_text(encoding="utf-8")
            for lineno, line, token in command_lines(text):
                problems.append(f"{spec}:{lineno}: {line.strip()}")
        self.assertEqual(
            problems,
            [],
            "workflow specs must invoke Python as `python3 ...` on every line - "
            "the settled spelling (#669); a bare `python` breaks where distros "
            "ship no python alias, and a `\"$PY\"` probe cannot work across "
            "Claude Code's per-call shells:\n" + "\n".join(problems),
        )

    def test_each_spec_carries_exactly_one_windows_note_before_first_use(self):
        for spec in SPECS:
            text = (REPO / spec).read_text(encoding="utf-8")
            notes = text.count(WINDOWS_NOTE)
            self.assertEqual(
                notes,
                1,
                f"{spec} must carry exactly one Windows note (found {notes}) - "
                "the note explains the exit-49 Store alias (#669) and must not "
                "be repeated after every command",
            )
            lines = text.splitlines()
            note_at = next(i for i, l in enumerate(lines) if l.startswith(WINDOWS_NOTE))
            first_use = next(
                i for i, l in enumerate(lines) if LINE_INTERPRETER.match(l)
            )
            self.assertLess(
                note_at,
                first_use,
                f"{spec} puts its Windows note after the first python3 command",
            )


if __name__ == "__main__":
    unittest.main()
