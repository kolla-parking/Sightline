"""Opt-in integration tests against a real Postgres.

Skipped unless TEST_DATABASE_URL is set, e.g.:
    TEST_DATABASE_URL=postgresql://sightline:sightline@localhost:5432/sightline_test

The fixture creates the database fresh (dropping any leftover), runs the
migration runner against it, and exercises the raw-SQL paths the tier-1
fakes can't: migration idempotency, the remove-customer transaction, and the
invoice payment rollup.
"""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="set TEST_DATABASE_URL to run Postgres integration tests",
)

if TEST_DATABASE_URL:
    import asyncpg

    from backend.services.database import Database
    from backend.services.migrations import run_migrations
    from backend.services.org_lifecycle import remove_organization
    from backend.services.portal_db import (
        DemoRequestAlreadyConverted,
        PortalDB,
    )
    from tests.fakes import FakeRedis, make_settings
    from backend.services.auth_sessions import SessionStore
    from backend.services.mailer import Mailer


def _admin_url_and_dbname() -> tuple[str, str]:
    base, _, dbname = TEST_DATABASE_URL.rpartition("/")
    return f"{base}/postgres", dbname


async def _recreate_database() -> None:
    admin_url, dbname = _admin_url_and_dbname()
    conn = await asyncpg.connect(admin_url)
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{dbname}"')
    finally:
        await conn.close()


@pytest.fixture(scope="module")
def pg():
    """A connected Database + PortalDB over a freshly migrated test DB."""
    asyncio.run(_recreate_database())

    async def _setup():
        db = Database(TEST_DATABASE_URL)
        await db.connect()
        assert not db.memory_mode, "test Postgres must be reachable"
        applied = await run_migrations(db.pool)
        return db, applied

    loop = asyncio.new_event_loop()
    db, applied = loop.run_until_complete(_setup())
    yield SimpleNamespaceLike(db=db, portal=PortalDB(db), loop=loop, applied=applied)
    loop.run_until_complete(db.close())
    loop.close()


class SimpleNamespaceLike:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)

    def run(self, coro):
        return self.loop.run_until_complete(coro)


def test_migrations_apply_then_noop(pg):
    assert [name.split("_")[0] for name in pg.applied] == [
        "001", "002", "003", "004", "005",
    ]
    # Second run is a no-op.
    again = pg.run(run_migrations(pg.db.pool))
    assert again == []

    async def _count():
        async with pg.db.pool.acquire() as conn:
            return await conn.fetchval("SELECT count(*) FROM schema_migrations")

    assert pg.run(_count()) == 5


def test_plans_seeded(pg):
    plans = pg.run(pg.portal.list_plans())
    assert {p["code"] for p in plans} >= {"starter", "growth", "site"}


def test_payment_rollup_marks_invoice_paid_exactly_at_full_amount(pg):
    portal = pg.portal
    org = pg.run(portal.create_org("Rollup Org", "b@rollup.test", None))
    invoice = pg.run(portal.create_invoice(org["id"], 10000, memo="first month"))
    assert invoice["status"] == "open"
    assert invoice["number"].startswith("INV-")

    partial = pg.run(
        portal.record_payment(
            org["id"], 4000, "ach", "succeeded", "admin@test", invoice_id=invoice["id"]
        )
    )
    assert partial["invoice"]["status"] == "open"
    assert partial["invoice"]["amount_paid_cents"] == 4000

    final = pg.run(
        portal.record_payment(
            org["id"], 6000, "ach", "succeeded", "admin@test", invoice_id=invoice["id"]
        )
    )
    assert final["invoice"]["status"] == "paid"
    assert final["invoice"]["amount_paid_cents"] == 10000
    assert final["invoice"]["paid_at"] is not None

    # A failed payment must not roll up.
    invoice2 = pg.run(portal.create_invoice(org["id"], 500))
    failed = pg.run(
        portal.record_payment(
            org["id"], 500, "card", "failed", "admin@test", invoice_id=invoice2["id"]
        )
    )
    assert failed["invoice"] is None
    assert pg.run(portal.get_invoice(invoice2["id"]))["status"] == "open"


def test_one_live_subscription_per_org_enforced_by_index(pg):
    portal = pg.portal
    org = pg.run(portal.create_org("Subs Org", None, None))
    plans = pg.run(portal.list_plans())
    plan_id = plans[0]["id"]

    first = pg.run(portal.create_subscription(org["id"], plan_id, "active"))
    assert first["status"] == "active"
    with pytest.raises(asyncpg.UniqueViolationError):
        pg.run(portal.create_subscription(org["id"], plan_id, "active"))

    # Cancel, then a new one is allowed.
    pg.run(portal.update_live_subscription(org["id"], {"status": "canceled"}))
    second = pg.run(portal.create_subscription(org["id"], plan_id, "trialing"))
    assert second["status"] == "trialing"


