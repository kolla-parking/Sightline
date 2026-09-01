"""Per-IP fixed-window rate limit for the public intake endpoints.

Fails open: if Redis is unreachable the submission is allowed — a marketing
form must not depend on Redis health.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


async def allow_request(redis, ip: str, limit: int, window_seconds: int) -> bool:
    key = f"rl:intake:{ip}"
    try:
        pipe = redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, window_seconds, nx=True)
        count, _ = await pipe.execute()
        return int(count) <= limit
    except Exception:  # noqa: BLE001 - fail open on any Redis error
        logger.warning("rate limiter unavailable; allowing request", exc_info=True)
        return True
