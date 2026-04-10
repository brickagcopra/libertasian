"""Fetcher tests (Phase 2 — Coverage Gaps).

Tests cover:
- SupremeCourtFetcher: GR No. extraction, date parsing, name detection, listing parsing
- LawphilFetcher/OfficialGazetteFetcher/CongressFetcher: basic interface compliance
- BaseFetcher: rate limiting, client creation, retry logic
- Registry: lookup, unknown types
"""

from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest

from src.fetchers.base import (
    BaseFetcher,
    CandidateDoc,
    CloudflareBlockedError,
    FetchedContent,
    is_cloudflare_challenge,
)
from src.fetchers.congress import CongressFetcher
from src.fetchers.official_gazette import OfficialGazetteFetcher
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


class TestNormalizeGrNo:
    """Test GR No. normalization (used for <strong> tag content)."""

    def test_standard_gr_no(self):
        result = SupremeCourtFetcher._normalize_gr_no("G.R. No. 246027")
        assert result is not None
        assert "246027" in result

    def test_gr_nos_plural(self):
        result = SupremeCourtFetcher._normalize_gr_no("G.R. Nos. 263919 and 264033")
        assert result is not None
        assert "263919" in result

    def test_empty(self):
        assert SupremeCourtFetcher._normalize_gr_no("") is None

    def test_whitespace_only(self):
        assert SupremeCourtFetcher._normalize_gr_no("   ") is None


class TestExtractDocId:
    """Test document ID extraction from showdocs URLs."""

    def test_standard_url(self):
        url = "https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69834"
        assert SupremeCourtFetcher._extract_doc_id(url) == "69834"

    def test_no_match(self):
        assert SupremeCourtFetcher._extract_doc_id("https://example.com/page") is None


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


class TestSupremeCourtFetcherDiscover:
    """Test discover() with mocked HTTP responses."""

    def _make_fetcher_with_mock(self, html: str) -> tuple[SupremeCourtFetcher, list[CandidateDoc]]:
        """Helper: create fetcher, mock HTTP, run discover, return candidates."""
        fetcher = SupremeCourtFetcher()

        mock_response = MagicMock()
        mock_response.text = html
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()

        with patch.object(fetcher, "_get_client") as mock_client_ctx:
            mock_client = MagicMock()
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client_ctx.return_value = mock_client

            with patch.object(fetcher, "_fetch_with_retry", return_value=mock_response):
                candidates = fetcher.discover("http://example.com/listing")

        return fetcher, candidates

    def test_discover_parses_li_items(self):
        """Test parsing monthly listing page with <li> items (current site structure)."""
        html = """
        <html><body>
        <div id="container_title">
        <ul style='list-style:none;'>
            <li style='text-align:justify;'>
                <a href='https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69834'>
                    <STRONG>G.R. No. 246027</STRONG><br>
                    <small>SECURITIES AND EXCHANGE COMMISSION VS. 1ACCOUNTANTS PARTY-LIST</small>
                    January 28, 2025
                </a>
                <hr><br>
            </li>
            <li style='text-align:justify;'>
                <a href='https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69835'>
                    <STRONG>G.R. No. 263919</STRONG><br>
                    <small>PEOPLE OF THE PHILIPPINES VS. JOHN DOE</small>
                    January 29, 2025
                </a>
                <hr><br>
            </li>
        </ul>
        </div>
        </body></html>
        """

        _, candidates = self._make_fetcher_with_mock(html)

        assert len(candidates) == 2
        assert candidates[0].gr_no is not None
        assert "246027" in candidates[0].gr_no
        assert candidates[0].court == "Supreme Court"
        assert candidates[0].decision_date == "January 28, 2025"
        assert "showdocs/1/69834" in candidates[0].url
        assert candidates[1].decision_date == "January 29, 2025"

    def test_discover_parses_bare_anchor_tags(self):
        """Test parsing when showdocs links are bare <a> tags (no <li> wrapper).

        This matches the actual SC E-Library HTML structure as of 2025-2026,
        where decisions are rendered directly inside div#container_title
        without <li> wrapping.
        """
        html = """
        <html><body>
        <div id="container_title">
            <H3>Jan 2025 |  Decisions / Signed Resolutions</H3><HR>
            <a href='https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69834'>
                <STRONG>G.R. No. 246027</STRONG><br>
                <small>SECURITIES AND EXCHANGE COMMISSION VS. 1ACCOUNTANTS</small>
                January 28, 2025
            </a>
            <hr><br>
            <a href='https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69861'>
                <STRONG>G.R. No. 259094</STRONG><br>
                <small>RODULFO FERRAREN AQUINO VS. PEOPLE OF THE PHILIPPINES</small>
                January 28, 2025
            </a>
        </div>
        </body></html>
        """

        _, candidates = self._make_fetcher_with_mock(html)

        assert len(candidates) == 2
        assert candidates[0].gr_no is not None
        assert "246027" in candidates[0].gr_no
        assert candidates[0].court == "Supreme Court"
        assert candidates[0].decision_date == "January 28, 2025"
        assert "showdocs/1/69834" in candidates[0].url
        assert "SECURITIES" in candidates[0].title
        assert candidates[1].gr_no is not None
        assert "259094" in candidates[1].gr_no

    def test_discover_returns_empty_on_http_error(self):
        fetcher = SupremeCourtFetcher()

        with patch.object(fetcher, "_get_client") as mock_client_ctx:
            mock_client = MagicMock()
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client_ctx.return_value = mock_client

            with patch.object(
                fetcher, "_fetch_with_retry", side_effect=Exception("Connection refused"),
            ):
                candidates = fetcher.discover("http://down.example.com")

        assert candidates == []

    def test_discover_falls_back_to_link_discovery(self):
        """When no <li> items found, fall back to finding showdocs links."""
        html = """
        <html><body>
        <div>
            <a href="https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/12345">
                G.R. No. 200001 - People vs. Aquino et al. - January 2025
            </a>
            <a href="/about">About the Court</a>
        </div>
        </body></html>
        """

        _, candidates = self._make_fetcher_with_mock(html)

        gr_candidates = [c for c in candidates if c.gr_no]
        assert len(gr_candidates) >= 1
        assert gr_candidates[0].gr_no == "G.R. No. 200001"

    def test_discover_returns_empty_on_403(self):
        """HTTP 403 returns empty list (not an exception)."""
        fetcher = SupremeCourtFetcher()

        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.text = "Forbidden"

        with patch.object(fetcher, "_get_client") as mock_client_ctx:
            mock_client = MagicMock()
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client_ctx.return_value = mock_client

            with patch.object(fetcher, "_fetch_with_retry", return_value=mock_response):
                candidates = fetcher.discover("http://example.com/listing")

        assert candidates == []


