"""Billing router glue over the fake ledger. Exact invoice-rollup SQL is
covered by the opt-in Postgres tier in test_portal_pg.py."""
from __future__ import annotations


def test_subscription_create_and_conflict(portal, admin_headers):
    org = portal.db.seed_org(contact_email="billing@acme.test")
    plan = portal.db.seed_plan()

    response = portal.client.post(
        f"/admin/orgs/{org['id']}/subscription",
        json={"plan_id": plan["id"]},
        headers=admin_headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "active"

    conflict = portal.client.post(
        f"/admin/orgs/{org['id']}/subscription",
        json={"plan_id": plan["id"]},
        headers=admin_headers,
    )
    assert conflict.status_code == 409


def test_subscription_unknown_plan_404(portal, admin_headers):
    org = portal.db.seed_org()
    response = portal.client.post(
        f"/admin/orgs/{org['id']}/subscription",
        json={"plan_id": "00000000-0000-0000-0000-000000000000"},
        headers=admin_headers,
    )
    assert response.status_code == 404


def test_subscription_cancel_via_patch(portal, admin_headers):
    org = portal.db.seed_org()
    plan = portal.db.seed_plan()
    portal.client.post(
        f"/admin/orgs/{org['id']}/subscription",
        json={"plan_id": plan["id"]},
        headers=admin_headers,
    )
    response = portal.client.patch(
        f"/admin/orgs/{org['id']}/subscription",
        json={"status": "canceled"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "canceled"
    # No live subscription left to patch.
    again = portal.client.patch(
        f"/admin/orgs/{org['id']}/subscription",
        json={"status": "active"},
        headers=admin_headers,
    )
    assert again.status_code == 404


def test_record_payment_writes_audit_and_receipt(portal, admin_headers):
    org = portal.db.seed_org(contact_email="billing@acme.test")
    response = portal.client.post(
        f"/admin/orgs/{org['id']}/payments",
        json={"amount_cents": 9900, "method": "ach", "note": "first month"},
        headers=admin_headers,
    )
    assert response.status_code == 201, response.text
    payment = response.json()
    assert payment["recorded_by"] == portal.settings.admin_email

    assert any(e["action"] == "payment.recorded" for e in portal.db.audit)
    receipts = [r for r in portal.db.outbox.values() if r["template"] == "payment_receipt"]
    assert len(receipts) == 1
    assert receipts[0]["to_email"] == "billing@acme.test"
    assert receipts[0]["status"] == "captured"


def test_subscription_on_removed_org_conflicts(portal, admin_headers):
    org = portal.db.seed_org(status="removed")
    plan = portal.db.seed_plan()
    response = portal.client.post(
        f"/admin/orgs/{org['id']}/subscription",
        json={"plan_id": plan["id"]},
        headers=admin_headers,
    )
    assert response.status_code == 409
t