import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.text_utils import humanize_list


def test_humanize_list_empty():
    assert humanize_list([]) == ""


def test_humanize_list_one():
    assert humanize_list(["A/B testing"]) == "A/B testing"


def test_humanize_list_two():
    assert humanize_list(["HubSpot", "Salesforce"]) == "HubSpot and Salesforce"


def test_humanize_list_three_or_more():
    assert humanize_list(["A/B testing", "HubSpot", "Salesforce"]) == "A/B testing, HubSpot, and Salesforce"
