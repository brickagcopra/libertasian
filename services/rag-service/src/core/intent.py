"""Rule-based intent classifier for Philippine legal queries.

Pattern matching is <1ms vs 200-500ms for an LLM call. Legal queries are
well-structured enough that rules work reliably for routing.
"""

from __future__ import annotations

import re

from .types import QueryIntent

# --- G.R. Number patterns ---
# Matches: G.R. No. 123456, GR No. 123456, G.R. No. L-12345, GRN 123456
_GR_PATTERN = re.compile(
    r"\b(?:G\.?\s*R\.?\s*(?:No\.?|N\.?)|GRN)\s*(?:L-?)?\d{3,}",
    re.IGNORECASE,
)

# --- SCRA / Phil Reports citations ---
# Matches: 123 SCRA 456, 123 Phil. 456, 12 Phil 345
_SCRA_PATTERN = re.compile(
    r"\b\d+\s+(?:SCRA|Phil\.?|O\.?G\.?)\s+\d+",
    re.IGNORECASE,
)

# --- Case title pattern ---
# Matches: People v. Dela Cruz, Republic vs. Sandiganbayan
_CASE_TITLE_PATTERN = re.compile(
    r"\b[A-Z][a-z]+(?:\s+(?:de|del|dela|los|san|sta|sto))?"
    r"\s+(?:v\.?s?\.?)\s+"
    r"[A-Z][a-z]+",
)

# --- Codal / statute patterns ---
# Matches: Republic Act No. 1234, RA 1234, Art. 123, Section 45,
# Presidential Decree No. 123, Batas Pambansa Blg. 22, Rule 65
_CODAL_PATTERNS = [
    re.compile(
        r"\b(?:Republic\s+Act|R\.?A\.?)\s*(?:No\.?)?\s*\d+",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:Presidential\s+Decree|P\.?D\.?)\s*(?:No\.?)?\s*\d+",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:Batas\s+Pambansa|B\.?P\.?)\s*(?:Blg\.?|No\.?)?\s*\d+",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:Executive\s+Order|E\.?O\.?)\s*(?:No\.?)?\s*\d+",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:Art(?:icle)?\.?\s*\d+|Sec(?:tion)?\.?\s*\d+)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bRule\s+\d+",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:Civil\s+Code|Revised\s+Penal\s+Code|Family\s+Code|Labor\s+Code"
        r"|Rules\s+of\s+Court|Constitution)\b",
        re.IGNORECASE,
    ),
]

# --- Doctrine keywords ---
_DOCTRINE_KEYWORDS = [
    "doctrine of",
    "doctrine on",
    "principle of",
    "rule on",
    "test for",
    "elements of",
    "requisites of",
    "requisites for",
    "fruit of the poisonous tree",
    "res judicata",
    "stare decisis",
    "laches",
    "estoppel",
    "immutability of judgment",
    "hierarchy of courts",
    "exhaustion of administrative remedies",
    "primary jurisdiction",
    "forum shopping",
    "judicial stability",
    "law of the case",
    "moot and academic",
    "justiciable controversy",
    "political question",
]

# --- Procedural keywords ---
_PROCEDURAL_KEYWORDS = [
    "how to file",
    "how do i file",
    "where to file",
    "filing fee",
    "period to appeal",
    "reglementary period",
    "prescriptive period",
    "statute of limitations",
    "jurisdiction of",
    "venue for",
    "steps to",
    "procedure for",
    "motion for",
    "petition for",
    "complaint for",
    "how long",
    "what court",
    "which court",
    "appeal to",
    "certiorari",
    "mandamus",
    "habeas corpus",
    "bail",
    "arraignment",
    "preliminary investigation",
]


def classify_intent(query: str) -> QueryIntent:
    """Classify the intent of a user's legal query using rule-based patterns.

    The classification drives retrieval strategy:
    - CASE_LOOKUP: exact match on G.R./citation → prioritize keyword search
    - CODAL_REFERENCE: statute lookup → filter by document_type
    - DOCTRINE_SEARCH: concept search → boost kNN similarity
    - PROCEDURAL_QUERY: procedure → boost Rules of Court sources
    - LEGAL_QUESTION: general analysis → balanced hybrid search
    - GENERAL: fallback

    Args:
        query: The user's search query string.

    Returns:
        The classified QueryIntent enum value.
    """
    q_lower = query.lower().strip()

    # 1. Case lookup — G.R. numbers, SCRA citations, case titles
    if _GR_PATTERN.search(query) or _SCRA_PATTERN.search(query):
        return QueryIntent.CASE_LOOKUP
    if _CASE_TITLE_PATTERN.search(query):
        return QueryIntent.CASE_LOOKUP

    # 2. Codal reference — statutes, codes, specific provisions
    for pattern in _CODAL_PATTERNS:
        if pattern.search(query):
            return QueryIntent.CODAL_REFERENCE

    # 3. Doctrine search — legal principles and doctrines
    for keyword in _DOCTRINE_KEYWORDS:
        if keyword in q_lower:
            return QueryIntent.DOCTRINE_SEARCH

    # 4. Procedural query — court procedures, filing, jurisdiction
    for keyword in _PROCEDURAL_KEYWORDS:
        if keyword in q_lower:
            return QueryIntent.PROCEDURAL_QUERY

    # 5. Legal question — queries with question words + legal context
    question_words = ("what", "when", "where", "who", "how", "is", "are", "can", "may", "does")
    if q_lower.endswith("?") or any(q_lower.startswith(w) for w in question_words):
        return QueryIntent.LEGAL_QUESTION

    # 6. Fallback
    return QueryIntent.GENERAL
