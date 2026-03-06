"""Fernet-based encryption for user settings (API keys, secrets).

If ENCRYPTION_KEY env var is set, uses it directly.
Otherwise, derives a Fernet key from JWT_SECRET using PBKDF2.
"""

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is not None:
        return _fernet

    key = os.getenv("ENCRYPTION_KEY", "")
    if key:
        _fernet = Fernet(key.encode() if isinstance(key, str) else key)
        return _fernet

    # Derive from JWT_SECRET
    jwt_secret = os.getenv("JWT_SECRET", "fallback-key-not-for-production")
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        jwt_secret.encode(),
        b"ai-notetaker-settings-salt",
        100_000,
        dklen=32,
    )
    fernet_key = base64.urlsafe_b64encode(derived)
    _fernet = Fernet(fernet_key)
    return _fernet


def encrypt_value(plaintext: str) -> str:
    """Encrypt a string value. Returns base64-encoded ciphertext."""
    f = _get_fernet()
    return f.encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext: str) -> str:
    """Decrypt a base64-encoded ciphertext. Returns plaintext string."""
    f = _get_fernet()
    try:
        return f.decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        raise ValueError("Failed to decrypt value — key may have changed")


def mask_value(plaintext: str, visible_chars: int = 4) -> str:
    """Return a masked version: last N chars visible, rest replaced with bullets."""
    if len(plaintext) <= visible_chars:
        return "\u2022" * len(plaintext)
    hidden = len(plaintext) - visible_chars
    return "\u2022" * hidden + plaintext[-visible_chars:]
