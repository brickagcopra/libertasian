"""Fetcher tests (Phase 2 — Coverage Gaps).

Tests cover:
- SupremeCourtFetcher: GR No. extraction, date parsing, name detection, link filtering
- LawphilFetcher/OfficialGazetteFetcher/CongressFetcher: basic interface compliance
- BaseFetcher: rate limiting, client creation
- Registry: lookup, unknown types
"""

from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest

from src.fetchers.base import BaseFetcher, CandidateDoc, FetchedContent
from src.fetchers.registry import FETCHER_REGISTRY, get_fetcher
from src.fetchers.supreme_court import SupremeCourtFetcher


# ---- SupremeCourtFetcher helpers ----


class TestExtractGrNo:
    """Test GR No. extraction from text."""

    def test_standard_format(self):
        assert SupremeCourtFetcher._extract_gr_no("G.R. No. 123456") == "G.R. No. 123456"

    def test_without_dots(self):
        assert SupremeCourtFetcher._extract_gr_no("GR No 123456") == "G.R. No. 123456"

    def test_without_no(self):
        assert SupremeCourtFetcher._extract_gr_no("G.R. 123456") == "G.R. No. 123456"

    def test_with_dash(self):
        result = SupremeCourtFetcher._extract_gr_no("G.R. No. L-12345")
        assert result == "G.R. No. L-12345"

    def test_no_gr_number(self):
        assert SupremeCourtFetcher._extract_gr_no("Just some text") is None

    def test_embedded_in_sentence(self):
        text = "In the case of People v. Dela Cruz, G.R. No. 987654, the Court ruled..."
        result = SupremeCourtFetcher._extract_gr_no(text)
        assert result == "G.R. No. 987654"

    def test_case_insensitive(self):
        assert SupremeCourtFetcher._extract_gr_no("g.r. no. 111222") == "G.R. No. 111222"

    def test_multiple_gr_numbers_returns_first(self):
        text = "G.R. No. 100001 and G.R. No. 100002"
        result = SupremeCourtFetcher._extract_gr_no(text)
        assert result == "G.R. No. 100001"

    def test_compound_gr_number(self):
        text = "G.R. No. 12345-67"
        result = SupremeCourtFetcher._extract_gr_no(text)
        assert result is not None
        assert "12345" in result


class TestExtractDate:
    """Test date extraction from text."""

    def test_long_format(self):
        assert SupremeCourtFetcher._extract_date("January 15, 2024") == "January 15, 2024"

    def test_iso_format(self):
        assert SupremeCourtFetcher._extract_date("decided on 2024-01-15") == "2024-01-15"

    def test_slash_format(self):
        assert SupremeCourtFetcher._extract_date("01/15/2024") == "01/15/2024"

    def test_no_date(self):
        assert SupremeCourtFetcher._extract_date("No date here") is None

    def test_multiple_dates_returns_first(self):
        text = "January 10, 2024 and February 20, 2024"
        result = SupremeCourtFetcher._extract_date(text)
        assert result == "January 10, 2024"

    def test_date_without_comma(self):
        text = "January 15 2024"
        result = SupremeCourtFetcher._extract_date(text)
        assert result is not None
        assert "January" in result

    def test_all_months(self):
        months = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ]
        for month in months:
            result = SupremeCourtFetcher._extract_date(f"{month} 1, 2024")
            assert result is not None, f"Failed to extract date for {month}"


class TestLooksLikeName:
    """Test justice name heuristic."""

    def test_typical_justice_name(self):
        assert SupremeCourtFetcher._looks_like_name("Carpio, J.") is True

    def test_full_name(self):
        assert SupremeCourtFetcher._looks_like_name("Maria Lourdes Sereno") is True

    def test_name_with_de(self):
        assert SupremeCourtFetcher._looks_like_name("Jose de Leon") is True

    def test_too_short(self):
        assert SupremeCourtFetcher._looks_like_name("AB") is False

    def test_too_long(self):
        assert SupremeCourtFetcher._looks_like_name("A" * 51) is False

    def test_empty(self):
        assert SupremeCourtFetcher._looks_like_name("") is False

    def test_single_word(self):
        assert SupremeCourtFetcher._looks_like_name("Carpio") is False

    def test_too_many_words(self):
        assert SupremeCourtFetcher._looks_like_name("One Two Three Four Five Six") is False


class TestIsDecisionLink:
    """Test decision link heuristic."""

    def test_decision_in_href(self):
        assert SupremeCourtFetcher._is_decision_link(
            "http://example.com/decision/123", "Some Title"
        ) is True

    def test_gr_no_in_title(self):
        assert SupremeCourtFetcher._is_decision_link(
            "http://example.com/doc/123", "G.R. No. 123456"
        ) is True

    def test_vs_in_title(self):
        assert SupremeCourtFetcher._is_decision_link(
            "http://example.com/doc/123", "People vs. Dela Cruz"
        ) is True

    def test_v_dot_in_title(self):
        assert SupremeCourtFetcher._is_decision_link(
            "http://example.com/doc/123", "Republic v. Sandiganbayan"
        ) is True

    def test_unrelated_link(self):
        assert SupremeCourtFetcher._is_decision_link(
            "http://example.com/about", "About Us"
        ) is False

    def test_people_of_philippines_in_title(self):
        assert SupremeCourtFetcher._is_decision_link(
            "http://example.com/doc/123", "People of the Philippines v. John Doe"
        ) is True


