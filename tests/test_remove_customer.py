"""The remove-customer sequence: billing stops, access revoked, sessions
terminated, members notified, audit written."""
from __future__ import annotations

import bcrypt


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode()


def _seed_customer(portal):
    org = portal.db.seed_org("Acme Parking")
    active_a = portal.db.seed_member(org, "a@acme.test", _hash("password-aaaa"))
    active_b = portal.db.seed_member(
        org, "b@acme.test", _hash("password-bbbb"), full_name="Bee Operator"
    )
    portal.db.seed_member(org, "c@acme.test", _hash("password-cccc"), status="disabled")
    portal.db.seed_subscription(org)
    return org, active_a, active_b


def _login_member(portal, email, password):
    response = portal.client.post(
        "/auth/member/login", json={"email": email, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()["token"]


def test_remove_customer_full_sequence(portal, admin_headers):
    org, _a, _b = _seed_customer(portal)
    token_a = _login_member(portal, "a@acme.test", "password-aaaa")
    token_b = _login_member(portal, "b@acme.test", "password-bbbb")

    response = portal.client.delete(f"/admin/orgs/{org['id']}", headers=admin_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "removed"
    assert body["subscriptions_canceled"] == 1
    assert body["members_notified"] == 2  # the disabled member is not notified
    assert body["sessions_revoked"] == 2

    # Org and subscription state.
    assert portal.db.orgs[org["id"]]["status"] == "removed"
    assert all(s["status"] == "canceled" for s in portal.db.subscriptions.values())

    # Members are notified via captured outbox rows (SMTP unconfigured).
    revoked = [r for r in portal.db.outbox.values() if r["template"] == "access_revoked"]
    assert {r["to_email"] for r in revoked} == {"a@acme.test", "b@acme.test"}
    assert all(r["status"] == "captured" for r in revoked)
    assert all(org["name"] in r["subject"] for r in revoked)

    # Audit trail: who, when, org name.
    entries = [e for e in portal.db.audit if e["action"] == "org.removed"]
    assert len(entries) == 1
    entry = entries[0]
    assert entry["actor_id"] == portal.settings.admin_email
    assert entry["org_name"] == "Acme Parking"
    assert entry["detail"] == {"subscriptions_canceled": 1, "members_notified": 2}

    # Terminated sessions are gone, and login is now refused with 403.
    for token in (token_a, token_b):
        me = portal.client.get(
            "/auth/member/me", headers={"Authorization": f"Bearer {token}"}
        )
        assert me.status_code in (401, 403)
    login = portal.client.post(
        "/auth/member/login", json={"email": "a@acme.test", "password": "password-aaaa"}
    )
    assert login.status_code == 403


def test_remove_twice_conflicts(portal, admin_headers):
    org, *_ = _seed_customer(portal)
    assert portal.client.delete(f"/admin/orgs/{org['id']}", headers=admin_headers).status_code == 200
    assert portal.client.delete(f"/admin/orgs/{org['id']}", headers=admin_headers).status_code == 409


def test_remove_unknown_org_404(portal, admin_headers):
    assert (
        portal.client.delete(
            "/admin/orgs/00000000-0000-0000-0000-000000000000", headers=admin_headers
        ).status_code
        == 404
    )


def test_redis_failure_still_removes_and_locks_out(portal, admin_headers, monkeypatch):
    """Session purge is best-effort; lockout is guaranteed by the PG check."""
    org, _a, _b = _seed_customer(portal)
    token = _login_member(portal, "a@acme.test", "password-aaaa")

    async def broken_revoke(_org_id):
        raise ConnectionError("redis down")

    monkeypatch.setattr(portal.sessions, "revoke_org", broken_revoke)

    response = portal.client.delete(f"/admin/orgs/{org['id']}", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["sessions_revoked"] == 0

    # The surviving Redis session is useless: belt-and-braces PG check 403s.
    me = portal.client.get("/auth/member/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 403


def test_restore_reactivates_logins_but_not_billing(portal, admin_headers):
    org, *_ = _seed_customer(portal)
    portal.client.delete(f"/admin/orgs/{org['id']}", headers=admin_headers)

    response = portal.client.post(f"/admin/orgs/{org['id']}/restore", headers=admin_headers)
    assert response.status_code == 200
    assert portal.db.orgs[org["id"]]["status"] == "active"

    # Members can sign in again; the subscription stays canceled.
    assert (
        portal.client.post(
            "/auth/member/login", json={"email": "a@acme.test", "password": "password-aaaa"}
        ).status_code
        == 200
    )
    assert all(s["status"] == "canceled" for s in portal.db.subscriptions.values())
    assert any(e["action"] == "org.restored" for e in portal.db.audit)
