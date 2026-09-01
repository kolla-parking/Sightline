"""Admin portal API. Every route requires a valid admin session and a real
Postgres (503 in memory mode)."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.deps import (
    AdminIdentity,
    client_ip,
    get_mailer,
    get_sessions,
    get_settings_dep,
    require_admin,
    require_portal_db,
)
from backend.config import Settings
from backend.models.portal_schemas import (
    DemoConvert,
    DemoRequestStatusUpdate,
    InvoiceCreate,
    MemberCreate,
    MemberUpdate,
    OrgCreate,
    OrgUpdate,
    PaymentCreate,
    PlanCreate,
    PlanUpdate,
    SubscriptionCreate,
    SubscriptionUpdate,
)
from backend.services import org_lifecycle
from backend.services.auth_sessions import SessionStore
from backend.services.mailer import Mailer, render_payment_receipt
from backend.services.passwords import hash_password
from backend.services.portal_db import (
    DemoRequestAlreadyConverted,
    DemoRequestNotFound,
    PortalDB,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/admin",
    tags=["portal-admin"],
    dependencies=[Depends(require_admin)],
)


def _parse_dt(value: str | None, field: str) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail=f"invalid datetime for {field!r}"
        ) from exc


def _org_or_404(org: dict[str, Any] | None, org_id: str) -> dict[str, Any]:
    if org is None:
        raise HTTPException(status_code=404, detail=f"organization {org_id!r} not found")
    return org


async def _revoke_member_sessions(sessions: SessionStore, member_id: str) -> None:
    try:
        await sessions.revoke_member(member_id)
    except Exception:  # noqa: BLE001 - PG checks still enforce lockout
        logger.warning("failed to revoke sessions for member %s", member_id, exc_info=True)


# ---------------------------------------------------------------- overview

@router.get("/overview")
async def overview(portal_db: PortalDB = Depends(require_portal_db)) -> dict[str, Any]:
    return await portal_db.overview()


# ------------------------------------------------------------ organizations

@router.post("/orgs", status_code=201)
async def create_org(
    payload: OrgCreate,
    admin: AdminIdentity = Depends(require_admin),
    portal_db: PortalDB = Depends(require_portal_db),
    ip: str | None = Depends(client_ip),
) -> dict[str, Any]:
    org = await portal_db.create_org(
        payload.name,
        payload.contact_email,
        payload.notes,
        sites_count=payload.sites_count,
        cameras_count=payload.cameras_count,
        spaces_count=payload.spaces_count,
    )
    await portal_db.insert_audit(
        actor_type="admin",
        actor_id=admin.email,
        action="org.created",
        org_id=org["id"],
        org_name=org["name"],
        target_type="org",
        target_id=org["id"],
        ip=ip,
    )
    return org


@router.get("/orgs")
async def list_orgs(
    status: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    portal_db: PortalDB = Depends(require_portal_db),
) -> dict[str, Any]:
    items, total = await portal_db.list_orgs(status=status, q=q, limit=limit, offset=offset)
    return {"items": items, "total": total}


@router.get("/orgs/{org_id}")
async def get_org(
    org_id: str,
    portal_db: PortalDB = Depends(require_portal_db),
) -> dict[str, Any]:
    detail = await portal_db.get_org_detail(org_id)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"organization {org_id!r} not found")
    return detail


@router.patch("/orgs/{org_id}")
async def update_org(
    org_id: str,
    payload: OrgUpdate,
    admin: AdminIdentity = Depends(require_admin),
    portal_db: PortalDB = Depends(require_portal_db),
    ip: str | None = Depends(client_ip),
) -> dict[str, Any]:
    fields = payload.model_dump(exclude_unset=True)
    org = _org_or_404(await portal_db.update_org(org_id, fields), org_id)
    await portal_db.insert_audit(
        actor_type="admin",
        actor_id=admin.email,
        action="org.updated",
        org_id=org["id"],
        org_name=org["name"],
        target_type="org",
        target_id=org["id"],
        detail={"fields": sorted(fields)},
        ip=ip,
    )
    return org


@router.delete("/orgs/{org_id}")
async def remove_org(
    org_id: str,
    admin: AdminIdentity = Depends(require_admin),
    portal_db: PortalDB = Depends(require_portal_db),
    sessions: SessionStore = Depends(get_sessions),
    mailer: Mailer = Depends(get_mailer),
    settings: Settings = Depends(get_settings_dep),
    ip: str | None = Depends(client_ip),
) -> dict[str, Any]:
    """The remove-customer flow: cancel billing, revoke access, terminate
    sessions, notify members, audit — see org_lifecycle for the sequence."""
    try:
        return await org_lifecycle.remove_organization(
            portal_db,
            sessions,
            mailer,
            settings,
            org_id=org_id,
            actor_email=admin.email,
            ip=ip,
        )
    except org_lifecycle.OrgNotFound:
        raise HTTPException(status_code=404, detail=f"organization {org_id!r} not found")
    except org_lifecycle.OrgAlreadyRemoved:
        raise HTTPException(status_code=409, detail="organization is already removed")


@router.post("/orgs/{org_id}/restore")
async def restore_org(
    org_id: str,
    admin: AdminIdentity = Depends(require_admin),
    portal_db: PortalDB = Depends(require_portal_db),
    ip: str | None = Depends(client_ip),
) -> dict[str, Any]:
    org = await org_lifecycle.restore_organization(
        portal_db, org_id=org_id, actor_email=admin.email, ip=ip
    )
    if org is None:
        raise HTTPException(
            status_code=404, detail=f"no removed organization {org_id!r} to restore"
        )
    return org


# ------------------------------------------------------------------ members

@router.post("/orgs/{org_id}/members", status_code=201)
async def create_member(
    org_id: str,
    payload: MemberCreate,
    admin: AdminIdentity = Depends(require_admin),
    portal_db: PortalDB = Depends(require_portal_db),
    ip: str | None = Depends(client_ip),
) -> dict[str, Any]:
    org = _org_or_404(await portal_db.get_org(org_id), org_id)
    if org["status"] != "active":
        raise HTTPException(status_code=409, detail="organization is removed")

    password_hash = await hash_password(payload.password)
    try:
        member = await portal_db.create_member(
            org_id, payload.email.strip(), password_hash, payload.full_name, payload.role
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="a member with this email already exists")
    member = _org_or_404(member, org_id)

    await portal_db.insert_audit(
        actor_type="admin",
        actor_id=admin.email,
        action="member.created",
        org_id=org["id"],
        org_name=org["name"],
        target_type="member",
        target_id=member["id"],
        detail={"email": member["email"], "role": member["role"]},
        ip=ip,
    )
    return member


@router.get("/orgs/{org_id}/members")
async def list_members(
    org_id: str,
    portal_db: PortalDB = Depends(require_portal_db),
) -> dict[str, Any]:
    _org_or_404(await portal_db.get_org(org_id), org_id)
    items = await portal_db.list_members(org_id)
    return {"items": items, "total": len(items)}


@router.patch("/members/{member_id}")
async def update_member(
    member_id: str,
    payload: MemberUpdate,
    admin: AdminIdentity = Depends(require_admin),
    portal_db: PortalDB = Depends(require_portal_db),
    sessions: SessionStore = Depends(get_sessions),
    ip: str | None = Depends(client_ip),
) -> dict[str, Any]:
    fields = payload.model_dump(exclude_unset=True)
    password = fields.pop("password", None)
    if password:
        fields["password_hash"] = await hash_password(password)

    member = await portal_db.update_member(member_id, fields)
    if member is None:
        raise HTTPException(status_code=404, detail=f"member {member_id!r} not found")

    if fields.get("status") == "disabled" or password:
        await _revoke_member_sessions(sessions, member_id)

    org = await portal_db.get_org(member["org_id"])
    await portal_db.insert_audit(
        actor_type="admin",
        actor_id=admin.email,
        action="member.updated",
        org_id=member["org_id"],
        org_name=org["name"] if org else None,
        target_type="member",
        target_id=member["id"],
        detail={
            "fields": sorted(
                [*fields.keys(), *(["password"] if password else [])]
            )
        },
        ip=ip,
    )
    return member


@router.delete("/members/{member_id}")
async def delete_member(
    member_id: str,
    admin: AdminIdentity = Depends(require_admin),
    portal_db: PortalDB = Depends(require_portal_db),
    sessions: SessionStore = Depends(get_sessions),
    ip: str | None = Depends(client_ip),
) -> dict[str, Any]:
    member = await portal_db.delete_member(member_id)
    if member is None:
        raise HTTPException(status_code=404, detail=f"member {member_id!r} not found")

    await _revoke_member_sessions(sessions, member_id)

    org = await portal_db.get_org(member["org_id"])
    await portal_db.insert_audit(
        actor_type="admin",
        actor_id=admin.email,
        action="member.deleted",
        org_id=member["org_id"],
        org_name=org["name"] if org else None,
        target_type="member",
        target_id=member["id"],
        detail={"email": member["email"]},
        ip=ip,
    )
    return {"deleted": member["id"]}


# -------------------------------------------------------------------- plans

@router.get("/plans")
async def list_plans(portal_db: PortalDB = Depends(require_portal_db)) -> dict[str, Any]:
    items = await portal_db.list_plans()
    return {"items": items, "total": len(items)}


@router.post("/plans", status_code=201)
async def create_plan(
    payload: PlanCreate,
    portal_db: PortalDB = Depends(require_portal_db),
) -> dict[str, Any]:
    try:
        return await portal_db.create_plan(
            payload.code, payload.name, payload.amount_cents, payload.interval, payload.currency
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="a plan with this code already exists")


@router.patch("/plans/{plan_id}")
async def update_plan(
    plan_id: str,
    payload: PlanUpdate,
    portal_db: PortalDB = Depends(require_portal_db),
) -> dict[str, Any]:
    plan = await portal_db.update_plan(plan_id, payload.model_dump(exclude_unset=True))
    if plan is None:
        raise HTTPException(status_code=404, detail=f"plan {plan_id!r} not found")
    return plan


# ------------------------------------------------------------ subscriptions

@router.post("/orgs/{org_id}/subscription", status_code=201)
async def create_subscription(
    org_id: str,
    payload: SubscriptionCreate,
    admin: AdminIdentity = Depends(require_admin),
    portal_db: PortalDB = Depends(require_portal_db),
    ip: str | None = Depends(client_ip),
) -> dict[str, Any]:
    org = _org_or_404(await portal_db.get_org(org_id), org_id)
    if org["status"] != "active":
        raise HTTPException(status_code=409, detail="organization is removed")

    plan = await portal_db.get_plan(payload.plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"plan {payload.plan_id!r} not found")

    try:
        subscription = await portal_db.create_subscription(
            org_id,
            payload.plan_id,
            payload.status,
            _parse_dt(payload.current_period_end, "current_period_end"),
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(
            status_code=409, detail="organization already has a live subscription"
        )

    await portal_db.insert_audit(
        actor_type="admin",
        actor_id=admin.email,
        action="subscription.created",
        org_id=org["id"],
        org_name=org["name"],
        target_type="subscription",
        target_id=subscription["id"],
        detail={"plan": plan["code"], "status": subscription["status"]},
        ip=ip,
    )
    return subscription


@router.patch("/orgs/{org_id}/subscription")
async def update_subscription(
    org_id: str,
    payload: SubscriptionUpdate,
    admin: AdminIdentity = Depends(require_admin),
    portal_db: PortalDB = Depends(require_portal_db),
    ip: str | None = Depends(client_ip),
) -> dict[str, Any]:
    org = _org_or_404(await portal_db.get_org(org_id), org_id)

    fields = payload.model_dump(exclude_unset=True)
    if fields.get("plan_id") is not None:
        if await portal_db.get_plan(fields["plan_id"]) is None:
            raise HTTPException(
                status_code=404, detail=f"plan {fields['plan_id']!r} not found"
            )

    subscription = await portal_db.update_live_subscription(org_id, fields)
    if subscription is None:
        raise HTTPException(status_code=404, detail="organization has no live subscription")

    await portal_db.insert_audit(
        actor_type="admin",
        actor_id=admin.email,
        action="subscription.updated",
        org_id=org["id"],
        org_name=org["name"],
        target_type="subscription",
        target_id=subscription["id"],
        detail={"fields": sorted(fields), "status": subscription["status"]},
        ip=ip,
    )
    return subscription


# ----------------------------------------------------------------- invoices

@router.get("/orgs/{org_id}/invoices")
async def list_invoices(
    org_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    portal_db: PortalDB = Depends(require_portal_db),
) -> dict[str, Any]:
    _org_or_404(await portal_db.get_org(org_id), org_id)
    items, total = await portal_db.list_invoices(org_id, limit=limit, offset=offset)
    return {"items": items, "total": total}


@router.post("/orgs/{org_id}/invoices", status_code=201)
async def create_invoice(
    org_id: str,
    payload: InvoiceCreate,
    admin: AdminIdentity = Depends(require_admin),
    portal_db: PortalDB = Depends(require_portal_db),
    ip: str | None = Depends(client_ip),
) -> dict[str, Any]:
    org = _org_or_404(await portal_db.get_org(org_id), org_id)

    invoice = await portal_db.create_invoice(
        org_id,
        payload.amount_due_cents,
        memo=payload.memo,
        due_at=_parse_dt(payload.due_at, "due_at"),
        period_start=_parse_dt(payload.period_start, "period_start"),
        period_end=_parse_dt(payload.period_end, "period_end"),
    )
    invoice = _org_or_404(invoice, org_id)

    await portal_db.insert_audit(
        actor_type="admin",
        actor_id=admin.email,
        action="invoice.created",
        org_id=org["id"],
        org_name=org["name"],
        target_type="invoice",
        target_id=invoice["id"],
        detail={"number": invoice["number"], "amount_due_cents": invoice["amount_due_cents"]},
        ip=ip,
    )
    return invoice


@router.post("/invoices/{invoice_id}/void")
async def void_invoice(
    invoice_id: str,
    admin: AdminIdentity = Depends(require_admin),
    portal_db: PortalDB = Depends(require_portal_db),
    ip: str | None = Depends(client_ip),
) -> dict[str, Any]:
    invoice = await portal_db.void_invoice(invoice_id)
    if invoice is None:
        raise HTTPException(
            status_code=404, detail="no open invoice with this id (only open invoices can be voided)"
        )
    org = await portal_db.get_org(invoice["org_id"])
    await portal_db.insert_audit(
        actor_type="admin",
        actor_id=admin.email,
        action="invoice.voided",
        org_id=invoice["org_id"],
        org_name=org["name"] if org else None,
        target_type="invoice",
        target_id=invoice["id"],
        detail={"number": invoice["number"]},
        ip=ip,
    )
    return invoice


# ----------------------------------------------------------------- payments

@router.post("/orgs/{org_id}/payments", status_code=201)
async def record_payment(
    org_id: str,
    payload: PaymentCreate,
    admin: AdminIdentity = Depends(require_admin),
    portal_db: PortalDB = Depends(require_portal_db),
    mailer: Mailer = Depends(get_mailer),
    ip: str | None = Depends(client_ip),
) -> dict[str, Any]:
    org = _org_or_404(await portal_db.get_org(org_id), org_id)

    payment = await portal_db.record_payment(
        org_id,
        payload.amount_cents,
        payload.method,
        payload.status,
        admin.email,
        invoice_id=payload.invoice_id,
        reference=payload.reference,
        note=payload.note,
    )
    if payment is None:
        raise HTTPException(
            status_code=404, detail="invoice not found for this organization"
        )

    await portal_db.insert_audit(
        actor_type="admin",
        actor_id=admin.email,
        action="payment.recorded",
        org_id=org["id"],
        org_name=org["name"],
        target_type="payment",
        target_id=payment["id"],
        detail={
            "amount_cents": payment["amount_cents"],
            "method": payment["method"],
            "status": payment["status"],
            "invoice_id": payment.get("invoice_id"),
        },
        ip=ip,
    )

    if payment["status"] == "succeeded" and org.get("contact_email"):
        subject, body = render_payment_receipt(org, payment, payment.get("invoice"))
        outbox_id = await mailer.queue(
            to_email=org["contact_email"],
            subject=subject,
            body_text=body,
            template="payment_receipt",
            org_id=org["id"],
        )
        await mailer.deliver([outbox_id])

    return payment


@router.get("/orgs/{org_id}/payments")
async def list_org_payments(
    org_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    portal_db: PortalDB = Depends(require_portal_db),
) -> dict[str, Any]:
    _org_or_404(await portal_db.get_org(org_id), org_id)
    items, total = await portal_db.list_payments(org_id, limit=limit, offset=offset)
    return {"items": items, "total": total}


@router.get("/payments")
async def list_all_payments(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    portal_db: PortalDB = Depends(require_portal_db),
) -> dict[str, Any]:
    items, total = await portal_db.list_payments(limit=limit, offset=offset)
    return {"items": items, "total": total}


# ------------------------------------------------------------ demo requests

@router.get("/demo-requests")
async def list_demo_requests(
    status: str | None = Query(None),
    kind: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    portal_db: PortalDB = Depends(require_portal_db),
) -> dict[str, Any]:
    items, total = await portal_db.list_demo_requests(
        status=status, kind=kind, limit=limit, offset=offset
    )
    return {"items": items, "total": total}


@router.get("/demo-requests/{request_id}")
async def get_demo_request(
    request_id: str,
    portal_db: PortalDB = Depends(require_portal_db),
) -> dict[str, Any]:
    row = await portal_db.get_demo_request(request_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"demo request {request_id!r} not found")
    return row


@router.patch("/demo-requests/{request_id}")
async def update_demo_request(
    request_id: str,
    payload: DemoRequestStatusUpdate,
    admin: AdminIdentity = Depends(require_admin),
    portal_db: PortalDB = Depends(require_portal_db),
    ip: str | None = Depends(client_ip),
) -> dict[str, Any]:
    current = await portal_db.get_demo_request(request_id)
    if current is None:
        raise HTTPException(status_code=404, detail=f"demo request {request_id!r} not found")
    if current["status"] == "converted":
        raise HTTPException(status_code=409, detail="converted requests cannot be re-triaged")
    row = await portal_db.update_demo_request_status(request_id, payload.status)
    if row is None:
        raise HTTPException(status_code=404, detail=f"demo request {request_id!r} not found")
    await portal_db.insert_audit(
        actor_type="admin",
        actor_id=admin.email,
        action="demo_request.status_changed",
        target_type="demo_request",
        target_id=row["id"],
        detail={"status": row["status"], "email": row["email"]},
        ip=ip,
    )
    return row


@router.post("/demo-requests/{request_id}/convert", status_code=201)
async def convert_demo_request(
    request_id: str,
    payload: DemoConvert | None = None,
    admin: AdminIdentity = Depends(require_admin),
    portal_db: PortalDB = Depends(require_portal_db),
    ip: str | None = Depends(client_ip),
) -> dict[str, Any]:
    """Turn an intake request into a customer org (optionally with a trialing
    subscription) in one transaction — see PortalDB.convert_demo_request."""
    payload = payload or DemoConvert()
    if payload.plan_id is not None and await portal_db.get_plan(payload.plan_id) is None:
        raise HTTPException(status_code=404, detail=f"plan {payload.plan_id!r} not found")
    try:
        return await portal_db.convert_demo_request(
            request_id,
            actor_email=admin.email,
            name=payload.name,
            contact_email=payload.contact_email,
            plan_id=payload.plan_id,
            ip=ip,
        )
    except DemoRequestNotFound:
        raise HTTPException(status_code=404, detail=f"demo request {request_id!r} not found")
    except DemoRequestAlreadyConverted:
        raise HTTPException(status_code=409, detail="demo request is already converted")


# --------------------------------------------------------- audit and outbox

@router.get("/audit-log")
async def list_audit_log(
    org_id: str | None = Query(None),
    action: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    portal_db: PortalDB = Depends(require_portal_db),
) -> dict[str, Any]:
    items, total = await portal_db.list_audit(
        org_id=org_id, action=action, limit=limit, offset=offset
    )
    return {"items": items, "total": total}


@router.get("/email-outbox")
async def list_email_outbox(
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    portal_db: PortalDB = Depends(require_portal_db),
) -> dict[str, Any]:
    items, total = await portal_db.list_outbox(status=status, limit=limit, offset=offset)
    return {"items": items, "total": total}


@router.post("/email-outbox/{outbox_id}/retry")
async def retry_outbox(
    outbox_id: int,
    portal_db: PortalDB = Depends(require_portal_db),
    mailer: Mailer = Depends(get_mailer),
) -> dict[str, Any]:
    row = await portal_db.requeue_outbox(outbox_id)
    if row is None:
        raise HTTPException(
            status_code=404, detail="no failed or captured outbox row with this id"
        )
    if not mailer.configured:
        # Put it back where it was — retrying without SMTP would just fail.
        await portal_db.mark_outbox(outbox_id, "captured")
        raise HTTPException(status_code=409, detail="SMTP is not configured")
    await mailer.deliver([outbox_id])
    refreshed = await portal_db.get_outbox(outbox_id)
    return refreshed or row
