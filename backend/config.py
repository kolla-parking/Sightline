"""Central settings for the portal surface.

The camera/detection code keeps its historical bare os.getenv() reads; this
module only covers configuration introduced with the admin portal (auth,
email, billing, CORS). Values are read once and cached — restart to pick up
env changes.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


def _csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    database_url: str
    redis_url: str
    cors_origins: tuple[str, ...]

    admin_email: str | None
    admin_password: str | None
    admin_password_hash: str | None
    admin_notify_email: str | None
    admin_session_ttl: int
    member_session_ttl: int

    smtp_host: str | None
    smtp_port: int
    smtp_username: str | None
    smtp_password: str | None
    smtp_starttls: bool
    smtp_from: str

    demo_rate_limit: int
    demo_rate_window: int
    trust_proxy: bool

    @property
    def admin_configured(self) -> bool:
        return bool(self.admin_email and (self.admin_password or self.admin_password_hash))

    @property
    def notify_email(self) -> str | None:
        return self.admin_notify_email or self.admin_email

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host)


def load_settings() -> Settings:
    return Settings(
        database_url=os.getenv(
            "DATABASE_URL",
            "postgresql://sightline:sightline@postgres:5432/sightline",
        ),
        redis_url=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        cors_origins=_csv(
            os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:8090")
        ),
        admin_email=os.getenv("ADMIN_EMAIL") or None,
        admin_password=os.getenv("ADMIN_PASSWORD") or None,
        admin_password_hash=os.getenv("ADMIN_PASSWORD_HASH") or None,
        admin_notify_email=os.getenv("ADMIN_NOTIFY_EMAIL") or None,
        admin_session_ttl=int(os.getenv("ADMIN_SESSION_TTL", "43200")),
        member_session_ttl=int(os.getenv("MEMBER_SESSION_TTL", "604800")),
        smtp_host=os.getenv("SMTP_HOST") or None,
        smtp_port=int(os.getenv("SMTP_PORT", "587")),
        smtp_username=os.getenv("SMTP_USERNAME") or None,
        smtp_password=os.getenv("SMTP_PASSWORD") or None,
        smtp_starttls=_bool(os.getenv("SMTP_STARTTLS", "true")),
        smtp_from=os.getenv("SMTP_FROM", "Sightline <no-reply@sightline.local>"),
        demo_rate_limit=int(os.getenv("DEMO_RATE_LIMIT", "5")),
        demo_rate_window=int(os.getenv("DEMO_RATE_WINDOW", "3600")),
        trust_proxy=_bool(os.getenv("TRUST_PROXY", "true")),
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()
