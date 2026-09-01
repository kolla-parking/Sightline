"""Public demo/contact intake: persistence, honeypot, rate limit, memory mode."""
from __future__ import annotations

from types import SimpleNamespace

DEMO_PAYLOAD = {
    "name": "Dana Operator",
    "email": "dana@lot.example",
    "company": "Lotwatch LLC",
    "lot_size": "200 to 1,000 spaces",
    "cameras": "Yes, IP/RTSP cameras installed",
    "message": "We run three garages downtown.",
}


def test_demo_request_persists_and_notifies(portal):
    response = portal.client.post("/public/demo-requests", json=DEMO_PAYLOAD)
    assert response.status_code == 202, response.text
    assert response.json()["status"] == "received"

    rows = list(portal.db.demo_requests.values())
    assert len(rows) == 1
    row = rows[0]
    assert row["kind"] == "demo"
    for key, value in DEMO_PAYLOAD.items():
        assert row[key] == value

    # SMTP unconfigured -> the admin notification is captured, not dropped.
    outbox = list(portal.db.outbox.values())
    assert len(outbox) == 1
    assert outbox[0]["status"] == "captured"
    assert outbox[0]["template"] == "demo_request_admin"
    assert outbox[0]["to_email"] == portal.settings.admin_email


def test_contact_request_persists(portal):
    response = portal.client.post(
        "/public/contact-requests",
        json={"name": "Sam", "email": "sam@x.example", "topic": "Press", "message": "Hi"},
    )
    assert response.status_code == 202
    row = next(iter(portal.db.demo_requests.values()))
    assert row["kind"] == "contact"
    assert row["topic"] == "Press"


def test_honeypot_returns_success_but_stores_nothing(portal):
    response = portal.client.post(
        "/public/demo-requests", json={**DEMO_PAYLOAD, "website": "http://spam.example"}
    )
    assert response.status_code == 202
    assert portal.db.demo_requests == {}
    assert portal.db.outbox == {}


def test_rate_limit_shared_across_intake(portal):
    # make_settings sets demo_rate_limit=3.
    for _ in range(3):
        assert portal.client.post("/public/demo-requests", json=DEMO_PAYLOAD).status_code == 202
    assert portal.client.post("/public/demo-requests", json=DEMO_PAYLOAD).status_code == 429
    # Same window covers the contact endpoint too.
    response = portal.client.post(
        "/public/contact-requests",
        json={"name": "Sam", "email": "sam@x.example", "message": "Hi"},
    )
    assert response.status_code == 429


def test_rate_limit_fails_open_when_redis_down(portal):
    portal.redis.broken = True
    assert portal.client.post("/public/demo-requests", json=DEMO_PAYLOAD).status_code == 202


def test_memory_mode_hard_fails(portal):
    portal.state.db = SimpleNamespace(memory_mode=True)
    response = portal.client.post("/public/demo-requests", json=DEMO_PAYLOAD)
    assert response.status_code == 503
    assert portal.db.demo_requests == {}


def test_validation_rejects_missing_company(portal):
    payload = {k: v for k, v in DEMO_PAYLOAD.items() if k != "company"}
    assert portal.client.post("/public/demo-requests", json=payload).status_code == 422
