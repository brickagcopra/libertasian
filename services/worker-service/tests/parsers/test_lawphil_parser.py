"""LawphilFetcher parser tests — fix/corpus-broken-parsers.

Covers the new ``{YEAR}`` URL template (current_year + current_year-1
crawl) and the structural-change error for 200 OK pages with no
recognisable LawPhil markup. The pre-existing s-menu / case-anchor paths
are still covered by tests/test_fetchers.py.
"""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.fetchers.base import StructuralChangeError
from src.fetchers.lawphil import YEAR_PLACEHOLDER, LawphilFetcher

FIXTURES = Path(__file__).parent / "fixtures"


def _make_response(html: str, status: int = 200) -> MagicMock:
    """Build a mock httpx.Response with windows-1252 encoded content."""
    response = MagicMock()
    response.status_code = status
    response.content = html.encode("windows-1252")
    return response


class TestLawphilYearTemplate:
    """``{YEAR}`` resolution: current year + current_year-1, newest first."""

    def test_template_url_resolves_both_years(self):
        """Both calendar years are crawled; the template never reaches network."""
        fetcher = LawphilFetcher()
        year_index_html = (FIXTURES / "lawphil_year_index.html").read_text(encoding="utf-8")
        # Each call after the year-index returns a 404-ish empty page so the
        # crawler doesn't actually try to walk into monthly pages — we only
        # want to assert the URLs we actually fetched.
        empty_resp = _make_response("<html></html>")

        fetched_urls: list[str] = []

        def _fetch(_client, url: str):
            fetched_urls.append(url)
            if url.endswith("juri.html") or url.endswith("/juri.html"):
                return empty_resp
            if "juri" in url and url.endswith(".html") and "/jan" not in url:
                return _make_response(year_index_html)
            return empty_resp

        mock_client = MagicMock()
        with patch.object(fetcher, "_get_client") as get_client, \
                patch.object(fetcher, "_fetch_with_retry", side_effect=_fetch):
            get_client.return_value.__enter__.return_value = mock_client
            template = "https://lawphil.net/judjuris/juri{YEAR}/juri{YEAR}.html"
            # Acceptable for either year to raise — what we care about is
            # that the template was expanded into BOTH years before the
            # error fired (asserted via fetched_urls below).
            with contextlib.suppress(StructuralChangeError):
                fetcher.discover(template)

        current_year = datetime.now(UTC).year
        assert any(f"juri{current_year}" in u for u in fetched_urls), (
            f"Expected current year {current_year} to be fetched, got {fetched_urls}"
        )
        assert any(f"juri{current_year - 1}" in u for u in fetched_urls), (
            f"Expected prior year {current_year - 1} to be fetched, got {fetched_urls}"
        )
        # And NO URL still contains the unresolved placeholder.
        assert all(YEAR_PLACEHOLDER not in u for u in fetched_urls)

    def test_concrete_year_url_bypasses_template(self):
        """Backfill jobs that pin a specific year URL must not double-crawl."""
        fetcher = LawphilFetcher()
        year_index_html = (FIXTURES / "lawphil_year_index.html").read_text(encoding="utf-8")

        fetched_urls: list[str] = []

        def _fetch(_client, url: str):
            fetched_urls.append(url)
            return _make_response(year_index_html)

        mock_client = MagicMock()
        with patch.object(fetcher, "_get_client") as get_client, \
                patch.object(fetcher, "_fetch_with_retry", side_effect=_fetch):
            get_client.return_value.__enter__.return_value = mock_client
            # Year-index without followable monthly fetches can still
            # raise StructuralChangeError; the assertion we care about
            # (no template expansion happened) is below.
            with contextlib.suppress(StructuralChangeError):
                fetcher.discover("https://lawphil.net/judjuris/juri2024/juri2024.html")

        years_seen = {u for u in fetched_urls if "juri2025" in u or "juri2026" in u}
        assert years_seen == set(), (
            f"Concrete-year URL should not trigger template expansion. Saw: {fetched_urls}"
        )


class TestLawphilStructuralChange:
    """Negative case: 200 OK page with no LawPhil-shaped markup."""

    def test_raises_when_no_recognisable_markup(self):
        fetcher = LawphilFetcher()
        html = (FIXTURES / "lawphil_year_changed.html").read_text(encoding="utf-8")

        mock_client = MagicMock()
        with patch.object(fetcher, "_get_client") as get_client, \
                patch.object(fetcher, "_fetch_with_retry", return_value=_make_response(html)):
            get_client.return_value.__enter__.return_value = mock_client
            with pytest.raises(StructuralChangeError) as exc_info:
                fetcher.discover("https://lawphil.net/judjuris/juri2099/juri2099.html")

        assert exc_info.value.parser_type == "lawphil"
        assert "lawphil.net" in exc_info.value.endpoint_url

    def test_template_raises_when_both_years_have_no_markup(self):
        """If BOTH years served the empty page, the error must propagate."""
        fetcher = LawphilFetcher()
        empty_html = (FIXTURES / "lawphil_year_changed.html").read_text(encoding="utf-8")

        mock_client = MagicMock()
        with patch.object(fetcher, "_get_client") as get_client, \
                patch.object(
                    fetcher, "_fetch_with_retry",
                    return_value=_make_response(empty_html),
                ):
            get_client.return_value.__enter__.return_value = mock_client
            with pytest.raises(StructuralChangeError):
                fetcher.discover(
                    "https://lawphil.net/judjuris/juri{YEAR}/juri{YEAR}.html",
                )
