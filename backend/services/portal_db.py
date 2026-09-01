"""Repository for the admin-portal tables (raw asyncpg, matching database.py).

There is deliberately NO in-memory fallback here: the deps layer returns 503
for every portal route when Database is in memory mode, so this class can
assume a live pool.

Audit action vocabulary (the only strings written to audit_log.action):
    org.created  org.updated  org.removed  org.restored
    member.created  member.updated  member.deleted
    subscription.created  subscription.updated
    invoice.created  invoice.voided
    payment.recorded
    demo_request.status_changed  demo_request.converted
"""
from __future__ import annotations

import ipaddress
import json
import uuid
from typing import Any

from backend.services.database import Database


class DemoRequestNotFound(Exception):
    pass


class DemoRequestAlreadyConverted(Exception):
    pass


def _uuid(value: Any) -> uuid.UUID | None:
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


def _inet(value: str | None) -> Any:
    if not value:
        return None
    try:
        return ipaddress.ip_address(value)
    except ValueError:
        return None


def _clean(record: Any) -> dict[str, Any]:
    """asyncpg Record -> JSON-friendly dict (UUID/INET to str, jsonb parsed)."""
    out: dict[str, Any] = {}
    for key, value in dict(record).items():
        if isinstance(value, uuid.UUID):
            out[key] = str(value)
        elif isinstance(value, (ipaddress.IPv4Address, ipaddress.IPv6Address)):
            out[key] = str(value)
        elif key == "detail" and isinstance(value, str):
            out[key] = json.loads(value)
        else:
            out[key] = value
    return out


def _org_health(org: dict[str, Any], subscription: Any) -> str:
    """Computed (never stored) fleet-health rollup for list/detail views:
    'unknown' until cameras_count is recorded (or the org is removed),
    'attention' when cameras are at zero or an active org has no live
    subscription, 'healthy' otherwise."""
    if org.get("status") == "removed" or org.get("cameras_count") is None:
        return "unknown"
    if org["cameras_count"] == 0 or (
        org.get("status") == "active" and not subscription
    ):
        return "attention"
    return "healthy"


_ORG_LIST_SELECT = """
    SELECT o.id, o.name, o.contact_email, o.notes, o.status, o.removed_at,
           o.sites_count, o.cameras_count, o.spaces_count,
           o.created_at, o.updated_at,
           (SELECT count(*) FROM org_members m WHERE m.org_id = o.id)::int AS member_count,
           sub.subscription
    FROM organizations o
    LEFT JOIN LATERAL (
        SELECT jsonb_build_object(
            'id', s.id::text,
            'status', s.status,
            'plan_id', s.plan_id::text,
            'plan_code', p.code,
            'plan_name', p.name,
            'amount_cents', p.amount_cents,
            'interval', p."interval",
            'current_period_end', s.current_period_end
        ) AS subscription
        FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id
        WHERE s.org_id = o.id AND s.status <> 'canceled'
        LIMIT 1
    ) sub ON TRUE
"""


