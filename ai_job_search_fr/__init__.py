"""Cœur local-first de ai-job-search-fr.

Le package ne contacte aucun service par défaut et ne soumet jamais une
candidature. Les connecteurs réseau sont opt-in et les documents produits sont
des vues dérivées du profil maître.
"""

__version__ = "0.1.0"

from .models import Opportunity, SearchProfile, validate_candidate_profile
from .profile import build_profile_from_documents

__all__ = ["Opportunity", "SearchProfile", "validate_candidate_profile", "build_profile_from_documents", "__version__"]
