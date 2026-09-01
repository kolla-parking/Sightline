"""Remove/restore-customer orchestration.

The PG transaction is the source of truth: subscription cancel, org status
flip, outbox rows, and the audit entry commit atomically or not at all.
Session revocation and SMTP delivery happen post-commit and are best-effort —
lockout does not depend on them because require_member and member login both
re-check org status in Postgres.
"""
from __future__ import annotations

import logging
from typing import Any

from backend.config import Settings
from backend.services.auth_sessions import SessionStore
from backend.services.mailer import Mailer, render_access_revoked
from backend.services.portal_db import PortalDB, _uuid

logger = logging.getLogger(__name__)


class OrgNotFound(Exception):
    pass


class OrgAlreadyRemoved(Exception):
    pass


async def remove_organization(
    portal_db: PortalDB,
    sessions: SessionStore,
    mailer: Mailer,
    settings: Settings,
    *,
    org_id: str,
    actor_email: str,
    ip: str | None,
) -> dict[str, Any]:
    oid = _uuid(org_id)
    if oid is None:
        raise OrgNotFound(org_id)

    outbox_ids: list[int] = []

    async with portal_db.pool.acquire() as conn:
        async with conn.transaction():
            org = await conn.fetchrow(
                "SELECT id, name, status FROM organizations WHERE id = $1 FOR UPDATE",
                oid,
            )
            if org is None:
                raise OrgNotFound(org_id)
            if org["status"] == "removed":
                raise OrgAlreadyRemoved(org_id)
            org_name = org["name"]

            cancel_result = await conn.execute(
                """
                UPDATE subscriptions SET status = 'canceled', canceled_at = now()
                WHERE org_id = $1 AND status <> 'canceled'
                """,
                oid,
            )
            subscriptions_canceled = int(cancel_result.split()[-1])

            await conn.execute(
                "UPDATE organizations SET status = 'removed', removed_at = now() WHERE id = $1",
                oid,
            )

            members = await conn.fetch(
                """
                SELECT id, email, full_name FROM org_members
                WHERE org_id = $1 AND status = 'active'
                """,
                oid,
            )
            for member in members:
                subject, body = render_access_revoked(member["full_name"], org_name)
                outbox_ids.append(
                    await mailer.queue(
                        to_email=member["email"],
                        to_name=member["full_name"],
                        subject=subject,
                        body_text=body,
                        template="access_revoked",
                        org_id=str(oid),
                        conn=conn,
                    )
                )

            await portal_db.insert_audit(
                actor_type="admin",
                actor_id=actor_email,
                action="org.removed",
                org_id=str(oid),
                org_name=org_name,
                target_type="org",
                target_id=str(oid),
                detail={
                    "subscriptions_canceled": subscriptions_canceled,
                    "members_notified": len(members),
                },
                ip=ip,
                conn=conn,
            )

    # Post-commit, best-effort.
    try:
        sessions_revoked = await sessions.revoke_org(str(oid))
    except Exception:  # noqa: BLE001 - PG re-checks guarantee lockout anyway
        logger.error("failed to revoke Redis sessions for org %s", oid, exc_info=True)
        sessions_revoked = 0

    await mailer.deliver(outbox_ids)

    return {
        "org_id": str(oid),
        "status": "removed",
        "subscriptions_canceled": subscriptions_canceled,
        "members_notified": len(members),
        "sessions_revoked": sessions_revoked,
    }


async def restore_organization(
    portal_db: PortalDB,
    *,
    org_id: str,
    actor_email: str,
    ip: str | None,
) -> dict[str, Any] | None:
    org = await portal_db.restore_org(org_id)
    if org is None:
        return None
    await portal_db.insert_audit(
        actor_type="admin",
        actor_id=actor_email,
        action="org.restored",
        org_id=org["id"],
        org_name=org["name"],
        target_type="org",
        target_id=org["id"],
        ip=ip,
    )
    return org