class PortalDB:
    def __init__(self, db: Database) -> None:
        self._db = db

    @property
    def pool(self) -> Any:
        return self._db.pool

    # ---------------------------------------------------------------- orgs

    async def create_org(
        self,
        name: str,
        contact_email: str | None,
        notes: str | None,
        sites_count: int | None = None,
        cameras_count: int | None = None,
        spaces_count: int | None = None,
    ) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO organizations
                    (name, contact_email, notes,
                     sites_count, cameras_count, spaces_count)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
                """,
                name,
                contact_email,
                notes,
                sites_count,
                cameras_count,
                spaces_count,
            )
        return _clean(row)

    async def list_orgs(
        self,
        status: str | None = None,
        q: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        clauses = []
        params: list[Any] = []
        if status:
            params.append(status)
            clauses.append(f"o.status = ${len(params)}")
        if q:
            params.append(f"%{q}%")
            clauses.append(
                f"(o.name ILIKE ${len(params)} OR o.contact_email ILIKE ${len(params)})"
            )
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

        async with self.pool.acquire() as conn:
            total = await conn.fetchval(
                f"SELECT count(*) FROM organizations o {where}", *params
            )
            rows = await conn.fetch(
                f"""
                {_ORG_LIST_SELECT}
                {where}
                ORDER BY o.created_at DESC
                LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
                """,
                *params,
                limit,
                offset,
            )

        items = []
        for row in rows:
            item = _clean(row)
            if isinstance(item.get("subscription"), str):
                item["subscription"] = json.loads(item["subscription"])
            item["health"] = _org_health(item, item.get("subscription"))
            items.append(item)
        return items, int(total)

    async def get_org(self, org_id: str, conn: Any = None) -> dict[str, Any] | None:
        oid = _uuid(org_id)
        if oid is None:
            return None
        query = "SELECT * FROM organizations WHERE id = $1"
        if conn is not None:
            row = await conn.fetchrow(query, oid)
        else:
            async with self.pool.acquire() as acquired:
                row = await acquired.fetchrow(query, oid)
        return _clean(row) if row else None

    async def get_org_detail(self, org_id: str) -> dict[str, Any] | None:
        oid = _uuid(org_id)
        if oid is None:
            return None
        async with self.pool.acquire() as conn:
            org_row = await conn.fetchrow(
                f"{_ORG_LIST_SELECT} WHERE o.id = $1", oid
            )
            if org_row is None:
                return None
            members = await conn.fetch(
                """
                SELECT id, org_id, email, full_name, role, status, created_at, updated_at
                FROM org_members WHERE org_id = $1 ORDER BY created_at ASC
                """,
                oid,
            )
            invoices = await conn.fetch(
                "SELECT * FROM invoices WHERE org_id = $1 ORDER BY created_at DESC LIMIT 10",
                oid,
            )
            payments = await conn.fetch(
                "SELECT * FROM payments WHERE org_id = $1 ORDER BY received_at DESC LIMIT 10",
                oid,
            )

        org = _clean(org_row)
        subscription = org.pop("subscription", None)
        if isinstance(subscription, str):
            subscription = json.loads(subscription)
        org["health"] = _org_health(org, subscription)
        return {
            "org": org,
            "members": [_clean(m) for m in members],
            "subscription": subscription,
            "invoices": [_clean(i) for i in invoices],
            "payments": [_clean(p) for p in payments],
        }

    async def update_org(self, org_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        oid = _uuid(org_id)
        if oid is None or not fields:
            return None
        allowed = {
            "name", "contact_email", "notes",
            "sites_count", "cameras_count", "spaces_count",
        }
        sets = []
        params: list[Any] = [oid]
        for key, value in fields.items():
            if key not in allowed:
                continue
            params.append(value)
            sets.append(f"{key} = ${len(params)}")
        if not sets:
            return await self.get_org(org_id)
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                f"UPDATE organizations SET {', '.join(sets)} WHERE id = $1 RETURNING *",
                *params,
            )
        return _clean(row) if row else None

    async def restore_org(self, org_id: str) -> dict[str, Any] | None:
        oid = _uuid(org_id)
        if oid is None:
            return None
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE organizations SET status = 'active', removed_at = NULL
                WHERE id = $1 AND status = 'removed'
                RETURNING *
                """,
                oid,
            )
        return _clean(row) if row else None

    # ------------------------------------------------------------- members

    async def create_member(
        self,
        org_id: str,
        email: str,
        password_hash: str,
        full_name: str | None,
        role: str,
    ) -> dict[str, Any] | None:
        oid = _uuid(org_id)
        if oid is None:
            return None
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO org_members (org_id, email, password_hash, full_name, role)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id, org_id, email, full_name, role, status, created_at, updated_at
                """,
                oid,
                email,
                password_hash,
                full_name,
                role,
            )
        return _clean(row)

    async def list_members(self, org_id: str) -> list[dict[str, Any]]:
        oid = _uuid(org_id)
        if oid is None:
            return []
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, org_id, email, full_name, role, status, created_at, updated_at
                FROM org_members WHERE org_id = $1 ORDER BY created_at ASC
                """,
                oid,
            )
        return [_clean(row) for row in rows]

    async def get_member(self, member_id: str) -> dict[str, Any] | None:
        mid = _uuid(member_id)
        if mid is None:
            return None
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT id, org_id, email, full_name, role, status, created_at, updated_at
                FROM org_members WHERE id = $1
                """,
                mid,
            )
        return _clean(row) if row else None

    async def get_member_for_login(self, email: str) -> dict[str, Any] | None:
        """Member row incl. password_hash joined with its org, by email."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT m.id, m.org_id, m.email, m.password_hash, m.full_name,
                       m.role, m.status,
                       o.name AS org_name, o.status AS org_status
                FROM org_members m
                JOIN organizations o ON o.id = m.org_id
                WHERE lower(m.email) = lower($1)
                """,
                email,
            )
        return _clean(row) if row else None

    async def member_auth_state(self, member_id: str) -> dict[str, Any] | None:
        """Belt-and-braces check used on every authenticated member request."""
        mid = _uuid(member_id)
        if mid is None:
            return None
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT m.status AS member_status, o.status AS org_status
                FROM org_members m
                JOIN organizations o ON o.id = m.org_id
                WHERE m.id = $1
                """,
                mid,
            )
        return dict(row) if row else None

    async def update_member(
        self, member_id: str, fields: dict[str, Any]
    ) -> dict[str, Any] | None:
        mid = _uuid(member_id)
        if mid is None:
            return None
        allowed = {"full_name", "role", "status", "password_hash"}
        sets = []
        params: list[Any] = [mid]
        for key, value in fields.items():
            if key not in allowed:
                continue
            params.append(value)
            sets.append(f"{key} = ${len(params)}")
        if not sets:
            return await self.get_member(member_id)
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                f"""
                UPDATE org_members SET {', '.join(sets)} WHERE id = $1
                RETURNING id, org_id, email, full_name, role, status, created_at, updated_at
                """,
                *params,
            )
        return _clean(row) if row else None

    async def delete_member(self, member_id: str) -> dict[str, Any] | None:
        mid = _uuid(member_id)
        if mid is None:
            return None
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                DELETE FROM org_members WHERE id = $1
                RETURNING id, org_id, email, full_name, role, status, created_at, updated_at
                """,
                mid,
            )
        return _clean(row) if row else None

    # --------------------------------------------------------------- plans

    async def list_plans(self) -> list[dict[str, Any]]:
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                'SELECT * FROM plans ORDER BY amount_cents ASC'
            )
        return [_clean(row) for row in rows]

    async def get_plan(self, plan_id: str) -> dict[str, Any] | None:
        pid = _uuid(plan_id)
        if pid is None:
            return None
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM plans WHERE id = $1", pid)
        return _clean(row) if row else None

    async def create_plan(
        self, code: str, name: str, amount_cents: int, interval: str, currency: str
    ) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO plans (code, name, amount_cents, "interval", currency)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
                """,
                code,
                name,
                amount_cents,
                interval,
                currency,
            )
        return _clean(row)

    async def update_plan(self, plan_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        pid = _uuid(plan_id)
        if pid is None:
            return None
        allowed = {"name", "amount_cents", "active"}
        sets = []
        params: list[Any] = [pid]
        for key, value in fields.items():
            if key not in allowed:
                continue
            params.append(value)
            sets.append(f"{key} = ${len(params)}")
        if not sets:
            return await self.get_plan(plan_id)
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                f"UPDATE plans SET {', '.join(sets)} WHERE id = $1 RETURNING *",
                *params,
            )
        return _clean(row) if row else None

    # ------------------------------------------------------- subscriptions

    async def get_live_subscription(self, org_id: str) -> dict[str, Any] | None:
        oid = _uuid(org_id)
        if oid is None:
            return None
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT s.*, p.code AS plan_code, p.name AS plan_name,
                       p.amount_cents, p."interval"
                FROM subscriptions s
                JOIN plans p ON p.id = s.plan_id
                WHERE s.org_id = $1 AND s.status <> 'canceled'
                """,
                oid,
            )
        return _clean(row) if row else None

    async def create_subscription(
        self,
        org_id: str,
        plan_id: str,
        status: str,
        current_period_end: Any = None,
    ) -> dict[str, Any] | None:
        oid, pid = _uuid(org_id), _uuid(plan_id)
        if oid is None or pid is None:
            return None
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO subscriptions (org_id, plan_id, status, current_period_end)
                VALUES ($1, $2, $3, $4)
                RETURNING *
                """,
                oid,
                pid,
                status,
                current_period_end,
            )
        return _clean(row)

    async def update_live_subscription(
        self, org_id: str, fields: dict[str, Any]
    ) -> dict[str, Any] | None:
        oid = _uuid(org_id)
        if oid is None:
            return None
        allowed = {"plan_id", "status", "current_period_end"}
        sets = []
        params: list[Any] = [oid]
        for key, value in fields.items():
            if key not in allowed:
                continue
            if key == "plan_id":
                value = _uuid(value)
                if value is None:
                    return None
            params.append(value)
            sets.append(f"{key} = ${len(params)}")
        if not sets:
            return await self.get_live_subscription(org_id)
        extra = ", canceled_at = now()" if fields.get("status") == "canceled" else ""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                f"""
                UPDATE subscriptions SET {', '.join(sets)}{extra}
                WHERE org_id = $1 AND status <> 'canceled'
                RETURNING *
                """,
                *params,
            )
        return _clean(row) if row else None

    # ------------------------------------------------------------ invoices

    async def list_invoices(
        self, org_id: str, limit: int = 50, offset: int = 0
    ) -> tuple[list[dict[str, Any]], int]:
        oid = _uuid(org_id)
        if oid is None:
            return [], 0
        async with self.pool.acquire() as conn:
            total = await conn.fetchval(
                "SELECT count(*) FROM invoices WHERE org_id = $1", oid
            )
            rows = await conn.fetch(
                """
                SELECT * FROM invoices WHERE org_id = $1
                ORDER BY created_at DESC LIMIT $2 OFFSET $3
                """,
                oid,
                limit,
                offset,
            )
        return [_clean(row) for row in rows], int(total)

    async def create_invoice(
        self,
        org_id: str,
        amount_due_cents: int,
        memo: str | None = None,
        due_at: Any = None,
        period_start: Any = None,
        period_end: Any = None,
    ) -> dict[str, Any] | None:
        oid = _uuid(org_id)
        if oid is None:
            return None
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO invoices
                    (org_id, subscription_id, amount_due_cents, memo,
                     due_at, period_start, period_end)
                VALUES (
                    $1,
                    (SELECT id FROM subscriptions
                     WHERE org_id = $1 AND status <> 'canceled'),
                    $2, $3, $4, $5, $6
                )
                RETURNING *
                """,
                oid,
                amount_due_cents,
                memo,
                due_at,
                period_start,
                period_end,
            )
        return _clean(row)

    async def get_invoice(self, invoice_id: str) -> dict[str, Any] | None:
        iid = _uuid(invoice_id)
        if iid is None:
            return None
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM invoices WHERE id = $1", iid)
        return _clean(row) if row else None

    async def void_invoice(self, invoice_id: str) -> dict[str, Any] | None:
        iid = _uuid(invoice_id)
        if iid is None:
            return None
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE invoices SET status = 'void'
                WHERE id = $1 AND status = 'open'
                RETURNING *
                """,
                iid,
            )
        return _clean(row) if row else None

    # ------------------------------------------------------------ payments

    async def record_payment(
        self,
        org_id: str,
        amount_cents: int,
        method: str,
        status: str,
        recorded_by: str,
        invoice_id: str | None = None,
        reference: str | None = None,
        note: str | None = None,
    ) -> dict[str, Any] | None:
        """Insert the payment and, in the same transaction, roll a succeeded
        payment up into its invoice (paid when fully covered)."""
        oid = _uuid(org_id)
        if oid is None:
            return None
        iid = _uuid(invoice_id) if invoice_id else None

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                invoice = None
                if iid is not None:
                    invoice = await conn.fetchrow(
                        "SELECT * FROM invoices WHERE id = $1 AND org_id = $2 FOR UPDATE",
                        iid,
                        oid,
                    )
                    if invoice is None:
                        return None

                payment = await conn.fetchrow(
                    """
                    INSERT INTO payments
                        (org_id, invoice_id, amount_cents, method, status,
                         reference, note, recorded_by)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING *
                    """,
                    oid,
                    iid,
                    amount_cents,
                    method,
                    status,
                    reference,
                    note,
                    recorded_by,
                )

                updated_invoice = None
                if invoice is not None and status == "succeeded":
                    updated_invoice = await conn.fetchrow(
                        """
                        UPDATE invoices SET
                            amount_paid_cents = amount_paid_cents + $2,
                            status = CASE
                                WHEN amount_paid_cents + $2 >= amount_due_cents
                                    THEN 'paid'
                                ELSE status
                            END,
                            paid_at = CASE
                                WHEN amount_paid_cents + $2 >= amount_due_cents
                                    THEN now()
                                ELSE paid_at
                            END
                        WHERE id = $1
                        RETURNING *
                        """,
                        iid,
                        amount_cents,
                    )

        result = _clean(payment)
        result["invoice"] = _clean(updated_invoice) if updated_invoice else None
        return result

    async def list_payments(
        self, org_id: str | None = None, limit: int = 50, offset: int = 0
    ) -> tuple[list[dict[str, Any]], int]:
        params: list[Any] = []
        where = ""
        if org_id is not None:
            oid = _uuid(org_id)
            if oid is None:
                return [], 0
            params.append(oid)
            where = "WHERE org_id = $1"
        async with self.pool.acquire() as conn:
            total = await conn.fetchval(
                f"SELECT count(*) FROM payments {where}", *params
            )
            rows = await conn.fetch(
                f"""
                SELECT * FROM payments {where}
                ORDER BY received_at DESC
                LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
                """,
                *params,
                limit,
                offset,
            )
        return [_clean(row) for row in rows], int(total)

    # -------------------------------------------------------------- intake

    async def insert_demo_request(
        self,
        kind: str,
        name: str,
        email: str,
        company: str | None = None,
        lot_size: str | None = None,
        cameras: str | None = None,
        topic: str | None = None,
        message: str | None = None,
        submitted_ip: str | None = None,
    ) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO demo_requests
                    (kind, name, email, company, lot_size, cameras, topic,
                     message, submitted_ip)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *
                """,
                kind,
                name,
                email,
                company,
                lot_size,
                cameras,
                topic,
                message,
                _inet(submitted_ip),
            )
        return _clean(row)

    async def list_demo_requests(
        self,
        status: str | None = None,
        kind: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        clauses = []
        params: list[Any] = []
        if status:
            params.append(status)
            clauses.append(f"status = ${len(params)}")
        if kind:
            params.append(kind)
            clauses.append(f"kind = ${len(params)}")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        async with self.pool.acquire() as conn:
            total = await conn.fetchval(
                f"SELECT count(*) FROM demo_requests {where}", *params
            )
            rows = await conn.fetch(
                f"""
                SELECT * FROM demo_requests {where}
                ORDER BY created_at DESC
                LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
                """,
                *params,
                limit,
                offset,
            )
        return [_clean(row) for row in rows], int(total)

    async def get_demo_request(self, request_id: str) -> dict[str, Any] | None:
        rid = _uuid(request_id)
        if rid is None:
            return None
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM demo_requests WHERE id = $1", rid)
        return _clean(row) if row else None

    async def update_demo_request_status(
        self, request_id: str, status: str
    ) -> dict[str, Any] | None:
        rid = _uuid(request_id)
        if rid is None:
            return None
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "UPDATE demo_requests SET status = $2 WHERE id = $1 RETURNING *",
                rid,
                status,
            )
        return _clean(row) if row else None

    async def convert_demo_request(
        self,
        request_id: str,
        *,
        actor_email: str,
        name: str | None = None,
        contact_email: str | None = None,
        plan_id: str | None = None,
        ip: str | None = None,
    ) -> dict[str, Any]:
        """Turn a demo/contact request into a customer org in ONE transaction:
        org insert, optional trialing subscription, status flip to
        'converted', and both audit rows commit atomically or not at all.

        The caller validates plan_id existence up front; raises
        DemoRequestNotFound / DemoRequestAlreadyConverted for the 404/409
        paths."""
        rid = _uuid(request_id)
        if rid is None:
            raise DemoRequestNotFound(request_id)
        pid = _uuid(plan_id) if plan_id else None

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                request = await conn.fetchrow(
                    "SELECT * FROM demo_requests WHERE id = $1 FOR UPDATE", rid
                )
                if request is None:
                    raise DemoRequestNotFound(request_id)
                if request["status"] == "converted":
                    raise DemoRequestAlreadyConverted(request_id)

                org = await conn.fetchrow(
                    """
                    INSERT INTO organizations (name, contact_email, notes)
                    VALUES ($1, $2, $3)
                    RETURNING *
                    """,
                    name or request["company"] or request["name"],
                    contact_email or request["email"],
                    f"Converted from demo request {rid}",
                )

                subscription = None
                if pid is not None:
                    subscription = await conn.fetchrow(
                        """
                        INSERT INTO subscriptions (org_id, plan_id, status)
                        VALUES ($1, $2, 'trialing')
                        RETURNING *
                        """,
                        org["id"],
                        pid,
                    )

                updated = await conn.fetchrow(
                    """
                    UPDATE demo_requests
                    SET status = 'converted', converted_org_id = $2
                    WHERE id = $1
                    RETURNING *
                    """,
                    rid,
                    org["id"],
                )

                await self.insert_audit(
                    actor_type="admin",
                    actor_id=actor_email,
                    action="org.created",
                    org_id=str(org["id"]),
                    org_name=org["name"],
                    target_type="org",
                    target_id=str(org["id"]),
                    detail={"source": "demo_request", "demo_request_id": str(rid)},
                    ip=ip,
                    conn=conn,
                )
                await self.insert_audit(
                    actor_type="admin",
                    actor_id=actor_email,
                    action="demo_request.converted",
                    org_id=str(org["id"]),
                    org_name=org["name"],
                    target_type="demo_request",
                    target_id=str(rid),
                    detail={"plan_id": str(pid) if pid else None},
                    ip=ip,
                    conn=conn,
                )

        return {
            "org": _clean(org),
            "demo_request": _clean(updated),
            "subscription": _clean(subscription) if subscription else None,
        }

    # --------------------------------------------------------------- audit

    async def insert_audit(
        self,
        *,
        actor_type: str,
        actor_id: str | None,
        action: str,
        org_id: str | None = None,
        org_name: str | None = None,
        target_type: str | None = None,
        target_id: str | None = None,
        detail: dict[str, Any] | None = None,
        ip: str | None = None,
        conn: Any = None,
    ) -> int:
        query = """
            INSERT INTO audit_log
                (actor_type, actor_id, action, org_id, org_name,
                 target_type, target_id, detail, ip)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
            RETURNING id
        """
        args = (
            actor_type,
            actor_id,
            action,
            _uuid(org_id) if org_id else None,
            org_name,
            target_type,
            target_id,
            json.dumps(detail or {}),
            _inet(ip),
        )
        if conn is not None:
            return await conn.fetchval(query, *args)
        async with self.pool.acquire() as acquired:
            return await acquired.fetchval(query, *args)

    async def list_audit(
        self,
        org_id: str | None = None,
        action: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        clauses = []
        params: list[Any] = []
        if org_id:
            oid = _uuid(org_id)
            if oid is None:
                return [], 0
            params.append(oid)
            clauses.append(f"org_id = ${len(params)}")
        if action:
            params.append(action)
            clauses.append(f"action = ${len(params)}")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        async with self.pool.acquire() as conn:
            total = await conn.fetchval(
                f"SELECT count(*) FROM audit_log {where}", *params
            )
            rows = await conn.fetch(
                f"""
                SELECT * FROM audit_log {where}
                ORDER BY created_at DESC, id DESC
                LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
                """,
                *params,
                limit,
                offset,
            )
        return [_clean(row) for row in rows], int(total)

    # -------------------------------------------------------------- outbox

    async def insert_outbox(
        self,
        *,
        to_email: str,
        subject: str,
        body_text: str,
        template: str,
        status: str,
        to_name: str | None = None,
        org_id: str | None = None,
        conn: Any = None,
    ) -> int:
        query = """
            INSERT INTO email_outbox
                (to_email, to_name, subject, body_text, template, org_id, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
        """
        args = (
            to_email,
            to_name,
            subject,
            body_text,
            template,
            _uuid(org_id) if org_id else None,
            status,
        )
        if conn is not None:
            return await conn.fetchval(query, *args)
        async with self.pool.acquire() as acquired:
            return await acquired.fetchval(query, *args)

    async def list_outbox(
        self, status: str | None = None, limit: int = 50, offset: int = 0
    ) -> tuple[list[dict[str, Any]], int]:
        params: list[Any] = []
        where = ""
        if status:
            params.append(status)
            where = "WHERE status = $1"
        async with self.pool.acquire() as conn:
            total = await conn.fetchval(
                f"SELECT count(*) FROM email_outbox {where}", *params
            )
            rows = await conn.fetch(
                f"""
                SELECT * FROM email_outbox {where}
                ORDER BY created_at DESC, id DESC
                LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
                """,
                *params,
                limit,
                offset,
            )
        return [_clean(row) for row in rows], int(total)

    async def get_outbox(self, outbox_id: int) -> dict[str, Any] | None:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM email_outbox WHERE id = $1", outbox_id
            )
        return _clean(row) if row else None

    async def bump_outbox_attempt(self, outbox_id: int) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE email_outbox SET attempts = attempts + 1 WHERE id = $1",
                outbox_id,
            )

    async def mark_outbox(
        self, outbox_id: int, status: str, error: str | None = None
    ) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE email_outbox SET
                    status = $2,
                    error = $3,
                    sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
                WHERE id = $1
                """,
                outbox_id,
                status,
                error,
            )

    async def requeue_outbox(self, outbox_id: int) -> dict[str, Any] | None:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE email_outbox SET status = 'pending', error = NULL
                WHERE id = $1 AND status IN ('failed', 'captured')
                RETURNING *
                """,
                outbox_id,
            )
        return _clean(row) if row else None

    # ------------------------------------------------------------ overview

    async def overview(self) -> dict[str, Any]:
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    (SELECT count(*) FROM organizations WHERE status = 'active')::int
                        AS orgs_active,
                    (SELECT count(*) FROM demo_requests WHERE status = 'new')::int
                        AS demo_requests_new,
                    (SELECT count(*) FROM invoices WHERE status = 'open')::int
                        AS invoices_open,
                    (SELECT count(*) FROM email_outbox WHERE status = 'captured')::int
                        AS outbox_captured,
                    (SELECT COALESCE(SUM(
                        CASE WHEN p."interval" = 'year'
                             THEN p.amount_cents / 12
                             ELSE p.amount_cents END
                    ), 0)::bigint
                     FROM subscriptions s
                     JOIN plans p ON p.id = s.plan_id
                     WHERE s.status IN ('active', 'past_due'))
                        AS mrr_cents,
                    -- Historical status isn't tracked, so MRR a week ago is
                    -- approximated by the created/canceled window: count a
                    -- subscription if it existed at T = now() - 7 days and
                    -- had not been canceled by T.
                    (SELECT COALESCE(SUM(
                        CASE WHEN p."interval" = 'year'
                             THEN p.amount_cents / 12
                             ELSE p.amount_cents END
                    ), 0)::bigint
                     FROM subscriptions s
                     JOIN plans p ON p.id = s.plan_id
                     WHERE s.created_at <= now() - interval '7 days'
                       AND (s.canceled_at IS NULL
                            OR s.canceled_at > now() - interval '7 days'))
                        AS mrr_prev_cents,
                    (SELECT count(*) FROM demo_requests
                     WHERE created_at >= now() - interval '7 days')::int
                        AS demo_requests_7d,
                    (SELECT count(*) FROM demo_requests
                     WHERE created_at >= now() - interval '14 days'
                       AND created_at < now() - interval '7 days')::int
                        AS demo_requests_prev_7d
                """
            )
            attention = await conn.fetchrow(
                """
                SELECT
                    (SELECT count(*) FROM demo_requests WHERE status = 'new')::int
                        AS untriaged_demos,
                    (SELECT count(*) FROM email_outbox WHERE status = 'failed')::int
                        AS failed_outbox,
                    (SELECT count(*) FROM invoices
                     WHERE status = 'open'
                       AND due_at IS NOT NULL AND due_at < now())::int
                        AS overdue_invoices,
                    (SELECT count(*) FROM organizations o
                     WHERE o.status = 'active' AND NOT EXISTS (
                         SELECT 1 FROM subscriptions s
                         WHERE s.org_id = o.id AND s.status <> 'canceled'
                     ))::int
                        AS orgs_without_subscription_total
                """
            )
            no_sub_orgs = await conn.fetch(
                """
                SELECT o.id, o.name FROM organizations o
                WHERE o.status = 'active' AND NOT EXISTS (
                    SELECT 1 FROM subscriptions s
                    WHERE s.org_id = o.id AND s.status <> 'canceled'
                )
                ORDER BY o.created_at DESC
                LIMIT 5
                """
            )

        out = dict(row)
        out["attention"] = {
            "untriaged_demos": attention["untriaged_demos"],
            "failed_outbox": attention["failed_outbox"],
            "overdue_invoices": attention["overdue_invoices"],
            "orgs_without_subscription": [_clean(r) for r in no_sub_orgs],
            "orgs_without_subscription_total": attention[
                "orgs_without_subscription_total"
            ],
        }
        return out
