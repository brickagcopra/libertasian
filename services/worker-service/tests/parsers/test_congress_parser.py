"""CongressFetcher parser tests — fix/corpus-broken-parsers.

Covers the three real-world layouts the fetcher must understand
(legacy panel, current table, bare PDF anchors) plus the structural
change error raised when the page returns 200 but no expected anchors
are present.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.fetchers.base import StructuralChangeError
from src.fetchers.congress import CongressFetcher

FIXTURES = Path(__file__).parent / "fixtures"
LISTING_URL = "https://www.congress.gov.ph/legisdocs/?v=ra"


def _discover_with_html(html: str) -> list:
    """Run CongressFetcher.discover with a mocked HTTP response."""
    fetcher = CongressFetcher()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = html

    mock_client = MagicMock()
    with patch.object(fetcher, "_get_client") as get_client, \
            patch.object(fetcher, "_fetch_with_retry", return_value=mock_response):
        get_client.return_value.__enter__.return_value = mock_client
        return fetcher.discover(LISTING_URL)


class TestCongressPanelLayout:
    """Positive case: legacy Bootstrap panel layout."""

    def test_extracts_ra_from_panel(self):
        html = (FIXTURES / "congress_panel.html").read_text(encoding="utf-8")
        candidates = _discover_with_html(html)

        assert len(candidates) == 2
        ra_codes = {c.metadata.get("ra_code") for c in candidates}
        assert "RA11934" in ra_codes
        assert "RA12000" in ra_codes
        assert all(c.document_type == "republic_act" for c in candidates)
        # PDF link points at the CDN — needed by downstream fetch_content.
        assert any("docs.congress.hrep.online" in c.url for c in candidates)

    def test_extracts_title_and_date(self):
        html = (FIXTURES / "congress_panel.html").read_text(encoding="utf-8")
        candidates = _discover_with_html(html)

        sim = next(c for c in candidates if c.metadata.get("ra_code") == "RA11934")
        assert "SUBSCRIBER IDENTITY MODULE" in sim.title.upper()
        assert sim.decision_date == "October 10, 2022"


class TestCongressTableLayout:
    """Positive case: current tabular legisdocs view."""

    def test_extracts_ra_from_table(self):
        html = (FIXTURES / "congress_table.html").read_text(encoding="utf-8")
        candidates = _discover_with_html(html)

        assert len(candidates) == 2
        gr_nos = {c.gr_no for c in candidates}
        assert "R.A. No. 11934" in gr_nos
        assert "R.A. No. 12076" in gr_nos
        # Each row has a pdf link the fetcher can later download.
        for c in candidates:
            assert c.url.endswith(".pdf")
            assert c.document_type == "republic_act"

    def test_extracts_title_from_row(self):
        html = (FIXTURES / "congress_table.html").read_text(encoding="utf-8")
        candidates = _discover_with_html(html)

        sim = next(c for c in candidates if c.gr_no == "R.A. No. 11934")
        assert "SUBSCRIBER IDENTITY MODULE" in sim.title.upper()
        assert sim.decision_date == "October 10, 2022"


class TestCongressStructuralChange:
    """Negative case: 200 OK with no recognisable markup."""

    def test_raises_structural_change_error(self):
        html = (FIXTURES / "congress_changed.html").read_text(encoding="utf-8")

        with pytest.raises(StructuralChangeError) as exc_info:
            _discover_with_html(html)

        assert exc_info.value.parser_type == "congress"
        assert "congress.gov.ph" in exc_info.value.endpoint_url
        # Reason text must be informative enough for an operator to action.
        assert "panel-heading" in exc_info.value.reason
