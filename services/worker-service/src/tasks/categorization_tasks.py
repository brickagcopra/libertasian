"""LIBERTASIAN Worker Service — Enhanced subject categorization Celery task.

Categorizes newly ingested legal documents by subject area using
rule-based keyword matching with confidence scores.

Supports:
- 9 bar subjects (bar_subject tag type)
- 5 extended subjects (subject tag type)
- Primary/secondary subject assignment with confidence scores
- Low-confidence results flagged for review

Per plan:
- Highest-scoring subject = isPrimary=true
- Others with confidence >= 0.4 = secondary (isPrimary=false)
- If primary confidence < 0.5 → all marked reviewStatus='needs_review'

Per CLAUDE.md: Celery tasks must be idempotent (acks_late + reject_on_worker_lost).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import psycopg2.extras
from celery import shared_task

from ..clients.db_client import get_connection
from ..clients import ingestion_db_client as db

logger = logging.getLogger(__name__)

# Maximum possible raw score per rule
# (used to normalize scores to [0, 1] confidence range)
_MAX_KEYWORD_SCORE = 10  # ~5 keyword matches × 2 points each
_MAX_CITATION_SCORE = 6  # ~2 citation matches × 3 points each
_MAX_AGENCY_SCORE = 4    # ~2 agency matches × 2 points each
_MAX_RAW_SCORE = _MAX_KEYWORD_SCORE + _MAX_CITATION_SCORE + _MAX_AGENCY_SCORE

# Confidence threshold for secondary subject inclusion
SECONDARY_CONFIDENCE_THRESHOLD = 0.4

# Confidence threshold below which primary needs human review
PRIMARY_REVIEW_THRESHOLD = 0.5


# ─── Categorization Rules ──────────────────────────────────────────────

CATEGORIZATION_RULES: list[dict[str, Any]] = [
    {
        "code": "civil_law",
        "tag_type": "bar_subject",
        "title_keywords": [
            "civil code", "obligations", "contracts", "property", "succession",
            "family code", "marriage", "annulment", "adoption", "custody",
            "torts", "damages", "quasi-delict", "mortgage", "pledge", "lease",
            "sale of property", "easement", "usufruct", "donation", "agency",
            "partnership", "trust", "guardianship", "emancipation", "paternity",
        ],
        "citation_patterns": ["r.a. no. 386", "r.a. no. 8533", "r.a. no. 9048"],
        "agencies": [],
    },
    {
        "code": "commercial_law",
        "tag_type": "bar_subject",
        "title_keywords": [
            "corporation code", "insurance code", "negotiable instruments",
            "banking", "securities", "intellectual property", "trademark",
            "copyright", "patent", "corporation", "transportation",
            "maritime", "admiralty", "warehouse receipt", "letter of credit",
            "chattel mortgage", "bouncing check", "anti-money laundering",
            "revised corporation code", "financial rehabilitation",
        ],
        "citation_patterns": ["r.a. no. 11232", "b.p. blg. 22", "r.a. no. 8293"],
        "agencies": ["sec", "bsp", "ic"],
    },
    {
        "code": "criminal_law",
        "tag_type": "bar_subject",
        "title_keywords": [
            "revised penal code", "penal code", "criminal", "murder", "homicide",
            "robbery", "theft", "rape", "kidnapping", "illegal detention",
            "dangerous drugs", "anti-trafficking", "cybercrime", "graft",
            "corruption", "anti-graft", "plunder", "malversation", "estafa",
            "libel", "arson", "carnapping", "illegal firearms",
            "comprehensive dangerous drugs", "anti-terrorism",
        ],
        "citation_patterns": ["act no. 3815", "r.a. no. 9165", "r.a. no. 10591"],
        "agencies": [],
    },
    {
        "code": "labor_law",
        "tag_type": "bar_subject",
        "title_keywords": [
            "labor code", "employment", "illegal dismissal", "constructive dismissal",
            "unfair labor practice", "collective bargaining", "strike", "lockout",
            "minimum wage", "overtime", "holiday pay", "separation pay",
            "backwages", "reinstatement", "labor relations", "social security",
            "employees compensation", "overseas filipino workers", "ofw",
            "migrant workers", "dole", "nlrc",
        ],
        "citation_patterns": ["p.d. no. 442", "r.a. no. 8042"],
        "agencies": ["dole", "nlrc", "sss", "gsis", "poea"],
    },
    {
        "code": "political_law",
        "tag_type": "bar_subject",
        "title_keywords": [
            "constitution", "constitutional", "bill of rights", "suffrage",
            "election", "local government", "public officer",
            "impeachment", "judicial review", "separation of powers",
            "executive order", "presidential decree", "legislative",
            "law of public officers", "commission on elections", "comelec",
            "civil service", "ombudsman", "sandiganbayan", "national defense",
            "emergency powers", "martial law", "writ of habeas corpus",
            "writ of amparo", "writ of habeas data", "writ of kalikasan",
        ],
        "citation_patterns": [],
        "agencies": ["comelec", "csc", "coa", "ombudsman"],
    },
    {
        "code": "public_international_law",
        "tag_type": "bar_subject",
        "title_keywords": [
            "international law", "treaty", "convention", "extradition",
            "diplomatic immunity", "law of the sea", "unclos",
            "international court", "international humanitarian",
            "human rights", "international criminal", "vienna convention",
            "geneva convention", "asylum", "state immunity",
            "territorial dispute",
        ],
        "citation_patterns": [],
        "agencies": [],
    },
    {
        "code": "remedial_law",
        "tag_type": "bar_subject",
        "title_keywords": [
            "rules of court", "civil procedure", "criminal procedure",
            "evidence", "jurisdiction", "venue", "appeal", "certiorari",
            "mandamus", "prohibition", "injunction", "habeas corpus",
            "execution of judgment", "provisional remedy", "attachment",
            "garnishment", "receivership", "replevin", "small claims",
            "rules on summary procedure", "special proceedings",
            "alternative dispute resolution", "mediation", "arbitration",
        ],
        "citation_patterns": ["a.m. no."],
        "agencies": [],
    },
    {
        "code": "taxation_law",
        "tag_type": "bar_subject",
        "title_keywords": [
            "tax", "taxation", "national internal revenue", "nirc",
            "income tax", "value added tax", "vat", "estate tax",
            "donor's tax", "excise tax", "customs", "tariff",
            "local government taxation", "real property tax", "bir",
            "tax reform", "train", "tax amnesty", "tax evasion",
            "tax avoidance", "documentary stamp", "percentage tax",
        ],
        "citation_patterns": ["r.a. no. 8424", "r.a. no. 10963"],
        "agencies": ["bir", "boc", "cta"],
    },
    {
        "code": "legal_ethics",
        "tag_type": "bar_subject",
        "title_keywords": [
            "legal ethics", "code of professional responsibility",
            "disbarment", "suspension of attorney", "malpractice",
            "attorney misconduct", "judicial ethics", "canon of judicial conduct",
            "notarial law", "notary public", "unauthorized practice of law",
            "attorney-client privilege", "conflict of interest",
            "legal aid", "ibp", "lawyer's oath",
        ],
        "citation_patterns": [],
        "agencies": ["ibp"],
    },
    # ─── Extended Subject Rules ────────────────────────────────────────
    {
        "code": "environmental_law",
        "tag_type": "subject",
        "title_keywords": [
            "environmental", "pollution", "clean air", "clean water",
            "ecological", "mining", "forestry", "wildlife",
            "environmental impact", "denr", "writ of kalikasan",
            "solid waste", "toxic substances", "climate change",
        ],
        "citation_patterns": ["r.a. no. 9003", "r.a. no. 8749", "r.a. no. 9275"],
        "agencies": ["denr", "emb"],
    },
    {
        "code": "family_law",
        "tag_type": "subject",
        "title_keywords": [
            "family code", "marriage", "annulment", "legal separation",
            "adoption", "custody", "support", "parental authority",
            "paternity", "filiation", "legitimate", "illegitimate",
            "conjugal", "absolute community", "vawc", "domestic violence",
        ],
        "citation_patterns": ["e.o. no. 209", "r.a. no. 9262", "r.a. no. 8552"],
        "agencies": ["dswd"],
    },
    {
        "code": "property_law",
        "tag_type": "subject",
        "title_keywords": [
            "property", "ownership", "possession", "usufruct",
            "easement", "servitude", "land registration", "torrens",
            "agrarian reform", "tenant", "land title", "condominium",
            "eminent domain", "expropriation", "quieting of title",
        ],
        "citation_patterns": ["p.d. no. 1529", "r.a. no. 6657", "r.a. no. 4726"],
        "agencies": ["lra", "dar"],
    },
    {
        "code": "administrative_law",
        "tag_type": "subject",
        "title_keywords": [
            "administrative law", "administrative order", "administrative case",
            "quasi-judicial", "regulatory", "government agency",
            "public officer", "civil service", "administrative disciplinary",
            "ombudsman", "accountability", "government procurement",
        ],
        "citation_patterns": ["e.o. no. 292"],
        "agencies": ["csc", "ombudsman", "coa"],
    },
    {
        "code": "constitutional_law",
        "tag_type": "subject",
        "title_keywords": [
            "constitution", "constitutional", "bill of rights",
            "due process", "equal protection", "freedom of speech",
            "freedom of religion", "right to privacy", "right to travel",
            "sovereignty", "republican state", "social justice",
            "human rights commission",
        ],
        "citation_patterns": [],
        "agencies": ["chr"],
    },
]


@dataclass
class ClassificationScore:
    """Score result for a single subject category."""

    code: str
    tag_type: str
    raw_score: int
    confidence: float


def _classify_with_confidence(
    title: str,
    citation_text: str | None,
    agency: str | None,
) -> list[ClassificationScore]:
    """Categorize a document using keyword rules with confidence scores.

    Returns scored list of all matching subjects sorted by confidence (desc).
    """
    results: list[ClassificationScore] = []
    title_lower = title.lower()
    citation_lower = (citation_text or "").lower()
    agency_lower = (agency or "").lower()

    for rule in CATEGORIZATION_RULES:
        score = 0

        for keyword in rule["title_keywords"]:
            if keyword in title_lower:
                score += 2

        for pattern in rule["citation_patterns"]:
            if pattern in citation_lower:
                score += 3

        for ag in rule["agencies"]:
            if ag in agency_lower:
                score += 2

        if score >= 2:
            confidence = min(score / _MAX_RAW_SCORE, 1.0)
            results.append(ClassificationScore(
                code=rule["code"],
                tag_type=rule.get("tag_type", "bar_subject"),
                raw_score=score,
                confidence=round(confidence, 4),
            ))

    results.sort(key=lambda x: x.confidence, reverse=True)
    return results


def _get_all_subject_tags() -> dict[str, str]:
    """Fetch all subject-type tags from DB. Returns {code: id} mapping."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, code
               FROM legal_metadata_tags
               WHERE tag_type IN ('bar_subject', 'subject')""",
        )
        return {row["code"]: row["id"] for row in cur.fetchall()}


def _get_document_for_categorization(document_id: str) -> dict[str, Any] | None:
    """Fetch document fields needed for categorization."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, title, citation_text, document_type, court, agency
               FROM legal_documents
               WHERE id = %s""",
            (document_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def _document_has_subject_tags(document_id: str) -> bool:
    """Check if a document already has any subject tags (idempotent check)."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT COUNT(*) AS cnt
               FROM legal_document_tag_map dtm
               JOIN legal_metadata_tags t ON t.id = dtm.tag_id
               WHERE dtm.legal_document_id = %s
                 AND t.tag_type IN ('bar_subject', 'subject')""",
            (document_id,),
        )
        row = cur.fetchone()
        return bool(row and row["cnt"] > 0)


def _create_tag_mappings_with_confidence(
    document_id: str,
    mappings: list[dict[str, Any]],
) -> int:
    """Create tag mappings with confidence and primary/secondary flags.

    Each mapping dict: {tag_id, is_primary, confidence, classified_by, review_status}
    Returns count of new mappings.
    """
    if not mappings:
        return 0

    with get_connection() as conn, conn.cursor() as cur:
        for mapping in mappings:
            cur.execute(
                """INSERT INTO legal_document_tag_map
                       (id, legal_document_id, tag_id, is_primary,
                        confidence, classified_by, review_status)
                   VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (legal_document_id, tag_id) DO NOTHING""",
                (
                    document_id,
                    mapping["tag_id"],
                    mapping["is_primary"],
                    mapping["confidence"],
                    mapping["classified_by"],
                    mapping["review_status"],
                ),
            )
        conn.commit()
        return len(mappings)


# ─── Celery Task ────────────────────────────────────────────────────────


@shared_task(
    bind=True,
    name="categorization.categorize_document",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=2,
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def categorize_document_task(
    self: Any,
    document_id: str,
) -> dict[str, Any]:
    """Categorize a legal document by subject area with confidence scoring.

    Enhanced rule-based keyword matching against document title, citation text,
    and agency. Assigns primary + secondary subjects with confidence scores.

    Primary: highest-scoring subject → isPrimary=true
    Secondary: others with confidence >= 0.4 → isPrimary=false
    Review: if primary confidence < 0.5 → all marked reviewStatus='needs_review'

    Idempotent: skips documents that already have subject tags.
    Fire-and-forget from chain_post_ingestion().
    """
    try:
        # Idempotent check
        if _document_has_subject_tags(document_id):
            logger.debug(
                "Document %s already has subject tags, skipping",
                document_id,
            )
            return {
                "document_id": document_id,
                "status": "skipped",
                "reason": "already_categorized",
            }

        # Load document
        doc = _get_document_for_categorization(document_id)
        if not doc:
            logger.warning("Document %s not found for categorization", document_id)
            return {"document_id": document_id, "status": "not_found"}

        # Run classification with confidence
        scores = _classify_with_confidence(
            title=doc["title"],
            citation_text=doc.get("citation_text"),
            agency=doc.get("agency"),
        )

        if not scores:
            logger.debug(
                "No subject match for document %s (%s)",
                document_id,
                doc["title"][:100],
            )
            return {
                "document_id": document_id,
                "status": "no_match",
                "title": doc["title"][:100],
            }

        # Load tag mappings
        tag_map = _get_all_subject_tags()

        # Determine primary and secondary subjects
        primary = scores[0]
        needs_review = primary.confidence < PRIMARY_REVIEW_THRESHOLD

        mappings: list[dict[str, Any]] = []
        matched_codes: list[str] = []
        primary_code: str | None = None

        for i, score in enumerate(scores):
            tag_id = tag_map.get(score.code)
            if not tag_id:
                continue

            is_primary = i == 0
            # Include if primary, or if confidence >= secondary threshold
            if is_primary or score.confidence >= SECONDARY_CONFIDENCE_THRESHOLD:
                review_status = "needs_review" if needs_review else "auto"
                mappings.append({
                    "tag_id": tag_id,
                    "is_primary": is_primary,
                    "confidence": score.confidence,
                    "classified_by": "rule_based",
                    "review_status": review_status,
                })
                matched_codes.append(score.code)
                if is_primary:
                    primary_code = score.code

        if not mappings:
            logger.warning(
                "Subject tags not found in DB for codes: %s",
                [s.code for s in scores],
            )
            return {
                "document_id": document_id,
                "status": "error",
                "error": "tags_not_seeded",
            }

        # Create tag mappings
        created = _create_tag_mappings_with_confidence(document_id, mappings)

        # Audit log for classification
        audit_action = (
            "document.classification_needs_review"
            if needs_review
            else "document.subjects_classified"
        )
        db.create_audit_log(
            action=audit_action,
            entity_type="legal_document",
            entity_id=document_id,
            metadata={
                "primary_subject": primary_code,
                "primary_confidence": primary.confidence,
                "all_subjects": matched_codes,
                "needs_review": needs_review,
                "scores": [
                    {"code": s.code, "confidence": s.confidence}
                    for s in scores
                    if s.code in matched_codes
                ],
            },
        )

        logger.info(
            "Categorized document %s: primary=%s (%.2f) secondary=%s review=%s",
            document_id,
            primary_code,
            primary.confidence,
            [c for c in matched_codes if c != primary_code],
            needs_review,
        )

        return {
            "document_id": document_id,
            "status": "categorized",
            "primary_subject": primary_code,
            "primary_confidence": primary.confidence,
            "all_subjects": matched_codes,
            "tags_created": created,
            "needs_review": needs_review,
        }

    except Exception as exc:
        logger.exception(
            "Failed to categorize document %s", document_id,
        )
        if self.request.retries >= self.max_retries:
            return {
                "document_id": document_id,
                "status": "failed",
                "error": str(exc),
            }
        raise self.retry(exc=exc) from exc
