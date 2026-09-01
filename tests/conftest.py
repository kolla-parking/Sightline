from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.api import main as api_main
from backend.services.auth_sessions import SessionStore
from backend.services.mailer import Mailer

from tests.fakes import FakePortalDB, FakeRedis, make_settings


@pytest.fixture
def portal(monkeypatch):
    """TestClient over the real app with fakes seeded into app.state.

    The client is used WITHOUT entering its context manager so the lifespan
    (camera startup, real DB/Redis wiring) never runs.
    """
    settings = make_settings()
    redis = FakeRedis()
    portal_db = FakePortalDB()
    sessions = SessionStore(redis, settings)
    mailer = Mailer(settings, portal_db)

    state = api_main.app.state
    state.settings = settings
    state.db = SimpleNamespace(memory_mode=False)
    state.redis = redis
    state.sessions = sessions
    state.portal_db = portal_db
    state.mailer = mailer

    client = TestClient(api_main.app, raise_server_exceptions=False)

    return SimpleNamespace(
        client=client,
        settings=settings,
        redis=redis,
        db=portal_db,
        sessions=sessions,
        mailer=mailer,
        state=state,
    )


@pytest.fixture
def admin_headers(portal):
    response = portal.client.post(
        "/auth/admin/login",
        json={"email": portal.settings.admin_email, "password": portal.settings.admin_password},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}
