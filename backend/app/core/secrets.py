import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings


def _key() -> bytes:
    return hashlib.sha256(settings.app_encryption_key.encode()).digest()


def encrypt_secret(value: str) -> str:
    nonce = os.urandom(12)
    encrypted = AESGCM(_key()).encrypt(nonce, value.encode(), None)
    return base64.urlsafe_b64encode(nonce + encrypted).decode()


def decrypt_secret(value: str) -> str:
    decoded = base64.urlsafe_b64decode(value.encode())
    return AESGCM(_key()).decrypt(decoded[:12], decoded[12:], None).decode()


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:12]
