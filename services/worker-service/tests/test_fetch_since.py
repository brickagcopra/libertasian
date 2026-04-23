"""Tests for BaseFetcher.fetch_since — the PR2 incremental-crawl entry point.

Covers the four behavioral rules from the docstring:

1. cursor is None → return all, cursor advances to newest.
2. cursor found in listing → return only items above cursor, cursor advances.
3. cursor NOT found → return everything as a safe fallback, cursor advances.
4. listing is empty → return empty, cursor does NOT advance.

Plus a cursor-advance-only-on-success test: if discover() raises, fetch_since
re-raises without swallowing the exception. The crawl-task wrapper is what
holds the cursor on error; BaseFetcher itself must surface the failure.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.fetchers.base import BaseFetcher, CandidateDoc, FetchedContent


class _CannedFetcher(BaseFetcher):
    """Minimal concrete fetcher whose discover() returns a pre-set list."""

    def __init__(self, candidates: list[CandidateDoc] | Exception):
        # BaseFetcher has no __init__ we need, but httpx client setup does.
        # Skip parent setup and inject what we need directly.
        self._canned = candidates

    def discover(self, endpoint_url: str, last_fetched_at: str | None = None):
        if isinstance(self._canned, Exception):
            raise self._canned
        return list(self._canned)

    def fetch_content(self, url: str) -> FetchedContent:
        raise NotImplementedError("not needed for fetch_since tests")


def _cand(url: str, gr: str | None = None) -> CandidateDoc:
    return CandidateDoc(
        url=url,
        title=f"Decision at {url}",
        gr_no=gr,
        document_type="decision",
        decision_date="2026-04-23",
    )


class TestFetchSinceCursorNone:
    """Rule 1: first-ever run → take everything, advance to newest."""

    def test_returns_all_candidates_and_sets_cursor_to_newest(self):
        candidates = [
            _cand("https://x/d/3", "G.R. No. 3"),
            _cand("https://x/d/2", "G.R. No. 2"),
            _cand("https://x/d/1", "G.R. No. 1"),
        ]
        fetcher = _CannedFetcher(candidates)

        new_candidates, new_cursor = fetcher.fetch_since("https://x/", None)

        assert len(new_candidates) == 3
        assert new_cursor == "https://x/d/3"

    def test_no_candidates_and_no_cursor_returns_none_cursor(self):
        fetcher = _CannedFetcher([])

        new_candidates, new_cursor = fetcher.fetch_since("https://x/", None)

        assert new_candidates == []
        assert new_cursor is None


class TestFetchSinceCursorFound:
    """Rule 2: cursor URL appears in listing → return only items above it."""

    def test_returns_only_newer_candidates(self):
        candidates = [
            _cand("https://x/d/5", "G.R. No. 5"),
            _cand("https://x/d/4", "G.R. No. 4"),
            _cand("https://x/d/3", "G.R. No. 3"),  # cursor
            _cand("https://x/d/2", "G.R. No. 2"),
            _cand("https://x/d/1", "G.R. No. 1"),
        ]
        fetcher = _CannedFetcher(candidates)

        new_candidates, new_cursor = fetcher.fetch_since(
            "https://x/", "https://x/d/3",
        )

        urls = [c.url for c in new_candidates]
        assert urls == ["https://x/d/5", "https://x/d/4"]
        assert new_cursor == "https://x/d/5"

    def test_cursor_at_top_is_a_noop_and_preserves_cursor(self):
        candidates = [
            _cand("https://x/d/3", "G.R. No. 3"),  # cursor
            _cand("https://x/d/2", "G.R. No. 2"),
            _cand("https://x/d/1", "G.R. No. 1"),
        ]
        fetcher = _CannedFetcher(candidates)

        new_candidates, new_cursor = fetcher.fetch_since(
            "https://x/", "https://x/d/3",
        )

        assert new_candidates == []
        # nothing new → cursor does not move from "https://x/d/3"
        assert new_cursor == "https://x/d/3"


class TestFetchSinceCursorNotFound:
    """Rule 3: cursor fell off the listing → conservative full-fetch."""

    def test_returns_all_candidates_when_cursor_missing(self):
        candidates = [
            _cand("https://x/d/99", "G.R. No. 99"),
            _cand("https://x/d/98", "G.R. No. 98"),
            _cand("https://x/d/97", "G.R. No. 97"),
        ]
        fetcher = _CannedFetcher(candidates)

        new_candidates, new_cursor = fetcher.fetch_since(
            "https://x/", "https://x/d/50",
        )

        # cursor 50 is not in the current listing — safer to re-process
        # everything than to risk skipping decisions.
        assert len(new_candidates) == 3
        assert new_cursor == "https://x/d/99"


class TestFetchSinceEmptyListing:
    """Rule 4: empty listing → return empty, cursor unchanged."""

    def test_empty_listing_with_existing_cursor_holds_cursor(self):
        fetcher = _CannedFetcher([])

        new_candidates, new_cursor = fetcher.fetch_since(
            "https://x/", "https://x/d/42",
        )

        assert new_candidates == []
        # Critical: cursor must not advance when the source returned nothing —
        # a transient outage must not cause future decisions to be skipped.
        assert new_cursor == "https://x/d/42"


class TestFetchSinceDiscoverFails:
    """fetch_since propagates discover() exceptions so caller holds cursor."""

    def test_discover_exception_propagates(self):
        fetcher = _CannedFetcher(RuntimeError("upstream 503"))

        with pytest.raises(RuntimeError, match="upstream 503"):
            fetcher.fetch_since("https://x/", "https://x/d/42")
