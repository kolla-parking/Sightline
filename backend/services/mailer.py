"""Outbox-first email.

Every message starts life as an email_outbox row: 'pending' when SMTP is
configured, 'captured' when it isn't (the portal shows captured mail in its
notifications feed, so the flow is demo-able with zero credentials).
Delivery is post-commit and best-effort — it never raises to the caller.

Transport is stdlib smtplib run in a thread; volume is a handful of admin
notifications, so an async SMTP dependency buys nothing.
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage
from typing import TYPE_CHECKING, Any

from backend.config import Settings

if TYPE_CHECKING:
    from backend.services.portal_db import PortalDB

logger = logging.getLogger(__name__)


def render_demo_request_admin(row: dict[str, Any]) -> tuple[str, str]:
    subject = f"New demo request: {row.get('company') or row['name']}"
    body = (
        "A new demo request just came in on the marketing site.\n"
        "\n"
        f"Name:     {row['name']}\n"
        f"Email:    {row['email']}\n"
        f"Company:  {row.get('company') or '-'}\n"
        f"Lot size: {row.get('lot_size') or '-'}\n"
        f"Cameras:  {row.get('cameras') or '-'}\n"
        "\n"
        f"Message:\n{row.get('message') or '(none)'}\n"
        "\n"
        "Review it in the admin portal under Demo requests.\n"
    )
    return subject, body


def render_contact_request_admin(row: dict[str, Any]) -> tuple[str, str]:
    subject = f"New contact message: {row.get('topic') or 'General'}"
    body = (
        "A new contact message just came in on the marketing site.\n"
        "\n"
        f"Name:  {row['name']}\n"
        f"Email: {row['email']}\n"
        f"Topic: {row.get('topic') or '-'}\n"
        "\n"
        f"Message:\n{row.get('message') or '(none)'}\n"
        "\n"
        "Review it in the admin portal under Demo requests.\n"
    )
    return subject, body


def render_access_revoked(member_name: str | None, org_name: str) -> tuple[str, str]:
    subject = f"Your Sightline access for {org_name} has been revoked"
    greeting = f"Hi {member_name}," if member_name else "Hi,"
    body = (
        f"{greeting}\n"
        "\n"
        f"Access to the Sightline workspace for {org_name} has been revoked and\n"
        "your active sessions have been signed out. You will no longer be able\n"
        "to log in to the dashboard.\n"
        "\n"
        "If you believe this is a mistake, please contact your administrator.\n"
        "\n"
        "— Sightline\n"
    )
    return subject, body


def render_payment_receipt(
    org: dict[str, Any], payment: dict[str, Any], invoice: dict[str, Any] | None
) -> tuple[str, str]:
    amount = payment["amount_cents"] / 100
    subject = f"Sightline payment received: ${amount:,.2f}"
    invoice_line = f"Invoice:  {invoice['number']}\n" if invoice else ""
    body = (
        f"We recorded a payment for {org['name']}.\n"
        "\n"
        f"Amount:   ${amount:,.2f} {payment.get('currency', 'usd').upper()}\n"
        f"Method:   {payment.get('method', 'manual')}\n"
        f"{invoice_line}"
        "\n"
        "Thank you.\n"
        "— Sightline\n"
    )
    return subject, body


class Mailer:
    def __init__(self, settings: Settings, portal_db: "PortalDB") -> None:
        self._settings = settings
        self._portal_db = portal_db

    @property
    def configured(self) -> bool:
        return self._settings.smtp_configured

    async def queue(
        self,
        *,
        to_email: str,
        subject: str,
        body_text: str,
        template: str,
        to_name: str | None = None,
        org_id: str | None = None,
        conn: Any = None,
    ) -> int:
        """Write an outbox row (inside the caller's transaction when conn is
        given) and return its id. Does not attempt delivery."""
        status = "pending" if self.configured else "captured"
        return await self._portal_db.insert_outbox(
            to_email=to_email,
            to_name=to_name,
            subject=subject,
            body_text=body_text,
            template=template,
            org_id=org_id,
            status=status,
            conn=conn,
        )

    def _smtp_send(self, to_email: str, to_name: str | None, subject: str, body: str) -> None:
        settings = self._settings
        message = EmailMessage()
        message["From"] = settings.smtp_from
        message["To"] = f"{to_name} <{to_email}>" if to_name else to_email
        message["Subject"] = subject
        message.set_content(body)

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            if settings.smtp_starttls:
                smtp.starttls()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password or "")
            smtp.send_message(message)

    async def deliver(self, outbox_ids: list[int]) -> None:
        """Best-effort delivery of pending rows. Never raises."""
        for outbox_id in outbox_ids:
            try:
                row = await self._portal_db.get_outbox(outbox_id)
                if row is None or row["status"] != "pending":
                    continue
                await self._portal_db.bump_outbox_attempt(outbox_id)
                await asyncio.to_thread(
                    self._smtp_send,
                    row["to_email"],
                    row.get("to_name"),
                    row["subject"],
                    row["body_text"],
                )
                await self._portal_db.mark_outbox(outbox_id, "sent")
            except Exception as exc:  # noqa: BLE001 - delivery is best-effort
                logger.warning("email delivery failed for outbox row %s: %s", outbox_id, exc)
                try:
                    await self._portal_db.mark_outbox(outbox_id, "failed", error=str(exc))
                except Exception:  # noqa: BLE001
                    logger.exception("could not mark outbox row %s failed", outbox_id)
