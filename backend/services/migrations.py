"""Minimal startup migration runner.

Numbered SQL files in backend/migrations/ are applied in order, each in its
own transaction, and recorded in schema_migrations. An advisory lock guards
concurrent app starts against the same database. Files are immutable once
applied — schema changes always get a new number.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"
ADVISORY_LOCK_KEY = 727501


async def run_migrations(pool: Any, directory: Path | None = None) -> list[str]:
    """Apply unapplied migrations; return the filenames that ran."""
    directory = directory or MIGRATIONS_DIR
    applied: list[str] = []

    async with pool.acquire() as conn:
        await conn.execute("SELECT pg_advisory_lock($1)", ADVISORY_LOCK_KEY)
        try:
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            rows = await conn.fetch("SELECT version FROM schema_migrations")
            done = {row["version"] for row in rows}

            for path in sorted(directory.glob("[0-9]*.sql")):
                version = int(path.name.split("_", 1)[0])
                if version in done:
                    continue
                sql = path.read_text(encoding="utf-8")
                async with conn.transaction():
                    # No-arg execute uses the simple query protocol, so
                    # multi-statement scripts (incl. $$ bodies) run as one.
                    await conn.execute(sql)
                    await conn.execute(
                        "INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)",
                        version,
                        path.name,
                    )
                applied.append(path.name)
                logger.info("applied migration %s", path.name)
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", ADVISORY_LOCK_KEY)

    if not applied:
        logger.info("migrations up to date")
    return applied
