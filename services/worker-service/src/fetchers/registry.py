"""LIBERTASIAN Worker Service — Fetcher registry.

Maps parser_type strings (from source_endpoints.parser_type) to fetcher classes.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .congress import CongressFetcher
from .lawphil import LawphilFetcher
from .official_gazette import OfficialGazetteFetcher
from .supreme_court import SupremeCourtFetcher

if TYPE_CHECKING:
    from .base import BaseFetcher

logger = logging.getLogger(__name__)

FETCHER_REGISTRY: dict[str, type[BaseFetcher]] = {
    "supreme_court_elibrary": SupremeCourtFetcher,
    "lawphil": LawphilFetcher,
    "official_gazette": OfficialGazetteFetcher,
    "congress": CongressFetcher,
}


def get_fetcher(parser_type: str) -> BaseFetcher | None:
    """Look up and instantiate a fetcher by parser_type string.

    Returns None if no fetcher is registered for the given type.
    """
    fetcher_cls = FETCHER_REGISTRY.get(parser_type)
    if fetcher_cls is None:
        logger.error("No fetcher registered for parser_type=%s", parser_type)
        return None
    return fetcher_cls()
