"""Unauthenticated intake for the marketing site's demo and contact forms.

Abuse protection: a honeypot field (bots that fill `website` get an
indistinguishable success and nothing is stored) and a per-IP fixed-window
rate limit shared by both endpoints (fails open if Redis is down).
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.api.deps import (
    client_ip,
    get_mailer,
    get_settings_dep,
    require_portal_db,
)
from backend.config import Settings
from backend.models.portal_schemas import ContactRequestIn, DemoRequestIn
from backend.services.mailer import (
    Mailer,
    render_contact_request_admin,
    render_demo_request_admin,
)
from backend.services.portal_db import PortalDB
from backend.services.ratelimit import allow_request

router = APIRouter(prefix="/public", tags=["portal-public"])


async def _check_rate_limit(request: Request, ip: str | None, settings: Settings) -> None:
    redis = getattr(request.app.state, "redis", None)
    if redis is None or ip is None:
        return
    if not await allow_request(
        redis, ip, settings.demo_rate_limit, settings.demo_rate_window
    ):
        raise HTTPException(status_code=429, detail="too many requests")


async def _notify_admin(
    mailer: Mailer, settings: Settings, subject: str, body: str, template: str
) -> None:
    if not settings.notify_email:
        return
    outbox_id = await mailer.queue(
        to_email=settings.notify_email,
        subject=subject,
        body_text=body,
        template=template,
    )
    await mailer.deliver([outbox_id])


@router.post("/demo-requests", status_code=202)
async def submit_demo_request(
    payload: DemoRequestIn,
    request: Request,
    ip: str | None = Depends(client_ip),
    settings: Settings = Depends(get_settings_dep),
    portal_db: PortalDB = Depends(require_portal_db),
    mailer: Mailer = Depends(get_mailer),
) -> dict[str, Any]:
    if payload.website:
        return {"id": str(uuid.uuid4()), "status": "received"}

    await _check_rate_limit(request, ip, settings)

    row = await portal_db.insert_demo_request(
        kind="demo",
        name=payload.name,
        email=payload.email,
        company=payload.company,
        lot_size=payload.lot_size,
        cameras=payload.cameras,
        message=payload.message,
        submitted_ip=ip,
    )
    subject, body = render_demo_request_admin(row)
    await _notify_admin(mailer, settings, subject, body, "demo_request_admin")
    return {"id": row["id"], "status": "received"}


@router.post("/contact-requests", status_code=202)
async def submit_contact_request(
    payload: ContactRequestIn,
    request: Request,
    ip: str | None = Depends(client_ip),
    settings: Settings = Depends(get_settings_dep),
    portal_db: PortalDB = Depends(require_portal_db),
    mailer: Mailer = Depends(get_mailer),
) -> dict[str, Any]:
    if payload.website:
        return {"id": str(uuid.uuid4()), "status": "received"}

    await _check_rate_limit(request, ip, settings)

    row = await portal_db.insert_demo_request(
        kind="contact",
        name=payload.name,
        email=payload.email,
        topic=payload.topic,
        message=payload.message,
        submitted_ip=ip,
    )
    subject, body = render_contact_request_admin(row)
    await _notify_admin(mailer, settings, subject, body, "contact_request_admin")
    return {"id": row["id"], "status": "received"}
