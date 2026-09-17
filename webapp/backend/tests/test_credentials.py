import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import credentials as c


class FakeKeyringBackend:
    """In-memory stand-in so tests never touch the real OS keychain."""

    def __init__(self):
        self.store: dict[tuple[str, str], str] = {}

    def set_password(self, service, key, value):
        self.store[(service, key)] = value

    def get_password(self, service, key):
        return self.store.get((service, key))

    def delete_password(self, service, key):
        if (service, key) not in self.store:
            raise c.keyring.errors.PasswordDeleteError("not found")
        del self.store[(service, key)]


@pytest.fixture(autouse=True)
def fake_backend(monkeypatch):
    fake = FakeKeyringBackend()
    monkeypatch.setattr(c.keyring, "set_password", fake.set_password)
    monkeypatch.setattr(c.keyring, "get_password", fake.get_password)
    monkeypatch.setattr(c.keyring, "delete_password", fake.delete_password)
    return fake


def test_set_and_get_credential():
    c.set_credential("linkedin_username", "someone@example.com", user_id=1)
    assert c.get_credential("linkedin_username", user_id=1) == "someone@example.com"


def test_has_credential_false_when_unset():
    assert c.has_credential("linkedin_password", user_id=1) is False


def test_delete_credential_is_idempotent():
    c.set_credential("linkedin_username", "x", user_id=1)
    c.delete_credential("linkedin_username", user_id=1)
    assert c.has_credential("linkedin_username", user_id=1) is False
    c.delete_credential("linkedin_username", user_id=1)  # second delete must not raise


def test_rejects_unknown_key():
    with pytest.raises(ValueError):
        c.set_credential("some_random_password", "x", user_id=1)
    with pytest.raises(ValueError):
        c.get_credential("some_random_password", user_id=1)


def test_credentials_are_isolated_per_user():
    c.set_credential("linkedin_username", "user-one@example.com", user_id=1)
    c.set_credential("linkedin_username", "user-two@example.com", user_id=2)
    assert c.get_credential("linkedin_username", user_id=1) == "user-one@example.com"
    assert c.get_credential("linkedin_username", user_id=2) == "user-two@example.com"

    c.delete_credential("linkedin_username", user_id=1)
    assert c.has_credential("linkedin_username", user_id=1) is False
    assert c.get_credential("linkedin_username", user_id=2) == "user-two@example.com"
