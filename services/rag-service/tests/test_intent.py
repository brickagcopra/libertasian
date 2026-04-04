"""Tests for src.core.intent — rule-based query intent classification."""

from __future__ import annotations

import pytest

from src.core.intent import classify_intent
from src.core.types import QueryIntent


class TestCaseLookupIntent:
    """classify_intent → CASE_LOOKUP for citation-style queries."""

    def test_gr_number_standard(self):
        assert classify_intent("G.R. No. 123456") == QueryIntent.CASE_LOOKUP

    def test_gr_number_no_periods(self):
        assert classify_intent("GR No 123456") == QueryIntent.CASE_LOOKUP

    def test_gr_number_l_prefix(self):
        assert classify_intent("G.R. No. L-12345") == QueryIntent.CASE_LOOKUP

    def test_grn_format(self):
        assert classify_intent("GRN 123456") == QueryIntent.CASE_LOOKUP

    def test_gr_lowercase(self):
        assert classify_intent("g.r. no. 234567") == QueryIntent.CASE_LOOKUP

    def test_scra_citation(self):
        assert classify_intent("123 SCRA 456") == QueryIntent.CASE_LOOKUP

    def test_phil_reports_citation(self):
        assert classify_intent("123 Phil. 456") == QueryIntent.CASE_LOOKUP

    def test_case_title_v_dot(self):
        assert classify_intent("People v. Dela Cruz") == QueryIntent.CASE_LOOKUP

    def test_case_title_vs_dot(self):
        assert classify_intent("Republic vs. Sandiganbayan") == QueryIntent.CASE_LOOKUP

    def test_gr_in_sentence(self):
        assert classify_intent("What is the ruling in G.R. No. 199422?") == QueryIntent.CASE_LOOKUP


class TestCodalReferenceIntent:
    """classify_intent → CODAL_REFERENCE for statute/code references."""

    def test_republic_act(self):
        assert classify_intent("Republic Act No. 10175") == QueryIntent.CODAL_REFERENCE

    def test_ra_abbreviation(self):
        assert classify_intent("RA 10175") == QueryIntent.CODAL_REFERENCE

    def test_presidential_decree(self):
        assert classify_intent("P.D. No. 1529") == QueryIntent.CODAL_REFERENCE

    def test_batas_pambansa(self):
        assert classify_intent("B.P. Blg. 22") == QueryIntent.CODAL_REFERENCE

    def test_article_reference(self):
        assert classify_intent("Article 1306 of the Civil Code") == QueryIntent.CODAL_REFERENCE

    def test_section_reference(self):
        assert classify_intent("Section 5 of Rule 110") == QueryIntent.CODAL_REFERENCE

    def test_rules_of_court(self):
        assert classify_intent("Rules of Court Rule 65") == QueryIntent.CODAL_REFERENCE

    def test_constitution(self):
        assert classify_intent("Article III of the Constitution") == QueryIntent.CODAL_REFERENCE

    def test_civil_code(self):
        assert classify_intent("Civil Code provisions on obligations") == QueryIntent.CODAL_REFERENCE


class TestDoctrineSearchIntent:
    """classify_intent → DOCTRINE_SEARCH for legal doctrine queries."""

    def test_doctrine_of(self):
        assert classify_intent("doctrine of res judicata") == QueryIntent.DOCTRINE_SEARCH

    def test_res_judicata(self):
        assert classify_intent("res judicata") == QueryIntent.DOCTRINE_SEARCH

    def test_stare_decisis(self):
        assert classify_intent("stare decisis") == QueryIntent.DOCTRINE_SEARCH

    def test_elements_of(self):
        assert classify_intent("elements of estafa") == QueryIntent.DOCTRINE_SEARCH


class TestProceduralQueryIntent:
    """classify_intent → PROCEDURAL_QUERY for procedure questions."""

    def test_how_to_file(self):
        assert classify_intent("how to file a complaint") == QueryIntent.PROCEDURAL_QUERY

    def test_period_to_appeal(self):
        assert classify_intent("period to appeal a decision") == QueryIntent.PROCEDURAL_QUERY

    def test_jurisdiction_of(self):
        assert classify_intent("jurisdiction of the MTC") == QueryIntent.PROCEDURAL_QUERY

    def test_certiorari(self):
        assert classify_intent("certiorari requirements") == QueryIntent.PROCEDURAL_QUERY


class TestLegalQuestionIntent:
    """classify_intent → LEGAL_QUESTION for open-ended questions."""

    def test_question_mark(self):
        assert classify_intent("Is bigamy a criminal offense?") == QueryIntent.LEGAL_QUESTION

    def test_what_starter(self):
        assert classify_intent("what are the grounds for annulment") == QueryIntent.LEGAL_QUESTION

    def test_how_starter(self):
        assert classify_intent("how is moral damages computed") == QueryIntent.LEGAL_QUESTION

    def test_can_starter(self):
        assert classify_intent("can a foreigner own land in the Philippines") == QueryIntent.LEGAL_QUESTION


class TestGeneralIntent:
    """classify_intent → GENERAL for unmatched fallback queries."""

    def test_generic_text(self):
        assert classify_intent("labor dispute employee termination") == QueryIntent.GENERAL

    def test_whitespace_only(self):
        assert classify_intent("   ") == QueryIntent.GENERAL

    def test_empty_string(self):
        assert classify_intent("") == QueryIntent.GENERAL

    def test_short_keyword(self):
        assert classify_intent("tax") == QueryIntent.GENERAL
