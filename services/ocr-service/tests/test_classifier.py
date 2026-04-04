"""Tests for src.classify.classifier — legal document type classification."""

from __future__ import annotations

import pytest

from src.classify.classifier import classify_document
from src.schemas import ClassificationResult


class TestClassifyDocument:
    """classify_document — weighted pattern matching on OCR text."""

    # ── Edge cases ────────────────────────────────────────────────────────

    def test_empty_string_returns_unknown(self):
        result = classify_document("")
        assert result.document_type == "unknown"
        assert result.confidence == 0.0

    def test_short_text_returns_unknown(self):
        result = classify_document("Hello world")
        assert result.document_type == "unknown"
        assert result.confidence == 0.0

    def test_no_patterns_matched_returns_unknown(self):
        result = classify_document("a" * 50)
        assert result.document_type == "unknown"
        assert result.confidence == 0.0

    # ── Case classification ───────────────────────────────────────────────

    def test_case_gr_number(self):
        text = """
        SUPREME COURT OF THE PHILIPPINES
        G.R. No. 123456
        PETITIONER vs. RESPONDENT
        DECISION
        WHEREFORE, the petition is GRANTED.
        """
        result = classify_document(text)
        assert result.document_type == "case"
        assert result.confidence > 0.5

    def test_case_supreme_court(self):
        text = """
        SUPREME COURT
        EN BANC
        G.R. No. 199422
        The DECISION is hereby rendered.
        PONENTE: Justice Santos
        """
        result = classify_document(text)
        assert result.document_type == "case"

    def test_case_petitioner_respondent(self):
        text = """
        REPUBLIC OF THE PHILIPPINES
        COURT OF APPEALS
        PETITIONERS vs. RESPONDENTS
        RESOLUTION
        WHEREFORE, the appeal is DENIED.
        """
        result = classify_document(text)
        assert result.document_type == "case"

    def test_case_wherefore_granted(self):
        text = """
        G.R. No. 567890
        DECISION
        After careful deliberation, the Court finds merit in the petition.
        WHEREFORE, premises considered, the petition is hereby GRANTED.
        """
        result = classify_document(text)
        assert result.document_type == "case"
        assert result.confidence > 0.4

    # ── Statute classification ────────────────────────────────────────────

    def test_statute_republic_act(self):
        text = """
        REPUBLIC ACT No. 10175
        AN ACT DEFINING CYBERCRIME, PROVIDING FOR THE PREVENTION,
        INVESTIGATION, SUPPRESSION AND THE IMPOSITION OF PENALTIES THEREFOR.
        Section 1. Title.
        Section 2. Declaration of Policy.
        Article 3. Definitions.
        """
        result = classify_document(text)
        assert result.document_type == "statute"
        assert result.confidence > 0.4

    def test_statute_ra_abbreviation(self):
        text = """
        R.A. No. 7610
        AN ACT PROVIDING FOR STRONGER DETERRENCE AND SPECIAL PROTECTION
        AGAINST CHILD ABUSE
        Section 1. Title.
        Section 2. Purpose.
        """
        result = classify_document(text)
        assert result.document_type == "statute"

    def test_statute_articles_sections(self):
        text = """
        AN ACT INSTITUTING A COMPREHENSIVE AGRARIAN REFORM PROGRAM
        Article 1. Scope and Coverage
        Section 1. The program shall cover all agricultural lands.
        Section 2. Beneficiaries shall include tenants.
        Article 2. Land Acquisition
        Section 3. Just compensation shall be determined.
        Section 4. Voluntary land transfer is encouraged.
        """
        result = classify_document(text)
        assert result.document_type == "statute"

    # ── Rule classification ───────────────────────────────────────────────

    def test_rule_rules_of_court(self):
        text = """
        RULES OF COURT
        A.M. No. 19-10-20-SC
        RULE 65 — CERTIORARI, PROHIBITION AND MANDAMUS
        Section 1. Petition for certiorari.
        """
        result = classify_document(text)
        assert result.document_type == "rule"

    def test_rule_administrative_matter(self):
        text = """
        SUPREME COURT ADMINISTRATIVE order
        A.M. No. 03-1-09-SC
        RE: RULES OF PROCEDURE FOR ENVIRONMENTAL CASES
        RULE 1 — GENERAL PROVISIONS
        RULE 2 — CIVIL CASES
        """
        result = classify_document(text)
        assert result.document_type == "rule"

    # ── Issuance classification ───────────────────────────────────────────

    def test_issuance_executive_order(self):
        text = """
        EXECUTIVE ORDER No. 292
        INSTITUTING THE ADMINISTRATIVE CODE OF 1987
        The President of the Philippines hereby orders:
        """
        result = classify_document(text)
        assert result.document_type == "issuance"

    def test_issuance_proclamation(self):
        text = """
        PROCLAMATION No. 1081
        PROCLAIMING A STATE OF MARTIAL LAW IN THE PHILIPPINES
        The President hereby proclaims the following:
        """
        result = classify_document(text)
        assert result.document_type == "issuance"

    # ── Memorandum classification ─────────────────────────────────────────

    def test_memorandum_legal_memo(self):
        text = """
        LEGAL MEMORANDUM
        STATEMENT OF FACTS
        The client engaged in a contract with the respondent.
        ISSUES PRESENTED
        Whether the contract is valid.
        DISCUSSION
        Under Philippine law, the elements of a valid contract are...
        CONCLUSION
        The contract is voidable.
        """
        result = classify_document(text)
        assert result.document_type == "memorandum"

    # ── Order classification ──────────────────────────────────────────────

    def test_order_court_order(self):
        text = """
        REGIONAL TRIAL COURT
        BRANCH 42
        ORDER
        The COURT hereby orders the parties to submit their memoranda.
        SO ORDERED.
        """
        result = classify_document(text)
        assert result.document_type == "order"

    # ── Confidence scaling ────────────────────────────────────────────────

    def test_low_absolute_score_low_confidence(self):
        """When only a single low-weight pattern matches, confidence is reduced."""
        text = "This document mentions vs. in passing and nothing else relevant. " * 3
        result = classify_document(text)
        # vs. alone has weight 0.5, which is < 3.0 → confidence *= 0.5
        assert result.confidence < 0.6

    def test_confidence_between_zero_and_one(self):
        """Confidence must always be in [0.0, 1.0]."""
        text = """
        G.R. No. 123456 G.R. No. 234567 G.R. No. 345678
        SUPREME COURT SUPREME COURT
        PETITIONER vs. RESPONDENT
        DECISION DECISION RESOLUTION EN BANC
        PONENTE CONCURRING DISSENTING
        WHEREFORE GRANTED WHEREFORE AFFIRMED
        100 SCRA 200 50 Phil. 100
        """
        result = classify_document(text)
        assert 0.0 <= result.confidence <= 1.0
