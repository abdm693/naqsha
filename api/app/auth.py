"""Who is calling: a signed-in user (Google Identity Platform ID token) or a guest (the browser's X-Naqsha-User id).

- `Authorization: Bearer <idToken>` is verified with google.oauth2.id_token.verify_firebase_token (audience = the project).
  Google's signing certs are cached (honouring Cache-Control), and verified tokens are cached until they expire, so a
  request costs one dictionary lookup after the first.
- With no token, the guest id from `X-Naqsha-User` is used, as before. Guest ids must look like the UUIDs the SPA makes;
  anything else (for example "samples" or an owner key of a signed-in user) is ignored, so a header can't impersonate.
- Firestore owner keys: guests own projects as their guest id; users as "user:<uid>".
"""
from __future__ import annotations

import asyncio
import re
import threading
import time
from dataclasses import dataclass

from fastapi import Header, HTTPException

from . import config

GUEST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{7,63}$")
RESERVED = {"samples", "anon", "naqsha"}


@dataclass
class Identity:
    kind: str                 # "user" | "guest"
    key: str                  # Firestore owner key: "user:<uid>" or the guest id
    uid: str | None = None
    email: str | None = None
    name: str | None = None
    guest_id: str | None = None

    @property
    def signed_in(self) -> bool:
        return self.kind == "user"

    @property
    def author_id(self) -> str:
        return self.uid if self.uid else (self.guest_id or "anon")

    def display_name(self, fallback: str = "Guest") -> str:
        if self.name:
            return self.name
        if self.email:
            return self.email.split("@")[0].replace(".", " ").title()
        return fallback

    @property
    def owner_keys(self) -> set[str]:
        """Keys this caller owns projects under (a signed-in user still owns their unclaimed guest projects)."""
        return {k for k in (self.key, self.guest_id) if k}


def valid_guest(gid: str | None) -> str | None:
    g = (gid or "").strip()
    return g if g and GUEST_RE.match(g) and g.lower() not in RESERVED else None


def user_key(uid: str) -> str:
    return f"user:{uid}"


# --- token verification with cached certs -----------------------------------------------------------------------------
class _CachedRequest:
    """A google.auth transport Request that caches GETs of Google's public certs for their max-age."""

    def __init__(self):
        from google.auth.transport import requests as ga_requests
        self._inner = ga_requests.Request()
        self._cache: dict[str, tuple[float, object]] = {}
        self._lock = threading.Lock()

    def __call__(self, url, method="GET", body=None, headers=None, timeout=None, **kwargs):
        if method != "GET":
            return self._inner(url, method=method, body=body, headers=headers, timeout=timeout, **kwargs)
        with self._lock:
            hit = self._cache.get(url)
            if hit and hit[0] > time.time():
                return hit[1]
        resp = self._inner(url, method=method, body=body, headers=headers, timeout=timeout, **kwargs)
        if getattr(resp, "status", 0) == 200:
            cc = str((getattr(resp, "headers", {}) or {}).get("cache-control", ""))
            m = re.search(r"max-age=(\d+)", cc)
            ttl = min(int(m.group(1)), 6 * 3600) if m else 3600
            with self._lock:
                self._cache[url] = (time.time() + ttl, resp)
        return resp


_request: _CachedRequest | None = None
_tokens: dict[str, tuple[float, dict]] = {}


def verify_token(token: str) -> dict:
    """Verify a Firebase / Identity Platform ID token. Raises ValueError when it isn't valid for this project."""
    global _request
    now = time.time()
    hit = _tokens.get(token)
    if hit and hit[0] > now:
        return hit[1]
    from google.oauth2 import id_token
    if _request is None:
        _request = _CachedRequest()
    claims = id_token.verify_firebase_token(token, _request, audience=config.AUTH_PROJECT)
    if not claims:
        raise ValueError("empty token")
    if claims.get("iss") != f"https://securetoken.google.com/{config.AUTH_PROJECT}":
        raise ValueError("wrong issuer")
    if not (claims.get("user_id") or claims.get("sub")):
        raise ValueError("no subject")
    if len(_tokens) > 5000:
        _tokens.clear()
    _tokens[token] = (float(claims.get("exp", now + 300)), claims)
    return claims


def identity_from(claims: dict | None, guest: str | None) -> Identity:
    if claims:
        uid = claims.get("user_id") or claims.get("sub")
        email = (claims.get("email") or "").lower() or None
        return Identity("user", user_key(uid), uid=uid, email=email, name=claims.get("name") or None, guest_id=guest)
    return Identity("guest", guest or "anon", guest_id=guest)


async def identity(authorization: str | None = Header(None), x_naqsha_user: str | None = Header(None)) -> Identity:
    """FastAPI dependency: the caller's identity."""
    guest = valid_guest(x_naqsha_user)
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        if token:
            try:
                claims = await asyncio.to_thread(verify_token, token)
            except Exception:
                raise HTTPException(401, "Your sign-in has expired. Please sign in again.")
            return identity_from(claims, guest)
    return identity_from(None, guest)
