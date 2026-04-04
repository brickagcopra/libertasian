"""Async Redis client for caching search results and pipeline data."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from ..config import settings

logger = logging.getLogger(__name__)

# Uses redis.asyncio when available. Caching is best-effort — failures are swallowed.
_redis_url: str = settings.redis_url


def _cache_key(prefix: str, data: str) -> str:
    """Generate a deterministic cache key from prefix and data."""
    digest = hashlib.sha256(data.encode()).hexdigest()[:16]
    return f"cache:{prefix}:{digest}"


async def get_redis() -> _RedisLite:
    """Return a lightweight Redis accessor."""
    return _RedisLite(_redis_url)


async def close_redis() -> None:
    """No-op — each operation creates its own client. Exists for interface parity."""


class _RedisLite:
    """Lightweight async Redis wrapper using redis.asyncio.

    Caching is best-effort — failures are logged and swallowed.
    """

    def __init__(self, url: str) -> None:
        self._url = url

    async def get_cached(self, prefix: str, key_data: str) -> dict[str, Any] | None:
        """Retrieve a cached JSON value. Returns None on miss or error."""
        # MVP: caching is opt-in when Redis is reachable
        try:
            import redis.asyncio as aioredis  # type: ignore[import-untyped]

            client = aioredis.from_url(self._url)
            key = _cache_key(prefix, key_data)
            raw = await client.get(key)
            await client.aclose()
            if raw is not None:
                result: dict[str, Any] = json.loads(raw)
                return result
        except Exception:
            logger.debug("Redis cache miss/error for %s", prefix)
        return None

    async def set_cached(
        self,
        prefix: str,
        key_data: str,
        value: dict[str, Any],
        ttl_seconds: int = 300,
    ) -> None:
        """Store a JSON value in cache with TTL. Failures are swallowed."""
        try:
            import redis.asyncio as aioredis  # type: ignore[import-untyped]

            client = aioredis.from_url(self._url)
            key = _cache_key(prefix, key_data)
            await client.setex(key, ttl_seconds, json.dumps(value))
            await client.aclose()
        except Exception:
            logger.debug("Redis cache set failed for %s", prefix)
