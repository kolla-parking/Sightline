"""In-memory fakes for the portal test tier.

FakeRedis implements just the subset SessionStore and the rate limiter use,
so those run their real logic. FakePortalDB mirrors the PortalDB surface the
routers touch, plus a fake asyncpg pool speaking the handful of raw queries
org_lifecycle issues inside its transaction.
"""
from __future__ import annotations

import itertools
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from backend.config import Settings
from backend.services.portal_db import (
    DemoRequestAlreadyConverted,
    DemoRequestNotFound,
)


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = dict(
        database_url="postgresql://test",
        redis_url="redis://test",
        cors_origins=("http://localhost:5173", "http://localhost:8090"),
        admin_email="admin@sightline.test",
        admin_password="correct horse battery staple",
        admin_password_hash=None,
        admin_notify_email=None,
        admin_session_ttl=3600,
        member_session_ttl=3600,
        smtp_host=None,
        smtp_port=587,
        smtp_username=None,
        smtp_password=None,
        smtp_starttls=True,
        smtp_from="Sightline <no-reply@test>",
        demo_rate_limit=3,
        demo_rate_window=60,
        trust_proxy=True,
    )
    values.update(overrides)
    return Settings(**values)


# ---------------------------------------------------------------- FakeRedis


class _FakePipeline:
    def __init__(self, redis: "FakeRedis") -> None:
        self._redis = redis
        self._ops: list[tuple[str, tuple, dict]] = []

    def __getattr__(self, name: str):
        def queue(*args: Any, **kwargs: Any) -> "_FakePipeline":
            self._ops.append((name, args, kwargs))
            return self

        return queue

    async def execute(self) -> list[Any]:
        results = []
        for name, args, kwargs in self._ops:
            results.append(await getattr(self._redis, name)(*args, **kwargs))
        self._ops = []
        return results


class FakeRedis:
    def __init__(self) -> None:
        self.strings: dict[str, str] = {}
        self.sets: dict[str, set[str]] = {}
        self.counters: dict[str, int] = {}
        self.broken = False

    def _check(self) -> None:
        if self.broken:
            raise ConnectionError("fake redis is down")

    async def get(self, key: str) -> str | None:
        self._check()
        return self.strings.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        self._check()
        self.strings[key] = value
        return True

    async def delete(self, key: str) -> int:
        self._check()
        existed = int(key in self.strings or key in self.sets)
        self.strings.pop(key, None)
        self.sets.pop(key, None)
        return existed

    async def sadd(self, key: str, *values: str) -> int:
        self._check()
        target = self.sets.setdefault(key, set())
        added = len([v for v in values if v not in target])
        target.update(values)
        return added

    async def srem(self, key: str, *values: str) -> int:
        self._check()
        target = self.sets.get(key, set())
        removed = len([v for v in values if v in target])
        target.difference_update(values)
        return removed

    async def smembers(self, key: str) -> set[str]:
        self._check()
        return set(self.sets.get(key, set()))

    async def expire(self, key: str, seconds: int, nx: bool = False) -> bool:
        self._check()
        return True

    async def incr(self, key: str) -> int:
        self._check()
        self.counters[key] = self.counters.get(key, 0) + 1
        return self.counters[key]

    async def ping(self) -> bool:
        self._check()
        return True

    def pipeline(self) -> _FakePipeline:
        return _FakePipeline(self)


# ------------------------------------------------------------- FakePortalDB


class _NullTransaction:
    async def __aenter__(self) -> "_NullTransaction":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _FakeConn:
    """Understands the raw queries org_lifecycle runs in its transaction."""

    def __init__(self, db: "FakePortalDB") -> None:
        self._db = db

    def transaction(self) -> _NullTransaction:
        return _NullTransaction()

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any] | None:
        if "FROM organizations" in query and "FOR UPDATE" in query:
            return self._db.orgs.get(str(args[0]))
        raise AssertionError(f"FakeConn.fetchrow: unexpected query: {query}")

    async def execute(self, query: str, *args: Any) -> str:
        org_id = str(args[0])
        if "UPDATE subscriptions SET status = 'canceled'" in query:
            count = 0
            for sub in self._db.subscriptions.values():
                if sub["org_id"] == org_id and sub["status"] != "canceled":
                    sub["status"] = "canceled"
                    sub["canceled_at"] = datetime.now(UTC)
                    count += 1
            return f"UPDATE {count}"
        if "UPDATE organizations SET status = 'removed'" in query:
            org = self._db.orgs[org_id]
            org["status"] = "removed"
            org["removed_at"] = datetime.now(UTC)
            return "UPDATE 1"
        raise AssertionError(f"FakeConn.execute: unexpected query: {query}")

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        if "FROM org_members" in query:
            org_id = str(args[0])
            return [
                m
                for m in self._db.members.values()
                if m["org_id"] == org_id and m["status"] == "active"
            ]
        raise AssertionError(f"FakeConn.fetch: unexpected query: {query}")


