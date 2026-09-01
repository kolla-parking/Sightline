"""Login/logout/me for the two auth scopes.

Admin is a single env-configured account (no DB row). Members live in
Postgres. Both get opaque bearer tokens backed by Redis sessions.
"""
from __future__ import annotations

import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.api.deps import (
    AdminIdentity,
    MemberIdentity,
    get_sessions,
    get_settings_dep,
    require_admin,
    require_member,
    require_portal_db,
)
from backend.config import Settings
from backend.models.portal_schemas import LoginRequest
from backend.services.auth_sessions import SessionStore
from backend.services.passwords import verify_password
from backend.services.portal_db import PortalDB

router = APIRouter(prefix="/auth", tags=["portal-auth"])

# Verified against when a login email doesn't match any account, so unknown
# and known-but-wrong-password attempts cost the same. (bcrypt of "sightline")
_DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO7ZBhZzQGCA6Kw2eZgqhZo1yMbEGH19u"


def _session_unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail="session store unavailable")


@router.post("/admin/login")
async def admin_login(
    payload: LoginRequest,
    settings: Settings = Depends(get_settings_dep),
    sessions: SessionStore = Depends(get_sessions),
) -> dict[str, Any]:
    if not settings.admin_configured:
        raise HTTPException(
            status_code=503,
            detail="admin account not configured; set ADMIN_EMAIL and ADMIN_PASSWORD",
        )

    email_ok = payload.email.strip().lower() == settings.admin_email.strip().lower()
    if settings.admin_password_hash:
        password_ok = await verify_password(payload.password, settings.admin_password_hash)
    else:
        password_ok = secrets.compare_digest(
            payload.password.encode("utf-8"),
            (settings.admin_password or "").encode("utf-8"),
        )
    if not (email_ok and password_ok):
        raise HTTPException(status_code=401, detail="invalid credentials")

    try:
        token = await sessions.create_admin(settings.admin_email)
    except Exception as exc:  # noqa: BLE001 - Redis transport failure
        raise _session_unavailable() from exc

    return {
        "token": token,
        "expires_in": settings.admin_session_ttl,
        "admin": {"email": settings.admin_email},
    }


@router.post("/admin/logout")
async def admin_logout(
    admin: AdminIdentity = Depends(require_admin),
    sessions: SessionStore = Depends(get_sessions),
) -> dict[str, Any]:
    try:
        await sessions.delete("admin", admin.token)
    except Exception as exc:  # noqa: BLE001
        raise _session_unavailable() from exc
    return {"ok": True}


@router.get("/admin/me")
async def admin_me(admin: AdminIdentity = Depends(require_admin)) -> dict[str, Any]:
    return {"email": admin.email}


@router.post("/member/login")
async def member_login(
    payload: LoginRequest,
    settings: Settings = Depends(get_settings_dep),
    sessions: SessionStore = Depends(get_sessions),
    portal_db: PortalDB = Depends(require_portal_db),
) -> dict[str, Any]:
    member = await portal_db.get_member_for_login(payload.email.strip())

    if member is None:
        await verify_password(payload.password, _DUMMY_HASH)
        raise HTTPException(status_code=401, detail="invalid credentials")

    if not await verify_password(payload.password, member["password_hash"]):
        raise HTTPException(status_code=401, detail="invalid credentials")

    if member["status"] != "active":
        raise HTTPException(status_code=401, detail="invalid credentials")

    if member["org_status"] != "active":
        raise HTTPException(status_code=403, detail="access revoked")

    try:
        token = await sessions.create_member(
            member["id"], member["org_id"], member["email"]
        )
    except Exception as exc:  # noqa: BLE001
        raise _session_unavailable() from exc

    return {
        "token": token,
        "expires_in": settings.member_session_ttl,
        "member": {
            "id": member["id"],
            "email": member["email"],
            "full_name": member["full_name"],
            "role": member["role"],
        },
        "org": {"id": member["org_id"], "name": member["org_name"]},
    }


@router.post("/member/logout")
async def member_logout(
    member: MemberIdentity = Depends(require_member),
    sessions: SessionStore = Depends(get_sessions),
) -> dict[str, Any]:
    try:
        await sessions.delete("member", member.token)
    except Exception as exc:  # noqa: BLE001
        raise _session_unavailable() from exc
    return {"ok": True}


@router.get("/member/me")
async def member_me(
    identity: MemberIdentity = Depends(require_member),
    portal_db: PortalDB = Depends(require_portal_db),
) -> dict[str, Any]:
    member = await portal_db.get_member(identity.member_id)
    org = await portal_db.get_org(identity.org_id)
    if member is None or org is None:
        raise HTTPException(status_code=403, detail="access revoked")
    return {
        "member": {
            "id": member["id"],
            "email": member["email"],
            "full_name": member["full_name"],
            "role": member["role"],
        },
        "org": {"id": org["id"], "name": org["name"], "status": org["status"]},
    }
