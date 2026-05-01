"""OfficialGazetteFetcher parser tests — fix/corpus-broken-parsers.

Positive case exercises the executive-issuances listing layout; the
structural-change negative ensures the fetcher raises instead of
silently returning zero records when the page no longer contains any
recognisable OG permalinks.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.fetchers.base import StructuralChangeError
from src.fetchers.official_gazette import OfficialGazetteFetcher

FIXTURES = Path(__file__).parent / "fixtures"
LISTING_URL = "https://www.officialgazette.gov.ph/section/laws/executive-issuances/"


def _discover_with_html(html: str) -> list:
    fetcher = OfficialGazetteFetcher()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = html

    mock_client = MagicMock()
    with patch.object(fetcher, "_get_client") as get_client, \
            patch.object(fetcher, "_fetch_with_retry", return_value=mock_response):
        get_client.return_value.__enter__.return_value = mock_client
        return fetcher.discover(LISTING_URL)


class TestOfficialGazetteListing:
    """Positive case: real-world executive-issuances listing."""

    def test_finds_all_issuance_types(self):
        html = (FIXTURES / "official_gazette_listing.html").read_text(encoding="utf-8")
        candidates = _discover_with_html(html)

        # 4 entries × 1 anchor each = 4 candidates. Pagination link must be
        # filtered out by the /page/ exclude rule.
        assert len(candidates) == 4
        types = {c.document_type for c in candidates}
        assert types == {
            "executive_order",
            "proclamation",
            "republic_act",
            "administrative_order",
        }

    def test_extracts_dated_url(self):
        html = (FIXTURES / "official_gazette_listing.html").read_text(encoding="utf-8")
        candidates = _discover_with_html(html)

        # Date is recoverable from the WordPress dated URL even when the
        # title text doesn't include it.
        for c in candidates:
            assert c.decision_date is not None
            assert c.decision_date.startswith("2024")

    def test_pagination_link_excluded(self):
        html = (FIXTURES / "official_gazette_listing.html").read_text(encoding="utf-8")
        candidates = _discover_with_html(html)

        for c in candidates:
            assert "/page/" not in c.url


class TestOfficialGazetteStructuralChange:
    """Negative case: 200 OK with no recognisable OG anchors."""

    def test_raises_structural_change_error(self):
        html = (FIXTURES / "official_gazette_changed.html").read_text(encoding="utf-8")

        with pytest.raises(StructuralChangeError) as exc_info:
            _discover_with_html(html)

        assert exc_info.value.parser_type == "official_gazette"
        assert "officialgazette.gov.ph" in exc_info.value.endpoint_url
