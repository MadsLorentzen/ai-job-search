from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Settings:
    db_path: Path = field(default_factory=lambda: Path(".jobsearch/jobsearch.sqlite3"))
    host: str = "127.0.0.1"
    port: int = 8420
    openai_api_key: str | None = field(default_factory=lambda: os.environ.get("OPENAI_API_KEY"))
    profile_root: str = "."

    def __post_init__(self) -> None:
        self.db_path = Path(self.db_path)
