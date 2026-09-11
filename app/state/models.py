"""Dependency-free workflow state models."""

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Dict, List, Optional


class WorkflowStage(str, Enum):
    DISCOVERED = "discovered"
    NORMALIZED = "normalized"
    FILTERED = "filtered"
    RANKED = "ranked"
    SHORTLISTED = "shortlisted"
    ANALYZING = "analyzing"
    DRAFTING = "drafting"
    REVIEWING = "reviewing"
    READY_FOR_APPROVAL = "ready_for_approval"
    COMPILING = "compiling"
    VALIDATING = "validating"
    READY_TO_ARCHIVE = "ready_to_archive"
    ARCHIVED = "archived"


class ApplicationStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    BLOCKED = "blocked"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class FailureStage(str, Enum):
    BLOCKED_INPUT = "blocked_input"
    BLOCKED_PROVIDER = "blocked_provider"
    BLOCKED_COMPILATION = "blocked_compilation"
    BLOCKED_VALIDATION = "blocked_validation"
    CANCELLED = "cancelled"


class RemoteStatus(str, Enum):
    FULLY_REMOTE_GLOBAL = "fully_remote_global"
    FULLY_REMOTE_COUNTRY_RESTRICTED = "fully_remote_country_restricted"
    FULLY_REMOTE_REGION_RESTRICTED = "fully_remote_region_restricted"
    HYBRID = "hybrid"
    ONSITE = "onsite"
    UNKNOWN = "unknown"


@dataclass
class ArtifactMap:
    posting: Optional[str] = None
    cv_source: Optional[str] = None
    cover_letter_source: Optional[str] = None
    cv_pdf: Optional[str] = None
    cover_letter_pdf: Optional[str] = None
    ats_text: Optional[str] = None


@dataclass
class WorkflowState:
    job_id: str
    application_id: Optional[str] = None
    stage: WorkflowStage = WorkflowStage.DISCOVERED
    status: ApplicationStatus = ApplicationStatus.PENDING
    artifacts: ArtifactMap = field(default_factory=ArtifactMap)
    attempts: Dict[str, int] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    timestamps: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)