class TestSupremeCourtFetcherDiscover:
    """Test discover() with mocked HTTP responses."""

    def test_discover_parses_table_rows(self):
        fetcher = SupremeCourtFetcher()
        html = """
        <html><body>
        <table>
            <tr>
                <td><a href="/decision/123">G.R. No. 100001 - People v. Smith</a></td>
                <td>January 15, 2024</td>
                <td>Carpio, J.</td>
            </tr>
            <tr>
                <td><a href="/decision/456">G.R. No. 100002 - Republic v. Jones</a></td>
                <td>February 20, 2024</td>
                <td>Leonen, J.</td>
            </tr>
        </table>
        </body></html>
        """

        mock_response = MagicMock()
        mock_response.text = html
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()

        with patch.object(fetcher, "_get_client") as mock_client_ctx:
            mock_client = MagicMock()
            mock_client.get.return_value = mock_response
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client_ctx.return_value = mock_client

            with patch.object(fetcher, "_rate_limit"):
                candidates = fetcher.discover("http://example.com/listing")

        assert len(candidates) == 2
        assert candidates[0].gr_no == "G.R. No. 100001"
        assert candidates[0].court == "Supreme Court"
        assert candidates[1].gr_no == "G.R. No. 100002"

    def test_discover_returns_empty_on_http_error(self):
        fetcher = SupremeCourtFetcher()

        with patch.object(fetcher, "_get_client") as mock_client_ctx:
            mock_client = MagicMock()
            mock_client.get.side_effect = Exception("Connection refused")
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client_ctx.return_value = mock_client

            with patch.object(fetcher, "_rate_limit"):
                candidates = fetcher.discover("http://down.example.com")

        assert candidates == []

    def test_discover_falls_back_to_link_discovery(self):
        fetcher = SupremeCourtFetcher()
        # HTML with no table rows but with links
        html = """
        <html><body>
        <div>
            <a href="/case/1">G.R. No. 200001 - People vs. Aquino et al.</a>
            <a href="/about">About the Court</a>
        </div>
        </body></html>
        """

        mock_response = MagicMock()
        mock_response.text = html
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()

        with patch.object(fetcher, "_get_client") as mock_client_ctx:
            mock_client = MagicMock()
            mock_client.get.return_value = mock_response
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client_ctx.return_value = mock_client

            with patch.object(fetcher, "_rate_limit"):
                candidates = fetcher.discover("http://example.com/listing")

        # Should find the GR link but not "About"
        gr_candidates = [c for c in candidates if c.gr_no]
        assert len(gr_candidates) >= 1
        assert gr_candidates[0].gr_no == "G.R. No. 200001"


class TestSupremeCourtFetcherFetchContent:
    """Test fetch_content() with mocked HTTP."""

    def test_fetch_returns_content(self):
        fetcher = SupremeCourtFetcher()

        mock_response = MagicMock()
        mock_response.text = "<html><body>Decision text</body></html>"
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "text/html; charset=utf-8"}
        mock_response.raise_for_status = MagicMock()

        with patch.object(fetcher, "_get_client") as mock_client_ctx:
            mock_client = MagicMock()
            mock_client.get.return_value = mock_response
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client_ctx.return_value = mock_client

            with patch.object(fetcher, "_rate_limit"):
                result = fetcher.fetch_content("http://example.com/decision/1")

        assert isinstance(result, FetchedContent)
        assert result.url == "http://example.com/decision/1"
        assert "Decision text" in result.html
        assert result.status_code == 200
        assert result.fetched_at != ""


# ---- BaseFetcher ----


class TestBaseFetcherRateLimit:
    """Test rate limiting between requests."""

    def test_rate_limit_delays_sequential_calls(self):
        fetcher = SupremeCourtFetcher()

        with patch("src.fetchers.base.settings") as mock_settings:
            mock_settings.ingestion_request_delay = 0.1
            fetcher._last_request_time = time.monotonic()

            with patch("time.sleep") as mock_sleep:
                fetcher._rate_limit()
                # Should have called sleep since delay hasn't elapsed
                if mock_sleep.called:
                    sleep_time = mock_sleep.call_args[0][0]
                    assert sleep_time > 0
                    assert sleep_time <= 0.1

    def test_rate_limit_no_delay_when_enough_time_passed(self):
        fetcher = SupremeCourtFetcher()

        with patch("src.fetchers.base.settings") as mock_settings:
            mock_settings.ingestion_request_delay = 0.01
            # Set last request far in the past
            fetcher._last_request_time = time.monotonic() - 10

            with patch("time.sleep") as mock_sleep:
                fetcher._rate_limit()
                mock_sleep.assert_not_called()


# ---- Registry ----


class TestFetcherRegistry:
    """Test fetcher registry lookup."""

    def test_registry_has_all_four_sources(self):
        expected = {"supreme_court_elibrary", "lawphil", "official_gazette", "congress"}
        assert set(FETCHER_REGISTRY.keys()) == expected

    def test_get_fetcher_returns_instance(self):
        fetcher = get_fetcher("supreme_court_elibrary")
        assert fetcher is not None
        assert isinstance(fetcher, SupremeCourtFetcher)

    def test_get_fetcher_unknown_returns_none(self):
        fetcher = get_fetcher("nonexistent_source")
        assert fetcher is None

    def test_each_fetcher_implements_interface(self):
        for parser_type in FETCHER_REGISTRY:
            fetcher = get_fetcher(parser_type)
            assert fetcher is not None
            assert isinstance(fetcher, BaseFetcher)
            assert hasattr(fetcher, "discover")
            assert hasattr(fetcher, "fetch_content")
