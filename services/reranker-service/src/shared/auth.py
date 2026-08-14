"""Internal API key authentication for service-to-service calls."""

from __future__ import annotations

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

from ..config import settings

_api_key_header = APIKeyHeader(name="X-Internal-Api-Key", auto_error=False)


async def verify_internal_key(key: str | None = Security(_api_key_header)) -> str:
    """Verify the internal API key. Skip auth if no key is configured (dev mode)."""
    if not settings.internal_api_key:
        return "no-auth"
    if not key or key != settings.internal_api_key:
        raise HTTPException(status_code=403, detail="Forbidden")
    return key
