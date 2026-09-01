"""Server-side auth sessions in Redis.

Opaque bearer tokens; the token is the key, so revocation is a DEL. Index
sets per org and per member make "terminate every session for org X"
efficient. Key prefix is authsess: — "session" alone already means a
*parking* session elsewhere in this codebase.
"""
from __future__ import annotations

import json
import secrets
from datetime import UTC, datetime
from typing import Any, Literal

from backend.config import Settings

Scope = Literal["admin", "member"]

_PREFIX = "authsess"


def _session_key(scope: Scope, token: str) -> str:
    return f"{_PREFIX}:{scope}:{token}"


def _org_key(org_id: str) -> str:
    return f"{_PREFIX}:org:{org_id}"


def _member_key(member_id: str) -> str:
    return f"{_PREFIX}:memberidx:{member_id}"


class SessionStore:
    def __init__(self, redis: Any, settings: Settings) -> None:
        self._redis = redis
        self._settings = settings

    def _ttl(self, scope: Scope) -> int:
        if scope == "admin":
            return self._settings.admin_session_ttl
        return self._settings.member_session_ttl

    async def create_admin(self, email: str) -> str:
        token = secrets.token_urlsafe(32)
        payload = json.dumps(
            {"email": email, "created_at": datetime.now(UTC).isoformat()}
        )
        await self._redis.set(_session_key("admin", token), payload, ex=self._ttl("admin"))
        return token

    async def create_member(self, member_id: str, org_id: str, email: str) -> str:
        token = secrets.token_urlsafe(32)
        payload = json.dumps(
            {
                "member_id": member_id,
                "org_id": org_id,
                "email": email,
                "created_at": datetime.now(UTC).isoformat(),
            }
        )
        ttl = self._ttl("member")
        pipe = self._redis.pipeline()
        pipe.set(_session_key("member", token), payload, ex=ttl)
        pipe.sadd(_org_key(org_id), token)
        pipe.expire(_org_key(org_id), ttl)
        pipe.sadd(_member_key(member_id), token)
        pipe.expire(_member_key(member_id), ttl)
        await pipe.execute()
        return token

    async def get(self, scope: Scope, token: str) -> dict[str, Any] | None:
        """Look up a session; refresh its TTL on hit (sliding expiry)."""
        key = _session_key(scope, token)
        raw = await self._redis.get(key)
        if raw is None:
            return None
        await self._redis.expire(key, self._ttl(scope))
        return json.loads(raw)

    async def delete(self, scope: Scope, token: str) -> None:
        data: dict[str, Any] | None = None
        raw = await self._redis.get(_session_key(scope, token))
        if raw is not None:
            data = json.loads(raw)

        pipe = self._redis.pipeline()
        pipe.delete(_session_key(scope, token))
        if scope == "member" and data is not None:
            if data.get("org_id"):
                pipe.srem(_org_key(data["org_id"]), token)
            if data.get("member_id"):
                pipe.srem(_member_key(data["member_id"]), token)
        await pipe.execute()

    async def _revoke_set(self, set_key: str, scope: Scope) -> int:
        tokens = await self._redis.smembers(set_key)
        pipe = self._redis.pipeline()
        for token in tokens:
            pipe.delete(_session_key(scope, token))
        pipe.delete(set_key)
        results = await pipe.execute()
        # Last result is the set's own DEL; the rest count real sessions
        # (TTL-expired tokens linger in the set and delete as 0 — harmless).
        return int(sum(results[:-1]))

    async def revoke_org(self, org_id: str) -> int:
        return await self._revoke_set(_org_key(org_id), "member")

    async def revoke_member(self, member_id: str) -> int:
        return await self._revoke_set(_member_key(member_id), "member")

    async def ping(self) -> bool:
        try:
            await self._redis.ping()
            return True
        except Exception:  # noqa: BLE001 - any transport error means "down"
            return False
