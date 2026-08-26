#!/usr/bin/env python3
"""Per-user storage for the Claude API key. Never inside the binary.

A key compiled into a distributed executable is not protected by being
compiled in: `strings` or any hex editor recovers it from the file in
seconds. It is also unrotatable - changing it means rebuilding and
redistributing to everyone holding a copy - and if it is the agency's own
key, whoever extracts it spends against the agency's account. So the key is
never a build input. It is resolved at runtime, per user, from:

1. ANTHROPIC_API_KEY in the environment - CI and one-off runs
2. the store written by `set` - the normal case for an installed copy

On Windows the store is encrypted with DPAPI (CryptProtectData) via ctypes,
so the ciphertext is bound to the Windows user account: another account on
the same machine, or the raw file lifted onto another machine, cannot
decrypt it. Elsewhere the store is a 0600 file in the user's config
directory. Neither is a substitute for OS account security, and both are
enormously better than a literal in the source or the binary.

This module never prints, logs, or returns a key by accident: display always
goes through `redact`.

Stdlib only.
"""

import argparse
import base64
import ctypes
import json
import os
import sys
from pathlib import Path

ENV_VAR = "ANTHROPIC_API_KEY"

APP_DIRNAME = "ai-job-agency"
STORE_NAME = "credentials.json"

# Anthropic keys carry this prefix. Checked only to catch a paste of the wrong
# string - it is a typo guard, not validation of the key itself.
KEY_PREFIX = "sk-ant-"
MIN_KEY_LENGTH = 20


class CredentialError(Exception):
    """Raised when a key cannot be stored or retrieved."""


def config_dir():
    """Per-user config directory, following each platform's convention."""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or (Path.home() / ".config")
    return Path(base) / APP_DIRNAME


def store_path():
    return config_dir() / STORE_NAME


def redact(key):
    """Render a key safe to print: provenance without the secret."""
    if not key:
        return "(none)"
    tail = key[-4:] if len(key) >= 4 else "?"
    return f"…{tail} ({len(key)} chars)"


# --- Windows DPAPI ------------------------------------------------------------
# CryptProtectData/CryptUnprotectData encrypt against the logged-on user's
# credentials. Reached through ctypes so the module stays stdlib-only.

class _Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _blob(data):
    buffer = ctypes.create_string_buffer(data, len(data))
    return _Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char))), buffer


def _dpapi(func_name, data):
    blob_in, _keepalive = _blob(data)
    blob_out = _Blob()
    func = getattr(ctypes.windll.crypt32, func_name)
    # Trailing flag 0 is CRYPTPROTECT_UI_FORBIDDEN's absence; no UI is needed
    # for the machine-local user context this runs in.
    ok = func(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out))
    if not ok:
        raise CredentialError(
            f"Windows {func_name} failed (error {ctypes.GetLastError()}). "
            "The stored key may have been written by a different Windows user."
        )
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(blob_out.pbData)


def _protect(plaintext):
    return _dpapi("CryptProtectData", plaintext.encode("utf-8"))


def _unprotect(ciphertext):
    return _dpapi("CryptUnprotectData", ciphertext).decode("utf-8")


def _windows():
    return sys.platform == "win32"


# --- store --------------------------------------------------------------------

def store_key(key, path=None):
    """Encrypt (Windows) or 0600-protect (elsewhere) the key on disk."""
    key = (key or "").strip()
    if len(key) < MIN_KEY_LENGTH:
        raise CredentialError("that does not look like an API key - it is too short")
    if not key.startswith(KEY_PREFIX):
        raise CredentialError(
            f"an Anthropic key starts with {KEY_PREFIX!r}; got {key[:7]!r}…"
        )

    target = Path(path) if path else store_path()
    target.parent.mkdir(parents=True, exist_ok=True)

    if _windows():
        payload = {"scheme": "dpapi", "value": base64.b64encode(_protect(key)).decode()}
    else:
        payload = {"scheme": "plain", "value": key}

    # Write private from the start: creating world-readable and chmod-ing after
    # leaves a window where the key is readable by anyone on the machine.
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)

    return target


def load_key(path=None):
    """Return the stored key, or None if nothing is stored."""
    target = Path(path) if path else store_path()
    if not target.is_file():
        return None

    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CredentialError(f"{target} is corrupt: {exc}") from exc

    scheme = payload.get("scheme")
    value = payload.get("value")
    if not scheme or not value:
        raise CredentialError(f"{target} is missing 'scheme' or 'value'")

    if scheme == "dpapi":
        if not _windows():
            raise CredentialError(
                f"{target} was encrypted with Windows DPAPI and cannot be read on "
                f"{sys.platform} - re-run `key set` on this machine"
            )
        return _unprotect(base64.b64decode(value))
    if scheme == "plain":
        return value
    raise CredentialError(f"{target} uses an unknown scheme {scheme!r}")


def clear_key(path=None):
    """Remove the stored key. Returns True if there was one."""
    target = Path(path) if path else store_path()
    if target.is_file():
        target.unlink()
        return True
    return False


def resolve(path=None):
    """The key this process should use, and where it came from.

    Returns (key, source). `key` is None when nothing is configured - callers
    should report the absence rather than proceeding with a broken client.
    """
    from_env = os.environ.get(ENV_VAR, "").strip()
    if from_env:
        return from_env, f"environment ({ENV_VAR})"

    stored = load_key(path)
    if stored:
        scheme = "DPAPI-encrypted" if _windows() else "file, 0600"
        return stored, f"{Path(path) if path else store_path()} [{scheme}]"

    return None, "not configured"


def _cmd_set(args):
    key = args.key or os.environ.get("AGENCY_KEY_INPUT") or ""
    if not key:
        # getpass keeps the key out of shell history and off the screen.
        import getpass

        key = getpass.getpass("Claude API key (input hidden): ")

    target = store_key(key, args.path)
    print(f"stored {redact(key.strip())} in {target}")
    if not _windows():
        print("note: encrypted at rest only on Windows; here it is a 0600 file")
    return 0


def _cmd_status(args):
    key, source = resolve(args.path)
    if not key:
        print(f"no API key configured - set one with `key set`, or export {ENV_VAR}")
        return 1
    print(f"key {redact(key)} from {source}")
    return 0


def _cmd_clear(args):
    print("removed stored key" if clear_key(args.path) else "nothing stored")
    return 0


def build_parser():
    parser = argparse.ArgumentParser(description="Per-user Claude API key storage.")
    parser.add_argument("--path", type=Path, help="override the store location")
    sub = parser.add_subparsers(dest="command", required=True)

    setter = sub.add_parser("set", help="store a key for this user")
    setter.add_argument("key", nargs="?", help="omit to be prompted without echo")
    setter.set_defaults(func=_cmd_set)

    status = sub.add_parser("status", help="show where the key resolves from")
    status.set_defaults(func=_cmd_status)

    clear = sub.add_parser("clear", help="remove the stored key")
    clear.set_defaults(func=_cmd_clear)

    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except CredentialError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