class TestSupremeCourtFetcherFetchContent:
    """Test fetch_content() with mocked HTTP."""

    def test_fetch_returns_content(self):
        fetcher = SupremeCourtFetcher()

        mock_response = MagicMock()
        mock_response.text = "<html><body>Decision text</body></html>"
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "text/html; charset=utf-8"}
        mock_response.raise_for_status = MagicMock()

        with patch.object(fetcher, "_validate_url"):
            with patch.object(fetcher, "_get_client") as mock_client_ctx:
                mock_client = MagicMock()
                mock_client.__enter__ = MagicMock(return_value=mock_client)
                mock_client.__exit__ = MagicMock(return_value=False)
                mock_client_ctx.return_value = mock_client

                with patch.object(fetcher, "_fetch_with_retry", return_value=mock_response):
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


class TestBaseFetcherRetry:
    """Test _fetch_with_retry exponential backoff."""

    def test_retries_on_500(self):
        fetcher = SupremeCourtFetcher()

        mock_client = MagicMock()
        mock_response_500 = MagicMock()
        mock_response_500.status_code = 500
        mock_response_200 = MagicMock()
        mock_response_200.status_code = 200

        mock_client.get.side_effect = [mock_response_500, mock_response_200]

        with patch.object(fetcher, "_rate_limit"):
            with patch("time.sleep"):
                result = fetcher._fetch_with_retry(mock_client, "http://example.com")

        assert result.status_code == 200
        assert mock_client.get.call_count == 2

    def test_returns_immediately_on_404(self):
        fetcher = SupremeCourtFetcher()

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_client.get.return_value = mock_response

        with patch.object(fetcher, "_rate_limit"):
            result = fetcher._fetch_with_retry(mock_client, "http://example.com")

        assert result.status_code == 404
        assert mock_client.get.call_count == 1

    def test_returns_immediately_on_403(self):
        fetcher = SupremeCourtFetcher()

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_client.get.return_value = mock_response

        with patch.object(fetcher, "_rate_limit"):
            result = fetcher._fetch_with_retry(mock_client, "http://example.com")

        assert result.status_code == 403
        assert mock_client.get.call_count == 1


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


# ---- Cloudflare blocker detection ----


