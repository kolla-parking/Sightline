"""Request models for the portal routers.

Deliberately lax email validation (regex, not EmailStr) to avoid the
email-validator dependency; select values from the marketing forms are stored
verbatim so marketing copy can change without a schema migration.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

_EMAIL_PATTERN = r"^\S+@\S+\.\S+$"


# ------------------------------------------------------------------ auth

class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=200)


# ---------------------------------------------------------------- public

class DemoRequestIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(max_length=320, pattern=_EMAIL_PATTERN)
    company: str = Field(min_length=1, max_length=200)
    lot_size: str | None = Field(default=None, max_length=200)
    cameras: str | None = Field(default=None, max_length=200)
    message: str | None = Field(default=None, max_length=5000)
    website: str | None = Field(default=None, max_length=500)  # honeypot


class ContactRequestIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(max_length=320, pattern=_EMAIL_PATTERN)
    topic: str | None = Field(default=None, max_length=200)
    message: str = Field(min_length=1, max_length=5000)
    website: str | None = Field(default=None, max_length=500)  # honeypot


# ----------------------------------------------------------------- admin

class OrgCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    contact_email: str | None = Field(default=None, max_length=320)
    notes: str | None = Field(default=None, max_length=5000)
    sites_count: int | None = Field(default=None, ge=0)
    cameras_count: int | None = Field(default=None, ge=0)
    spaces_count: int | None = Field(default=None, ge=0)


class OrgUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    contact_email: str | None = Field(default=None, max_length=320)
    notes: str | None = Field(default=None, max_length=5000)
    sites_count: int | None = Field(default=None, ge=0)
    cameras_count: int | None = Field(default=None, ge=0)
    spaces_count: int | None = Field(default=None, ge=0)


class MemberCreate(BaseModel):
    email: str = Field(max_length=320, pattern=_EMAIL_PATTERN)
    password: str = Field(min_length=8, max_length=200)
    full_name: str | None = Field(default=None, max_length=200)
    role: Literal["owner", "member"] = "member"


class MemberUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=200)
    role: Literal["owner", "member"] | None = None
    status: Literal["active", "disabled"] | None = None
    password: str | None = Field(default=None, min_length=8, max_length=200)


class PlanCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    amount_cents: int = Field(ge=0)
    interval: Literal["month", "year"] = "month"
    currency: str = Field(default="usd", max_length=8)


class PlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    amount_cents: int | None = Field(default=None, ge=0)
    active: bool | None = None


class SubscriptionCreate(BaseModel):
    plan_id: str
    status: Literal["trialing", "active"] = "active"
    current_period_end: str | None = None


class SubscriptionUpdate(BaseModel):
    plan_id: str | None = None
    status: Literal["trialing", "active", "past_due", "canceled"] | None = None


class InvoiceCreate(BaseModel):
    amount_due_cents: int = Field(ge=0)
    memo: str | None = Field(default=None, max_length=2000)
    due_at: str | None = None
    period_start: str | None = None
    period_end: str | None = None


class PaymentCreate(BaseModel):
    amount_cents: int = Field(gt=0)
    method: Literal["manual", "ach", "wire", "check", "card", "other"] = "manual"
    status: Literal["succeeded", "failed"] = "succeeded"
    invoice_id: str | None = None
    reference: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=2000)


class DemoRequestStatusUpdate(BaseModel):
    status: Literal["new", "contacted", "archived"]


class DemoConvert(BaseModel):
    """All optional: name falls back to the request's company (then name),
    contact_email to the request's email."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    contact_email: str | None = Field(default=None, max_length=320)
    plan_id: str | None = None
