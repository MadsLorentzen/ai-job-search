"""Bounded, priority-aware context assembly."""

from dataclasses import dataclass, field
from typing import List, Tuple

from app.llm.exceptions import ContextLimitExceededError


@dataclass(frozen=True)
class ContextDocument:
    name: str
    content: str
    required: bool = False
    priority: int = 10


@dataclass
class ContextManifest:
    included_documents: List[str] = field(default_factory=list)
    truncated_documents: List[str] = field(default_factory=list)
    total_characters: int = 0
    estimated_tokens: int = 0


class ContextBudgetPolicy:
    """Protect required documents and fit optional documents by priority."""

    def __init__(self, max_characters: int = 16000, chars_per_token: float = 4.0):
        if max_characters <= 0 or chars_per_token <= 0:
            raise ValueError("Context limits must be positive")
        self.max_characters = max_characters
        self.chars_per_token = chars_per_token

    def fit(self, documents: List[ContextDocument]) -> Tuple[List[ContextDocument], ContextManifest]:
        manifest = ContextManifest()
        required_docs = [doc for doc in documents if doc.required]
        optional_docs = sorted(
            (doc for doc in documents if not doc.required),
            key=lambda doc: doc.priority,
        )
        required_chars = sum(len(doc.content) for doc in required_docs)
        if required_chars > self.max_characters:
            raise ContextLimitExceededError(
                f"Required documents ({required_chars} chars) exceed max budget "
                f"({self.max_characters} chars)."
            )

        fitted_docs = list(required_docs)
        manifest.included_documents.extend(doc.name for doc in required_docs)
        remaining = self.max_characters - required_chars
        for doc in optional_docs:
            if len(doc.content) <= remaining:
                fitted_docs.append(doc)
                manifest.included_documents.append(doc.name)
                remaining -= len(doc.content)
                continue
            marker = "\n[...truncated]"
            if remaining > 200 and remaining > len(marker):
                fitted_docs.append(
                    ContextDocument(doc.name, doc.content[: remaining - len(marker)] + marker)
                )
            manifest.truncated_documents.append(doc.name)
            remaining = 0

        manifest.total_characters = sum(len(doc.content) for doc in fitted_docs)
        manifest.estimated_tokens = int(manifest.total_characters / self.chars_per_token)
        return fitted_docs, manifest