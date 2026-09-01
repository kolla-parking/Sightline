"""Demo-request conversion: org creation, optional trialing subscription,
status flip + audit trail, and the guards around double conversion."""
from __future__ import annotations

MISSING = "00000000-0000-0000-0000-000000000000"


def _convert(portal, admin_headers, request_id, body=None):
    return portal.client.post(
        f"/admin/demo-requests/{request_id}/convert",
        json=body if body is not None else {},
        headers=admin_headers,
    )


# ------------------------------------------------------------- single GET

def test_get_single_demo_request(portal, admin_headers):
    row = portal.db.seed_demo_request()
    response = portal.client.get(
        f"/admin/demo-requests/{row['id']}", headers=admin_headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == row["id"]
    assert body["status"] == "new"
    assert body["converted_org_id"] is None


def test_get_single_demo_request_404(portal, admin_headers):
    response = portal.client.get(
        f"/admin/demo-requests/{MISSING}", headers=admin_headers
    )
    assert response.status_code == 404


# --------------------------------------------------------------- convert

def test_convert_defaults_to_company_and_email(portal, admin_headers):
    row = portal.db.seed_demo_request(company="Lotwatch LLC", email="dana@lot.example")
    response = _convert(portal, admin_headers, row["id"])
    assert response.status_code == 201, response.text
    body = response.json()

    org = body["org"]
    assert org["name"] == "Lotwatch LLC"
    assert org["contact_email"] == "dana@lot.example"
    assert org["notes"] == f"Converted from demo request {row['id']}"
    assert org["id"] in portal.db.orgs
    assert body["subscription"] is None

    assert body["demo_request"]["status"] == "converted"
    assert body["demo_request"]["converted_org_id"] == org["id"]
    assert portal.db.demo_requests[row["id"]]["status"] == "converted"

    created = [e for e in portal.db.audit if e["action"] == "org.created"]
    assert len(created) == 1
    assert created[0]["org_id"] == org["id"]
    assert created[0]["detail"] == {
        "source": "demo_request",
        "demo_request_id": row["id"],
    }
    converted = [e for e in portal.db.audit if e["action"] == "demo_request.converted"]
    assert len(converted) == 1
    assert converted[0]["target_type"] == "demo_request"
    assert converted[0]["target_id"] == row["id"]
    assert converted[0]["detail"] == {"plan_id": None}


def test_convert_contact_without_company_falls_back_to_name(portal, admin_headers):
    row = portal.db.seed_demo_request(kind="contact", company=None, name="Sam Caller")
    response = _convert(portal, admin_headers, row["id"])
    assert response.status_code == 201, response.text
    assert response.json()["org"]["name"] == "Sam Caller"


def test_convert_with_plan_creates_trialing_subscription(portal, admin_headers):
    plan = portal.db.seed_plan()
    row = portal.db.seed_demo_request()
    response = _convert(portal, admin_headers, row["id"], {"plan_id": plan["id"]})
    assert response.status_code == 201, response.text
    body = response.json()

    subscription = body["subscription"]
    assert subscription is not None
    assert subscription["status"] == "trialing"
    assert subscription["plan_id"] == plan["id"]
    assert subscription["org_id"] == body["org"]["id"]

    converted = next(e for e in portal.db.audit if e["action"] == "demo_request.converted")
    assert converted["detail"] == {"plan_id": plan["id"]}


def test_convert_with_explicit_overrides(portal, admin_headers):
    row = portal.db.seed_demo_request(company="Lotwatch LLC", email="dana@lot.example")
    response = _convert(
        portal,
        admin_headers,
        row["id"],
        {"name": "Custom Org Name", "contact_email": "billing@custom.example"},
    )
    assert response.status_code == 201, response.text
    org = response.json()["org"]
    assert org["name"] == "Custom Org Name"
    assert org["contact_email"] == "billing@custom.example"


def test_convert_unknown_request_404(portal, admin_headers):
    response = _convert(portal, admin_headers, MISSING)
    assert response.status_code == 404


def test_convert_unknown_plan_404_leaves_request_untouched(portal, admin_headers):
    row = portal.db.seed_demo_request()
    response = _convert(portal, admin_headers, row["id"], {"plan_id": MISSING})
    assert response.status_code == 404
    assert portal.db.demo_requests[row["id"]]["status"] == "new"
    assert portal.db.orgs == {}


def test_double_convert_conflicts(portal, admin_headers):
    row = portal.db.seed_demo_request()
    assert _convert(portal, admin_headers, row["id"]).status_code == 201
    again = _convert(portal, admin_headers, row["id"])
    assert again.status_code == 409
    assert again.json()["detail"] == "demo request is already converted"
    assert len(portal.db.orgs) == 1


def test_converted_request_cannot_be_retriaged(portal, admin_headers):
    row = portal.db.seed_demo_request()
    assert _convert(portal, admin_headers, row["id"]).status_code == 201

    response = portal.client.patch(
        f"/admin/demo-requests/{row['id']}",
        json={"status": "contacted"},
        headers=admin_headers,
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "converted requests cannot be re-triaged"
    assert portal.db.demo_requests[row["id"]]["status"] == "converted"


def test_triage_still_works_for_unconverted_requests(portal, admin_headers):
    row = portal.db.seed_demo_request()
    response = portal.client.patch(
        f"/admin/demo-requests/{row['id']}",
        json={"status": "contacted"},
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "contacted"
    assert any(e["action"] == "demo_request.status_changed" for e in portal.db.audit)