def test_remove_customer_through_real_sql(pg):
    portal = pg.portal
    settings = make_settings()
    sessions = SessionStore(FakeRedis(), settings)
    mailer = Mailer(settings, portal)

    org = pg.run(portal.create_org("Doomed Org", "own@doomed.test", None))
    plans = pg.run(pg.portal.list_plans())
    pg.run(portal.create_subscription(org["id"], plans[0]["id"], "active"))
    member = pg.run(
        portal.create_member(org["id"], f"m-{uuid.uuid4().hex[:8]}@doomed.test", "x" * 60, "Mem Ber", "member")
    )
    token = pg.run(sessions.create_member(member["id"], org["id"], member["email"]))

    result = pg.run(
        remove_organization(
            portal,
            sessions,
            mailer,
            settings,
            org_id=org["id"],
            actor_email="admin@test",
            ip="203.0.113.9",
        )
    )
    assert result["status"] == "removed"
    assert result["subscriptions_canceled"] == 1
    assert result["members_notified"] == 1
    assert result["sessions_revoked"] == 1

    assert pg.run(sessions.get("member", token)) is None
    assert pg.run(portal.get_org(org["id"]))["status"] == "removed"
    assert pg.run(portal.get_live_subscription(org["id"])) is None

    outbox, _ = pg.run(portal.list_outbox(status="captured"))
    assert any(
        row["template"] == "access_revoked" and row["to_email"] == member["email"]
        for row in outbox
    )

    audit, _ = pg.run(portal.list_audit(org_id=org["id"], action="org.removed"))
    assert len(audit) == 1
    assert audit[0]["org_name"] == "Doomed Org"
    assert audit[0]["actor_id"] == "admin@test"
    assert audit[0]["ip"] == "203.0.113.9"
    assert audit[0]["detail"] == {"subscriptions_canceled": 1, "members_notified": 1}

    # Second removal raises the already-removed conflict.
    from backend.services.org_lifecycle import OrgAlreadyRemoved

    with pytest.raises(OrgAlreadyRemoved):
        pg.run(
            remove_organization(
                portal, sessions, mailer, settings,
                org_id=org["id"], actor_email="admin@test", ip=None,
            )
        )


def test_convert_demo_request_through_real_sql(pg):
    portal = pg.portal
    request = pg.run(
        portal.insert_demo_request(
            kind="demo",
            name="Dana Operator",
            email="dana@convert.test",
            company="Convert Co",
            submitted_ip="198.51.100.7",
        )
    )
    plans = pg.run(portal.list_plans())
    plan_id = plans[0]["id"]

    result = pg.run(
        portal.convert_demo_request(
            request["id"],
            actor_email="admin@test",
            plan_id=plan_id,
            ip="203.0.113.5",
        )
    )
    org = result["org"]
    assert org["name"] == "Convert Co"
    assert org["contact_email"] == "dana@convert.test"
    assert org["notes"] == f"Converted from demo request {request['id']}"
    assert result["subscription"]["status"] == "trialing"
    assert result["subscription"]["plan_id"] == plan_id
    # The widened check constraint allows 'converted' and the FK is set.
    assert result["demo_request"]["status"] == "converted"
    assert result["demo_request"]["converted_org_id"] == org["id"]

    refreshed = pg.run(portal.get_demo_request(request["id"]))
    assert refreshed["status"] == "converted"
    assert refreshed["converted_org_id"] == org["id"]

    audit, _ = pg.run(portal.list_audit(org_id=org["id"]))
    actions = {row["action"] for row in audit}
    assert {"org.created", "demo_request.converted"} <= actions
    converted = next(r for r in audit if r["action"] == "demo_request.converted")
    assert converted["target_id"] == request["id"]
    assert converted["detail"] == {"plan_id": plan_id}

    # Second conversion raises the already-converted conflict.
    with pytest.raises(DemoRequestAlreadyConverted):
        pg.run(portal.convert_demo_request(request["id"], actor_email="admin@test"))


def test_org_infra_counts_and_health_through_real_sql(pg):
    portal = pg.portal
    org = pg.run(portal.create_org("Fleet Org", None, None))

    def _listed():
        items, _ = pg.run(portal.list_orgs(q="Fleet Org"))
        assert len(items) == 1
        return items[0]

    # Unknown until cameras_count is recorded.
    item = _listed()
    assert item["cameras_count"] is None
    assert item["health"] == "unknown"

    updated = pg.run(
        portal.update_org(
            org["id"], {"sites_count": 1, "cameras_count": 0, "spaces_count": 40}
        )
    )
    assert updated["cameras_count"] == 0
    assert _listed()["health"] == "attention"  # zero cameras

    pg.run(portal.update_org(org["id"], {"cameras_count": 8}))
    assert _listed()["health"] == "attention"  # active org, no live subscription

    plans = pg.run(portal.list_plans())
    pg.run(portal.create_subscription(org["id"], plans[0]["id"], "active"))
    detail = pg.run(portal.get_org_detail(org["id"]))
    assert detail["org"]["health"] == "healthy"
    assert detail["org"]["sites_count"] == 1
    assert detail["org"]["spaces_count"] == 40

    # Explicit null clears back to unknown.
    pg.run(portal.update_org(org["id"], {"cameras_count": None}))
    assert _listed()["health"] == "unknown"


def test_overview_shape_through_real_sql(pg):
    data = pg.run(pg.portal.overview())
    assert set(data) == {
        "orgs_active",
        "demo_requests_new",
        "invoices_open",
        "outbox_captured",
        "mrr_cents",
        "mrr_prev_cents",
        "demo_requests_7d",
        "demo_requests_prev_7d",
        "attention",
    }
    attention = data["attention"]
    assert set(attention) == {
        "untriaged_demos",
        "failed_outbox",
        "overdue_invoices",
        "orgs_without_subscription",
        "orgs_without_subscription_total",
    }
    assert len(attention["orgs_without_subscription"]) <= 5
    for entry in attention["orgs_without_subscription"]:
        assert set(entry) == {"id", "name"}


def test_member_auth_state_and_login_join(pg):
    portal = pg.portal
    org = pg.run(portal.create_org("Login Org", None, None))
    email = f"login-{uuid.uuid4().hex[:8]}@test.example"
    member = pg.run(portal.create_member(org["id"], email, "hash" * 15, None, "owner"))

    login_row = pg.run(portal.get_member_for_login(email.upper()))
    assert login_row is not None
    assert login_row["org_status"] == "active"
    assert login_row["role"] == "owner"

    state = pg.run(portal.member_auth_state(member["id"]))
    assert state == {"member_status": "active", "org_status": "active"}
