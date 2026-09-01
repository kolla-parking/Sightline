"""Overview deltas + attention rollup, and the org infrastructure fields."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta


def test_overview_deltas_and_attention(portal, admin_headers):
    plan = portal.db.seed_plan(amount_cents=9900)
    paying = portal.db.seed_org("Paying Org")
    portal.db.seed_subscription(
        paying,
        plan_id=plan["id"],
        created_at=datetime.now(UTC) - timedelta(days=30),
    )
    bare = portal.db.seed_org("No Sub Org")  # active, no subscription

    portal.db.seed_demo_request()  # untriaged, inside the 7-day window
    portal.db.seed_demo_request(
        status="contacted",
        created_at=datetime.now(UTC) - timedelta(days=10),
    )
    portal.db.outbox[99] = {"id": 99, "status": "failed"}

    response = portal.client.get("/admin/overview", headers=admin_headers)
    assert response.status_code == 200, response.text
    data = response.json()

    # Existing keys survive untouched.
    assert data["orgs_active"] == 2
    assert data["demo_requests_new"] == 1
    assert data["invoices_open"] == 0
    assert data["outbox_captured"] == 0
    assert data["mrr_cents"] == 9900

    # Additive keys.
    assert data["mrr_prev_cents"] == 9900  # sub existed and was live a week ago
    assert data["demo_requests_7d"] == 1
    assert data["demo_requests_prev_7d"] == 1

    attention = data["attention"]
    assert attention["untriaged_demos"] == 1
    assert attention["failed_outbox"] == 1
    assert attention["overdue_invoices"] == 0
    assert attention["orgs_without_subscription"] == [
        {"id": bare["id"], "name": "No Sub Org"}
    ]
    assert attention["orgs_without_subscription_total"] == 1


def test_overview_prev_mrr_excludes_recent_and_canceled_subs(portal, admin_headers):
    plan = portal.db.seed_plan(amount_cents=5000)
    fresh = portal.db.seed_org("Fresh Org")
    portal.db.seed_subscription(fresh, plan_id=plan["id"])  # created just now
    churned = portal.db.seed_org("Churned Org")
    portal.db.seed_subscription(
        churned,
        plan_id=plan["id"],
        status="canceled",
        created_at=datetime.now(UTC) - timedelta(days=30),
        canceled_at=datetime.now(UTC) - timedelta(days=10),
    )

    data = portal.client.get("/admin/overview", headers=admin_headers).json()
    assert data["mrr_cents"] == 5000  # only the live subscription
    assert data["mrr_prev_cents"] == 0  # too new / already canceled at T-7d


# --------------------------------------------------- org infrastructure

def test_org_patch_persists_infrastructure_counts(portal, admin_headers):
    org = portal.db.seed_org()
    response = portal.client.patch(
        f"/admin/orgs/{org['id']}",
        json={"sites_count": 2, "cameras_count": 12, "spaces_count": 450},
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sites_count"] == 2
    assert body["cameras_count"] == 12
    assert body["spaces_count"] == 450
    assert portal.db.orgs[org["id"]]["cameras_count"] == 12
    assert any(e["action"] == "org.updated" for e in portal.db.audit)

    # Explicit null clears.
    cleared = portal.client.patch(
        f"/admin/orgs/{org['id']}",
        json={"cameras_count": None},
        headers=admin_headers,
    )
    assert cleared.status_code == 200
    assert cleared.json()["cameras_count"] is None


def test_org_patch_rejects_negative_counts(portal, admin_headers):
    org = portal.db.seed_org()
    response = portal.client.patch(
        f"/admin/orgs/{org['id']}",
        json={"cameras_count": -1},
        headers=admin_headers,
    )
    assert response.status_code == 422
