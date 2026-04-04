"""Tests for src.shared.formatting — passage formatting utilities."""

from __future__ import annotations

import pytest

from src.shared.formatting import (
    format_multi_doc_passages,
    format_passages,
    format_passages_compact,
)


class TestFormatPassages:
    """format_passages — full metadata format with source anchors."""

    def test_empty_list(self):
        result = format_passages([])
        assert "No source passages" in result

    def test_single_minimal_passage(self, make_passage):
        p = make_passage(
            document_id="doc-001",
            title="Test Title",
            text="Passage content here.",
            citation_text="",
            court="",
            decision_date="",
            section_id=None,
        )
        result = format_passages([p])
        assert "[SOURCE doc-001]" in result
        assert "Test Title" in result
        assert "Passage content here." in result

    def test_full_metadata(self, make_passage):
        p = make_passage(
            document_id="doc-002",
            title="People v. Santos",
            citation_text="G.R. No. 123456",
            court="Supreme Court",
            decision_date="2024-01-15",
            text="The court held that...",
        )
        result = format_passages([p])
        assert "[SOURCE doc-002]" in result
        assert "People v. Santos" in result
        assert "G.R. No. 123456" in result
        assert "Supreme Court" in result
        assert "2024-01-15" in result

    def test_multiple_passages_have_separator(self, make_passage):
        passages = [
            make_passage(document_id=f"doc-{i}", text=f"Text {i}.")
            for i in range(3)
        ]
        result = format_passages(passages)
        assert result.count("---") >= 2

    def test_section_id_format(self, make_passage):
        p = make_passage(
            document_id="doc-003",
            section_id="sec-abc",
            text="Section text.",
        )
        result = format_passages([p])
        assert "§sec-abc" in result

    def test_passage_text_included(self, make_passage):
        p = make_passage(text="The petitioner argues that the contract was void ab initio.")
        result = format_passages([p])
        assert "void ab initio" in result


class TestFormatPassagesCompact:
    """format_passages_compact — token-efficient format without metadata."""

    def test_empty_list(self):
        result = format_passages_compact([])
        assert "No source passages" in result

    def test_single_passage(self, make_passage):
        p = make_passage(document_id="doc-010", text="Compact text here.")
        result = format_passages_compact([p])
        assert "doc-010" in result
        assert "Compact text here." in result

    def test_multiple_passages(self, make_passage):
        passages = [make_passage(text=f"Text {i}.") for i in range(3)]
        result = format_passages_compact(passages)
        assert "---" in result

    def test_section_id_in_compact(self, make_passage):
        p = make_passage(document_id="doc-011", section_id="sec-x", text="Content.")
        result = format_passages_compact([p])
        assert "§sec-x" in result

    def test_compact_is_shorter_than_full(self, make_passage):
        passages = [
            make_passage(
                citation_text="G.R. No. 999",
                court="Supreme Court",
                decision_date="2024-06-01",
                text=f"Content {i}.",
            )
            for i in range(5)
        ]
        full = format_passages(passages)
        compact = format_passages_compact(passages)
        assert len(compact) < len(full)


class TestFormatMultiDocPassages:
    """format_multi_doc_passages — grouped format for multi-document prompts."""

    def test_empty_dict(self):
        result = format_multi_doc_passages({})
        assert "No documents available" in result

    def test_custom_empty_message(self):
        result = format_multi_doc_passages({}, empty_message="Nothing here.")
        assert result == "Nothing here."

    def test_single_document(self, make_passage):
        p = make_passage(
            document_id="doc-A",
            title="Case A",
            citation_text="G.R. No. 111",
            text="Facts of case A.",
        )
        result = format_multi_doc_passages({"doc-A": [p]})
        assert "DOCUMENT doc-A" in result
        assert "Case A" in result
        assert "Facts of case A." in result

    def test_multi_document(self, make_passage):
        p1 = make_passage(document_id="doc-A", title="Case A", text="Text A.")
        p2 = make_passage(document_id="doc-B", title="Case B", text="Text B.")
        result = format_multi_doc_passages({"doc-A": [p1], "doc-B": [p2]})
        assert "DOCUMENT doc-A" in result
        assert "DOCUMENT doc-B" in result
        assert "Text A." in result
        assert "Text B." in result

    def test_multiple_passages_per_doc(self, make_passage):
        passages = [
            make_passage(document_id="doc-X", section_id=f"sec-{i}", text=f"Para {i}.")
            for i in range(3)
        ]
        result = format_multi_doc_passages({"doc-X": passages})
        assert "Para 0." in result
        assert "Para 1." in result
        assert "Para 2." in result

    def test_empty_passages_for_one_doc(self, make_passage):
        p1 = make_passage(document_id="doc-A", text="Has content.")
        result = format_multi_doc_passages({"doc-A": [p1], "doc-B": []})
        assert "doc-A" in result
