"""FastAPI dependencies for the portal surface.

Everything reads from request.app.state (wired up in main.py's lifespan), so
there are no circular imports and tests can inject fakes by seeding state.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.config import Settings
from backend.services.auth_sessions import SessionStore
from backend.services.mailer import Mailer
from backend.services.portal_db import PortalDB

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AdminIdentity:
    email: str
    token: str


@dataclass(frozen=True)
class MemberIdentity:
    member_id: str
    org_id: str
    email: str
    token: str


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


def get_portal_db(request: Request) -> PortalDB:
    return request.app.state.portal_db


def require_portal_db(request: Request) -> PortalDB:
    if request.app.state.db.memory_mode:
        raise HTTPException(
            status_code=503,
            detail=(
                "portal features require Postgres; the backend is running "
                "with in-memory persistence"
            ),
        )
    return request.app.state.portal_db


def get_sessions(request: Request) -> SessionStore:
    sessions = getattr(request.app.state, "sessions", None)
    if sessions is None:
        raise HTTPException(status_code=503, detail="session store unavailable")
    return sessions


def get_mailer(request: Request) -> Mailer:
    return request.app.state.mailer


def client_ip(request: Request) -> str | None:
    settings: Settings = request.app.state.settings
    if settings.trust_proxy:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _unauthorized(detail: str = "not authenticated") -> HTTPException:
    return HTTPException(
        status_code=401,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def require_admin(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AdminIdentity:
    if credentials is None:
        raise _unauthorized()
    sessions = get_sessions(request)
    try:
        data = await sessions.get("admin", credentials.credentials)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - Redis transport failure
        raise HTTPException(status_code=503, detail="session store unavailable") from exc
    if data is None:
        raise _unauthorized("invalid or expired session")
    return AdminIdentity(email=data["email"], token=credentials.credentials)


async def require_member(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> MemberIdentity:
    if credentials is None:
        raise _unauthorized()
    sessions = get_sessions(request)
    try:
        data = await sessions.get("member", credentials.credentials)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="session store unavailable") from exc
    if data is None:
        raise _unauthorized("invalid or expired session")

    identity = MemberIdentity(
        member_id=data["member_id"],
        org_id=data["org_id"],
        email=data["email"],
        token=credentials.credentials,
    )

    # Belt and braces: even if a Redis purge partially failed, a member of a
    # removed org (or a disabled member) is locked out on the next request.
    if not request.app.state.db.memory_mode:
        state = await request.app.state.portal_db.member_auth_state(identity.member_id)
        if (
            state is None
            or state["member_status"] != "active"
            or state["org_status"] != "active"
        ):
            try:
                await sessions.delete("member", credentials.credentials)
            except Exception:  # noqa: BLE001 - revocation best-effort here
                pass
            raise HTTPException(status_code=403, detail="access revoked")

    return identity