# A minimal Cloudflare Turnstile "managed challenge" HTML response. The
# fetcher's detector keys off the well-known phrases "Just a moment" and
# "challenge-platform"; real responses are ~30KB but only the markers matter.
CLOUDFLARE_CHALLENGE_HTML = """
<!doctype html>
<html>
<head><title>Just a moment...</title></head>
<body>
  <div id="challenge-running">Checking your browser before accessing…</div>
  <script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>
</body>
</html>
""".strip()


class TestCloudflareDetection:
    """Shared `is_cloudflare_challenge` helper."""

    def test_detects_just_a_moment_phrase(self):
        assert is_cloudflare_challenge(CLOUDFLARE_CHALLENGE_HTML) is True

    def test_detects_challenge_platform_script(self):
        html = '<script src="/cdn-cgi/challenge-platform/..."></script>'
        assert is_cloudflare_challenge(html) is True

    def test_does_not_match_ordinary_html(self):
        html = "<html><body><h1>Hello world</h1></body></html>"
        assert is_cloudflare_challenge(html) is False

    def test_empty_string(self):
        assert is_cloudflare_challenge("") is False

    def test_none_safe(self):
        assert is_cloudflare_challenge(None) is False  # type: ignore[arg-type]


class TestCloudflareBlockedErrorMetadata:
    """CloudflareBlockedError carries structured telemetry fields."""

    def test_defaults(self):
        err = CloudflareBlockedError(endpoint_url="https://example.com/")
        assert err.endpoint_url == "https://example.com/"
        assert err.status_code == 403
        assert err.cf_type == "managed_challenge"
        assert "example.com" in str(err)

    def test_custom_type(self):
        err = CloudflareBlockedError(
            endpoint_url="https://example.com/",
            status_code=503,
            cf_type="js_challenge",
        )
        assert err.status_code == 503
        assert err.cf_type == "js_challenge"


class TestOfficialGazetteCloudflareHandling:
    """OG fetcher raises CloudflareBlockedError on managed challenge 403."""

    def test_raises_on_managed_challenge(self):
        fetcher = OfficialGazetteFetcher()
        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.text = CLOUDFLARE_CHALLENGE_HTML

        mock_client = MagicMock()
        with patch.object(fetcher, "_get_client") as get_client, \
                patch.object(fetcher, "_fetch_with_retry", return_value=mock_response):
            get_client.return_value.__enter__.return_value = mock_client
            with pytest.raises(CloudflareBlockedError) as exc_info:
                fetcher.discover(
                    "https://www.officialgazette.gov.ph/section/laws/executive-issuances/",
                )

        assert exc_info.value.cf_type == "managed_challenge"
        assert exc_info.value.status_code == 403
        assert "officialgazette" in exc_info.value.endpoint_url

    def test_plain_403_returns_empty_not_raise(self):
        """Non-Cloudflare 403 (generic bot block) should not raise."""
        fetcher = OfficialGazetteFetcher()
        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.text = "<html><body>Forbidden</body></html>"

        mock_client = MagicMock()
        with patch.object(fetcher, "_get_client") as get_client, \
                patch.object(fetcher, "_fetch_with_retry", return_value=mock_response):
            get_client.return_value.__enter__.return_value = mock_client
            candidates = fetcher.discover(
                "https://www.officialgazette.gov.ph/section/laws/executive-issuances/",
            )

        assert candidates == []


class TestCongressCloudflareHandling:
    """Congress fetcher raises CloudflareBlockedError on managed challenge 403."""

    def test_raises_on_managed_challenge(self):
        fetcher = CongressFetcher()
        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.text = CLOUDFLARE_CHALLENGE_HTML

        mock_client = MagicMock()
        with patch.object(fetcher, "_get_client") as get_client, \
                patch.object(fetcher, "_fetch_with_retry", return_value=mock_response):
            get_client.return_value.__enter__.return_value = mock_client
            with pytest.raises(CloudflareBlockedError) as exc_info:
                fetcher.discover("https://www.congress.gov.ph/legisdocs/?v=ra")

        assert exc_info.value.cf_type == "managed_challenge"
        assert exc_info.value.status_code == 403
        assert "congress" in exc_info.value.endpoint_url

    def test_plain_403_returns_empty_not_raise(self):
        fetcher = CongressFetcher()
        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.text = "<html><body>Forbidden</body></html>"

        mock_client = MagicMock()
        with patch.object(fetcher, "_get_client") as get_client, \
                patch.object(fetcher, "_fetch_with_retry", return_value=mock_response):
            get_client.return_value.__enter__.return_value = mock_client
            candidates = fetcher.discover("https://www.congress.gov.ph/legisdocs/?v=ra")

        assert candidates == []
