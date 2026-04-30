import base64
import hashlib
import hmac
import json
import secrets
import time

from .config import AUTH_SECRET, AUTH_TOKEN_TTL_SECONDS


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def hash_password(password: str, salt: str | None = None) -> str:
    used_salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), used_salt.encode("utf-8"), 150000)
    return f"{used_salt}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, _ = stored_hash.split("$", 1)
    except ValueError:
        return False
    expected = hash_password(password, salt)
    return hmac.compare_digest(expected, stored_hash)


def create_access_token(user_id: int, username: str) -> str:
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": int(time.time()) + AUTH_TOKEN_TTL_SECONDS,
    }
    payload_raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_encoded = _b64url_encode(payload_raw)
    signature = hmac.new(AUTH_SECRET.encode("utf-8"), payload_encoded.encode("utf-8"), hashlib.sha256).digest()
    return f"{payload_encoded}.{_b64url_encode(signature)}"


def decode_access_token(token: str) -> dict | None:
    try:
        payload_encoded, signature_encoded = token.split(".", 1)
    except ValueError:
        return None

    expected_signature = hmac.new(
        AUTH_SECRET.encode("utf-8"), payload_encoded.encode("utf-8"), hashlib.sha256
    ).digest()
    provided_signature = _b64url_decode(signature_encoded)
    if not hmac.compare_digest(expected_signature, provided_signature):
        return None

    try:
        payload = json.loads(_b64url_decode(payload_encoded).decode("utf-8"))
    except Exception:
        return None

    exp = payload.get("exp")
    if not isinstance(exp, int) or exp < int(time.time()):
        return None
    return payload
