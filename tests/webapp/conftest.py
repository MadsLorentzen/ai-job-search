# tests/webapp/conftest.py
from pathlib import Path

import pytest

FIXTURE_PROFILE_ROOT = Path(__file__).parent / "fixtures" / "webapp_profile_root"


@pytest.fixture
def webapp_profile_root():
    return FIXTURE_PROFILE_ROOT