class _FakeAcquire:
    def __init__(self, db: "FakePortalDB") -> None:
        self._db = db

    async def __aenter__(self) -> _FakeConn:
        return _FakeConn(self._db)

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _FakePool:
    def __init__(self, db: "FakePortalDB") -> None:
        self._db = db

    def acquire(self) -> _FakeAcquire:
        return _FakeAcquire(self._db)


class FakePortalDB:
    def __init__(self) -> None:
        self.orgs: dict[str, dict[str, Any]] = {}
        self.members: dict[str, dict[str, Any]] = {}
        self.subscriptions: dict[str, dict[str, Any]] = {}
        self.plans: dict[str, dict[str, Any]] = {}
        self.demo_requests: dict[str, dict[str, Any]] = {}
        self.audit: list[dict[str, Any]] = []
        self.outbox: dict[int, dict[str, Any]] = {}
        self._outbox_seq = itertools.count(1)
        self.pool = _FakePool(self)

    # ---- seeding helpers -------------------------------------------------

    def seed_org(self, name: str = "Acme Parking", **overrides: Any) -> dict[str, Any]:
        org = {
            "id": str(uuid.uuid4()),
            "name": name,
            "contact_email": None,
            "notes": None,
            "status": "active",
            "removed_at": None,
            "sites_count": None,
            "cameras_count": None,
            "spaces_count": None,
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
        }
        org.update(overrides)
        self.orgs[org["id"]] = org
        return org

    def seed_member(
        self, org: dict[str, Any], email: str, password_hash: str = "", **overrides: Any
    ) -> dict[str, Any]:
        member = {
            "id": str(uuid.uuid4()),
            "org_id": org["id"],
            "email": email,
            "password_hash": password_hash,
            "full_name": None,
            "role": "member",
            "status": "active",
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
        }
        member.update(overrides)
        self.members[member["id"]] = member
        return member

    def seed_subscription(self, org: dict[str, Any], **overrides: Any) -> dict[str, Any]:
        sub = {
            "id": str(uuid.uuid4()),
            "org_id": org["id"],
            "plan_id": str(uuid.uuid4()),
            "status": "active",
            "canceled_at": None,
            "created_at": datetime.now(UTC),
        }
        sub.update(overrides)
        self.subscriptions[sub["id"]] = sub
        return sub

    def seed_demo_request(
        self,
        kind: str = "demo",
        name: str = "Dana Operator",
        email: str = "dana@lot.example",
        company: str | None = "Lotwatch LLC",
        **overrides: Any,
    ) -> dict[str, Any]:
        row = {
            "id": str(uuid.uuid4()),
            "kind": kind,
            "name": name,
            "email": email,
            "company": company,
            "lot_size": None,
            "cameras": None,
            "topic": None,
            "message": None,
            "status": "new",
            "converted_org_id": None,
            "submitted_ip": None,
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
        }
        row.update(overrides)
        self.demo_requests[row["id"]] = row
        return row

    def seed_plan(self, code: str = "starter", amount_cents: int = 9900) -> dict[str, Any]:
        plan = {
            "id": str(uuid.uuid4()),
            "code": code,
            "name": code.title(),
            "amount_cents": amount_cents,
            "currency": "usd",
            "interval": "month",
            "active": True,
        }
        self.plans[plan["id"]] = plan
        return plan

    # ---- org methods -----------------------------------------------------

    async def get_org(self, org_id: str, conn: Any = None) -> dict[str, Any] | None:
        return self.orgs.get(str(org_id))

    async def update_org(self, org_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        org = self.orgs.get(str(org_id))
        if org is None or not fields:
            return None
        allowed = {
            "name", "contact_email", "notes",
            "sites_count", "cameras_count", "spaces_count",
        }
        org.update({k: v for k, v in fields.items() if k in allowed})
        org["updated_at"] = datetime.now(UTC)
        return org

    async def restore_org(self, org_id: str) -> dict[str, Any] | None:
        org = self.orgs.get(str(org_id))
        if org is None or org["status"] != "removed":
            return None
        org["status"] = "active"
        org["removed_at"] = None
        return org

    # ---- member methods --------------------------------------------------

    async def get_member(self, member_id: str) -> dict[str, Any] | None:
        return self.members.get(str(member_id))

    async def get_member_for_login(self, email: str) -> dict[str, Any] | None:
        for member in self.members.values():
            if member["email"].lower() == email.lower():
                org = self.orgs[member["org_id"]]
                return {**member, "org_name": org["name"], "org_status": org["status"]}
        return None

    async def member_auth_state(self, member_id: str) -> dict[str, Any] | None:
        member = self.members.get(str(member_id))
        if member is None:
            return None
        org = self.orgs[member["org_id"]]
        return {"member_status": member["status"], "org_status": org["status"]}

    # ---- subscription methods -------------------------------------------

    async def get_live_subscription(self, org_id: str) -> dict[str, Any] | None:
        for sub in self.subscriptions.values():
            if sub["org_id"] == str(org_id) and sub["status"] != "canceled":
                return sub
        return None

    async def get_plan(self, plan_id: str) -> dict[str, Any] | None:
        return self.plans.get(str(plan_id))

    async def create_subscription(
        self, org_id: str, plan_id: str, status: str, current_period_end: Any = None
    ) -> dict[str, Any]:
        import asyncpg

        if await self.get_live_subscription(org_id) is not None:
            raise asyncpg.UniqueViolationError("one live subscription per org")
        sub = {
            "id": str(uuid.uuid4()),
            "org_id": str(org_id),
            "plan_id": str(plan_id),
            "status": status,
            "current_period_end": current_period_end,
            "canceled_at": None,
        }
        self.subscriptions[sub["id"]] = sub
        return sub

    async def update_live_subscription(
        self, org_id: str, fields: dict[str, Any]
    ) -> dict[str, Any] | None:
        sub = await self.get_live_subscription(org_id)
        if sub is None:
            return None
        allowed = {"plan_id", "status", "current_period_end"}
        sub.update({k: v for k, v in fields.items() if k in allowed})
        if fields.get("status") == "canceled":
            sub["canceled_at"] = datetime.now(UTC)
        return sub

    # ---- payments (tier-1 fake: no invoice ledger) -----------------------

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
        if invoice_id is not None:
            return None
        return {
            "id": str(uuid.uuid4()),
            "org_id": str(org_id),
            "invoice_id": None,
            "amount_cents": amount_cents,
            "currency": "usd",
            "method": method,
            "status": status,
            "reference": reference,
            "note": note,
            "recorded_by": recorded_by,
            "received_at": datetime.now(UTC),
            "invoice": None,
        }

    # ---- intake ----------------------------------------------------------

    async def insert_demo_request(self, **kwargs: Any) -> dict[str, Any]:
        row = {
            "id": str(uuid.uuid4()),
            "status": "new",
            "created_at": datetime.now(UTC),
            "company": None,
            "lot_size": None,
            "cameras": None,
            "topic": None,
            "message": None,
            "converted_org_id": None,
            **kwargs,
        }
        self.demo_requests[row["id"]] = row
        return row

    async def get_demo_request(self, request_id: str) -> dict[str, Any] | None:
        return self.demo_requests.get(str(request_id))

    async def update_demo_request_status(
        self, request_id: str, status: str
    ) -> dict[str, Any] | None:
        row = self.demo_requests.get(str(request_id))
        if row is None:
            return None
        row["status"] = status
        row["updated_at"] = datetime.now(UTC)
        return row

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
        """Mirror of PortalDB.convert_demo_request's semantics (404/409 via
        the same exceptions, same audit rows and response shape)."""
        request = self.demo_requests.get(str(request_id))
        if request is None:
            raise DemoRequestNotFound(request_id)
        if request["status"] == "converted":
            raise DemoRequestAlreadyConverted(request_id)

        org = self.seed_org(
            name or request.get("company") or request["name"],
            contact_email=contact_email or request["email"],
            notes=f"Converted from demo request {request['id']}",
        )
        subscription = None
        if plan_id is not None:
            subscription = await self.create_subscription(org["id"], plan_id, "trialing")
        request["status"] = "converted"
        request["converted_org_id"] = org["id"]

        await self.insert_audit(
            actor_type="admin",
            actor_id=actor_email,
            action="org.created",
            org_id=org["id"],
            org_name=org["name"],
            target_type="org",
            target_id=org["id"],
            detail={"source": "demo_request", "demo_request_id": request["id"]},
            ip=ip,
        )
        await self.insert_audit(
            actor_type="admin",
            actor_id=actor_email,
            action="demo_request.converted",
            org_id=org["id"],
            org_name=org["name"],
            target_type="demo_request",
            target_id=request["id"],
            detail={"plan_id": plan_id},
            ip=ip,
        )
        return {
            "org": dict(org),
            "demo_request": dict(request),
            "subscription": dict(subscription) if subscription else None,
        }

    # ---- audit -----------------------------------------------------------

    async def insert_audit(self, *, conn: Any = None, **kwargs: Any) -> int:
        entry = {"id": len(self.audit) + 1, "created_at": datetime.now(UTC), **kwargs}
        self.audit.append(entry)
        return entry["id"]

    # ---- outbox ----------------------------------------------------------

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
        outbox_id = next(self._outbox_seq)
        self.outbox[outbox_id] = {
            "id": outbox_id,
            "to_email": to_email,
            "to_name": to_name,
            "subject": subject,
            "body_text": body_text,
            "template": template,
            "org_id": org_id,
            "status": status,
            "error": None,
            "attempts": 0,
            "created_at": datetime.now(UTC),
            "sent_at": None,
        }
        return outbox_id

    async def get_outbox(self, outbox_id: int) -> dict[str, Any] | None:
        return self.outbox.get(outbox_id)

    async def bump_outbox_attempt(self, outbox_id: int) -> None:
        self.outbox[outbox_id]["attempts"] += 1

    async def mark_outbox(self, outbox_id: int, status: str, error: str | None = None) -> None:
        row = self.outbox[outbox_id]
        row["status"] = status
        row["error"] = error
        if status == "sent":
            row["sent_at"] = datetime.now(UTC)

    # ---- overview (no invoice ledger in the fake: those counts are 0) -----

    async def overview(self) -> dict[str, Any]:
        now = datetime.now(UTC)
        week_ago = now - timedelta(days=7)
        fortnight_ago = now - timedelta(days=14)

        def monthly(plan: dict[str, Any]) -> int:
            if plan["interval"] == "year":
                return plan["amount_cents"] // 12
            return plan["amount_cents"]

        mrr = 0
        mrr_prev = 0
        for sub in self.subscriptions.values():
            plan = self.plans.get(sub["plan_id"])
            if plan is None:
                continue
            if sub["status"] in ("active", "past_due"):
                mrr += monthly(plan)
            created = sub.get("created_at")
            canceled = sub.get("canceled_at")
            if created is not None and created <= week_ago and (
                canceled is None or canceled > week_ago
            ):
                mrr_prev += monthly(plan)

        active_orgs = [o for o in self.orgs.values() if o["status"] == "active"]
        live_org_ids = {
            s["org_id"] for s in self.subscriptions.values() if s["status"] != "canceled"
        }
        no_sub = sorted(
            (o for o in active_orgs if o["id"] not in live_org_ids),
            key=lambda o: o["created_at"],
            reverse=True,
        )
        demos = list(self.demo_requests.values())
        return {
            "orgs_active": len(active_orgs),
            "demo_requests_new": sum(1 for d in demos if d["status"] == "new"),
            "invoices_open": 0,
            "outbox_captured": sum(
                1 for r in self.outbox.values() if r["status"] == "captured"
            ),
            "mrr_cents": mrr,
            "mrr_prev_cents": mrr_prev,
            "demo_requests_7d": sum(1 for d in demos if d["created_at"] >= week_ago),
            "demo_requests_prev_7d": sum(
                1 for d in demos if fortnight_ago <= d["created_at"] < week_ago
            ),
            "attention": {
                "untriaged_demos": sum(1 for d in demos if d["status"] == "new"),
                "failed_outbox": sum(
                    1 for r in self.outbox.values() if r["status"] == "failed"
                ),
                "overdue_invoices": 0,
                "orgs_without_subscription": [
                    {"id": o["id"], "name": o["name"]} for o in no_sub[:5]
                ],
                "orgs_without_subscription_total": len(no_sub),
            },
        }
