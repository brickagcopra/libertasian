"""Configurable fetch window for backfill ticks and daily crawls.

Default 13:00–18:00 America/New_York (= 01:00–07:00 Asia/Manila), which
is PH off-peak. Both LawPhil and SCEL throttle aggressively during PH
business hours; gating fetches to off-peak avoids 429/blocked retries
that would otherwise burn budget on backoffs.
"""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from ..config import settings


def is_in_fetch_window(now: datetime | None = None) -> bool:
    """Return True iff ``now`` falls within the configured fetch window.

    ``now`` defaults to ``datetime.now(tz=UTC)`` and is injectable so
    tests can drive the clock without monkey-patching ``datetime``.
    """
    moment = now if now is not None else datetime.now(tz=UTC)
    local = moment.astimezone(ZoneInfo(settings.backfill_fetch_window_tz))
    return (
        settings.backfill_fetch_window_hour_start
        <= local.hour
        < settings.backfill_fetch_window_hour_end
    )
