"""Admin + member auth flows over the fake session store."""
from __future__ import annotations

import bcrypt

from tests.fakes import make_settings


def _hash(password: str) -> str:
    # rounds=4 keeps the test suite fast; verify_password doesn't care.
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode()


# ------------------------------------------------------------------- admin


def test_admin_login_and_me(portal, admin_headers):
    response = portal.client.get("/auth/admin/me", headers=admin_headers)
    assert response.status_code == 200
    assert response.json() == {"email": portal.settings.admin_email}


def test_admin_login_wrong_password(portal):
    response = portal.client.post(
        "/auth/admin/login",
        json={"email": portal.settings.admin_email, "password": "wrong"},
    )
    assert response.status_code == 401


def test_admin_login_unconfigured_returns_503(portal):
    portal.state.settings = make_settings(admin_email=None, admin_password=None)
    response = portal.client.post(
        "/auth/admin/login", json={"email": "a@b.co", "password": "x"}
    )
    assert response.status_code == 503


def test_admin_logout_invalidates_session(portal, admin_headers):
    assert portal.client.post("/auth/admin/logout", headers=admin_headers).status_code == 200
    assert portal.client.get("/auth/admin/me", headers=admin_headers).status_code == 401


def test_admin_routes_require_token(portal):
    assert portal.client.get("/admin/orgs").status_code == 401
    assert portal.client.get("/admin/orgs", headers={"Authorization": "Bearer nope"}).status_code == 401


# ------------------------------------------------------------------ member


def _seed_member(portal, password: str = "hunter2boogaloo", **overrides):
    org = portal.db.seed_org()
    member = portal.db.seed_member(org, "op@acme.test", _hash(password), **overrides)
    return org, member


def _member_login(portal, email="op@acme.test", password="hunter2boogaloo"):
    return portal.client.post(
        "/auth/member/login", json={"email": email, "password": password}
    )


def test_member_login_success_and_me(portal):
    org, _member = _seed_member(portal)
    response = _member_login(portal)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["org"] == {"id": org["id"], "name": org["name"]}

    headers = {"Authorization": f"Bearer {body['token']}"}
    me = portal.client.get("/auth/member/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["org"]["status"] == "active"


def test_member_login_wrong_password(portal):
    _seed_member(portal)
    assert _member_login(portal, password="nope-nope-nope").status_code == 401


def test_member_login_unknown_email(portal):
    assert _member_login(portal, email="ghost@acme.test").status_code == 401


def test_member_login_disabled_member(portal):
    _seed_member(portal, status="disabled")
    assert _member_login(portal).status_code == 401


def test_member_login_removed_org_is_403(portal):
    org, _ = _seed_member(portal)
    org["status"] = "removed"
    assert _member_login(portal).status_code == 403


def test_member_session_killed_when_org_flips_to_removed(portal):
    """Belt and braces: even with a live Redis session, the per-request PG
    check locks the member out and deletes the session."""
    org, _ = _seed_member(portal)
    token = _member_login(portal).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert portal.client.get("/auth/member/me", headers=headers).status_code == 200

    org["status"] = "removed"
    assert portal.client.get("/auth/member/me", headers=headers).status_code == 403
    # Session was deleted, so even restoring the org doesn't revive the token.
    org["status"] = "active"
    assert portal.client.get("/auth/member/me", headers=headers).status_code == 401
