"""Helpers for command markdown that may start with Desk YAML frontmatter."""


def title_line(text: str) -> str:
    text = text.lstrip()
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            text = text[end + 4 :].lstrip()
    return text.splitlines()[0] if text else ""
