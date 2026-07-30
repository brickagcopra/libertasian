"""Bearer-token auth for the synthesis endpoint.

The TTS hop is unauthenticated in prod by design: the service uses `expose`
rather than `ports`, is absent from the nginx config, and only the API can reach
it on the internal Docker network. That argument disappears the moment the
service runs on a rented GPU host, where the port is reachable off-box — hence
this dependency.

It is a no-op while `TTS_AUTH_TOKEN` is unset, so enabling it is a per-deployment
decision and the existing prod call keeps working after this deploys.
"""

import logging
import secrets

from fastapi import Header, HTTPException

from .config import settings

logger = logging.getLogger(__name__)


def auth_enabled() -> bool:
    """Whether a token is configured. Read at call time so it is testable."""
    return bool(settings.tts_auth_token.strip())


def require_tts_token(authorization: str | None = Header(default=None)) -> None:
    """Reject the request with 401 unless it carries the configured token.

    Uses `compare_digest` so a wrong token cannot be recovered byte-by-byte from
    response timing. The rejection log never echoes the presented value.
    """
    expected = settings.tts_auth_token.strip()
    if not expected:
        return

    scheme, _, presented = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not secrets.compare_digest(
        presented.strip(), expected
    ):
        logger.warning("Rejected /synthesize: missing or invalid bearer token")
        raise HTTPException(
            status_code=401,
            detail="unauthorized",
            headers={"WWW-Authenticate": "Bearer"},
        )
