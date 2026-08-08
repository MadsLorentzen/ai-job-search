"""Connecteurs réseau opt-in.

Chaque connecteur expose ``search`` et ``detail`` et retourne des
``Opportunity``. Les secrets sont uniquement lus depuis l'environnement.
"""

from .france_travail import FranceTravailClient, FranceTravailConfig

__all__ = ["FranceTravailClient", "FranceTravailConfig"]
