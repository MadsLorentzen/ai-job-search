"""Atomic, boundary-checked persistence for workflow state and tracker rows."""

import csv
import json
import os
from dataclasses import fields
from pathlib import Path

from app.core.security import validate_path_boundary
from app.state.models import ArtifactMap, WorkflowState, WorkflowStage, ApplicationStatus


class TransactionalJournal:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir.resolve()
        self.state_dir = self.base_dir / ".state"
        self.state_dir.mkdir(parents=True, exist_ok=True)

    def save_state(self, state: WorkflowState) -> Path:
        target = validate_path_boundary(self.state_dir / f"{state.job_id}.json", self.base_dir)
        self._atomic_write(target, json.dumps(state.to_dict(), indent=2) + "\n")
        return target

    def load_state(self, job_id: str) -> WorkflowState:
        target = validate_path_boundary(self.state_dir / f"{job_id}.json", self.base_dir)
        if not target.is_file():
            raise FileNotFoundError(f"No saved state found for job_id: {job_id}")
        data = json.loads(target.read_text(encoding="utf-8"))
        data["stage"] = WorkflowStage(data["stage"])
        data["status"] = ApplicationStatus(data["status"])
        data["artifacts"] = ArtifactMap(**data.get("artifacts", {}))
        allowed = {item.name for item in fields(WorkflowState)}
        return WorkflowState(**{key: value for key, value in data.items() if key in allowed})

    def sync_tracker_csv(self, tracker_csv_path: Path, row_data: dict, fieldnames: list[str]) -> None:
        target = validate_path_boundary(tracker_csv_path, self.base_dir)
        rows = []
        if target.exists():
            with target.open("r", encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
        updated = False
        for index, row in enumerate(rows):
            if row.get("job_id") == row_data.get("job_id"):
                rows[index] = row_data
                updated = True
                break
        if not updated:
            rows.append(row_data)
        content = []
        with __import__("io").StringIO(newline="") as buffer:
            writer = csv.DictWriter(buffer, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
            content.append(buffer.getvalue())
        self._atomic_write(target, content[0])

    @staticmethod
    def _atomic_write(target: Path, content: str) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}.tmp")
        temporary.write_text(content, encoding="utf-8", newline="")
        os.replace(temporary, target)