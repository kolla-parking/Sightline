"""Password hashing. bcrypt at cost 12 takes ~250ms, so both operations run
in a thread to keep the event loop (which also serves MJPEG streams) free."""
from __future__ import annotations

import asyncio

import bcrypt


async def hash_password(plain: str) -> str:
    def _hash() -> str:
        return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("ascii")

    return await asyncio.to_thread(_hash)


async def verify_password(plain: str, hashed: str) -> bool:
    def _verify() -> bool:
        try:
            return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("ascii"))
        except ValueError:
            return False

    return await asyncio.to_thread(_verify)
