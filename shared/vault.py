"""AES-256-GCM encryption vault for platform secrets.

Provides authenticated encryption with:
- PBKDF2-HMAC-SHA256 key derivation (100k iterations)
- Unique 12-byte nonce per encryption
- 16-byte authentication tag for tamper detection
- Storage format: base64(salt[16] + nonce[12] + tag[16] + ciphertext)
"""

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_SALT_LEN = 16
_NONCE_LEN = 12
_TAG_LEN = 16
_KEY_LEN = 32  # 256 bits
_ITERATIONS = 100_000


def _derive_key(master_key: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha256",
        master_key.encode(),
        salt,
        _ITERATIONS,
        dklen=_KEY_LEN,
    )


def _get_master_key() -> str:
    key = os.getenv("VAULT_MASTER_KEY", "")
    if not key:
        key = os.getenv("JWT_SECRET", "fallback-vault-key-not-for-production")
    return key


def vault_encrypt(plaintext: str) -> str:
    """Encrypt a string with AES-256-GCM. Returns base64-encoded ciphertext."""
    master_key = _get_master_key()
    salt = os.urandom(_SALT_LEN)
    derived_key = _derive_key(master_key, salt)

    aesgcm = AESGCM(derived_key)
    nonce = os.urandom(_NONCE_LEN)
    ciphertext_with_tag = aesgcm.encrypt(nonce, plaintext.encode(), None)

    # ciphertext_with_tag = ciphertext + tag (tag is last 16 bytes)
    ciphertext = ciphertext_with_tag[:-_TAG_LEN]
    tag = ciphertext_with_tag[-_TAG_LEN:]

    packed = salt + nonce + tag + ciphertext
    return base64.urlsafe_b64encode(packed).decode()


def vault_decrypt(encrypted: str) -> str:
    """Decrypt a base64-encoded AES-256-GCM ciphertext. Verifies auth tag."""
    master_key = _get_master_key()
    packed = base64.urlsafe_b64decode(encrypted.encode())

    salt = packed[:_SALT_LEN]
    nonce = packed[_SALT_LEN : _SALT_LEN + _NONCE_LEN]
    tag = packed[_SALT_LEN + _NONCE_LEN : _SALT_LEN + _NONCE_LEN + _TAG_LEN]
    ciphertext = packed[_SALT_LEN + _NONCE_LEN + _TAG_LEN :]

    derived_key = _derive_key(master_key, salt)
    aesgcm = AESGCM(derived_key)

    # AESGCM.decrypt expects ciphertext + tag concatenated
    ciphertext_with_tag = ciphertext + tag
    try:
        plaintext = aesgcm.decrypt(nonce, ciphertext_with_tag, None)
        return plaintext.decode()
    except Exception:
        raise ValueError("Decryption failed — master key may have changed or data is corrupted")
