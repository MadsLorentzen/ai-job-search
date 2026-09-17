"""Credential storage via the OS keychain (macOS Keychain on this platform),
never plaintext files -- per the approved plan's "store username/password,
auto-login each run" decision. Values are written and read here only; no
other module should ever log, print, or return a stored value.

Every function takes `user_id` and uses it in the keyring service name
(`f"{SERVICE_NAME}:{user_id}"`) so one account's LinkedIn login or Brave API
key is never visible to, or overwritten by, another account -- each user's
credentials live in a completely separate keychain entry.
"""

from __future__ import annotations

import keyring

SERVICE_NAME = "ai-job-search-webapp"
ALLOWED_KEYS = {"linkedin_username", "linkedin_password", "brave_search_api_key"}


def _service_name(user_id: int) -> str:
    return f"{SERVICE_NAME}:{user_id}"


def set_credential(key: str, value: str, user_id: int) -> None:
    if key not in ALLOWED_KEYS:
        raise ValueError(f"Unknown credential key '{key}'. Allowed: {sorted(ALLOWED_KEYS)}")
    keyring.set_password(_service_name(user_id), key, value)


def get_credential(key: str, user_id: int) -> str | None:
    if key not in ALLOWED_KEYS:
        raise ValueError(f"Unknown credential key '{key}'. Allowed: {sorted(ALLOWED_KEYS)}")
    return keyring.get_password(_service_name(user_id), key)


def has_credential(key: str, user_id: int) -> bool:
    return get_credential(key, user_id) is not None


def delete_credential(key: str, user_id: int) -> None:
    try:
        keyring.delete_password(_service_name(user_id), key)
    except keyring.errors.PasswordDeleteError:
        pass  # already absent -- deletion is idempotent from the caller's view
